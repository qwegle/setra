/**
 * Evidence bundle assembly for a run.
 *
 * The "evidence bundle" is the complete audit trail for a single run:
 * the resolved system prompt, every chunk recorded, the structured
 * tool calls extracted from those chunks, the set of files the agent
 * touched, and any artifacts (plans, designs, commit records, PR
 * records) tied to the same issue or agent.
 *
 * This is what enterprise customers and project managers consume when
 * they need to answer "did the agent actually do the work, and what
 * exactly did it do?".
 */

import { getRawDb } from "@setra/db";
import { type RunChunkType, listRunChunks } from "./run-chunks.js";

export interface RunHeader {
	id: string;
	agentSlug: string;
	displayName: string | null;
	companyId: string | null;
	status: string | null;
	startedAt: string | null;
	endedAt: string | null;
	firstChunkAt: string | null;
	exitCode: number | null;
	systemPrompt: string | null;
	issueId: string | null;
}

export interface RunToolCall {
	sequence: number;
	toolName: string | null;
	input: string;
	output: string | null;
	startedAt: string;
	completedAt: string | null;
}

export interface RunFileTouched {
	path: string;
	tool: string;
	firstSeenAt: string;
}

export interface RunArtifactRef {
	id: string;
	name: string;
	mimeType: string | null;
	createdAt: string | null;
}

export interface RunBundle {
	run: RunHeader;
	systemPrompt: string | null;
	chunks: ReturnType<typeof listRunChunks>;
	toolCalls: RunToolCall[];
	filesTouched: RunFileTouched[];
	artifacts: RunArtifactRef[];
	stats: {
		chunkCount: number;
		toolCallCount: number;
		fileCount: number;
		artifactCount: number;
	};
}

/**
 * Heuristic file-path extraction from tool input strings.
 *
 * Adapter SDKs serialize tool inputs as JSON; the chunks pipeline
 * stores them as text. We pull anything that looks like a relative
 * file path (one or more path segments, no spaces) plus explicit
 * `path`/`file_path`/`filePath` JSON keys when the input is parseable.
 */
function extractFilePaths(toolName: string | null, input: string): string[] {
	const paths = new Set<string>();
	const trimmed = input.trim();
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			for (const key of [
				"path",
				"file_path",
				"filePath",
				"target",
				"target_file",
				"file",
			]) {
				const v = parsed[key];
				if (typeof v === "string" && v.length > 0 && v.length < 512) {
					paths.add(v);
				}
			}
			// Multi-file tools sometimes accept arrays.
			for (const key of ["paths", "files", "targets"]) {
				const v = parsed[key];
				if (Array.isArray(v)) {
					for (const entry of v) {
						if (
							typeof entry === "string" &&
							entry.length > 0 &&
							entry.length < 512
						) {
							paths.add(entry);
						}
					}
				}
			}
		} catch {
			/* not JSON — fall through to regex */
		}
	}
	// Regex fallback for free-form inputs (e.g. shell commands).
	if (toolName && /bash|shell|exec|run/i.test(toolName)) {
		// Common edit-style command patterns.
		const re = /(?:^|\s)([a-zA-Z0-9._\-/]+\.[a-zA-Z0-9]{1,8})(?=\s|$|:)/g;
		let m: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
		while ((m = re.exec(input)) !== null) {
			if (m[1] && !m[1].startsWith("-")) paths.add(m[1]);
		}
	}
	return Array.from(paths);
}

/**
 * Walk a run's chunks and pair every tool_use chunk with the next
 * tool_result chunk so consumers see "tool called → tool returned"
 * rather than two independent rows.
 */
export function buildToolCalls(
	chunks: ReturnType<typeof listRunChunks>,
): RunToolCall[] {
	const calls: RunToolCall[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const c = chunks[i];
		if (!c || c.type !== "tool_use") continue;
		// Find the next tool_result for this tool name (or the next one
		// at all if names don't carry across).
		let result: (typeof chunks)[number] | null = null;
		for (let j = i + 1; j < chunks.length; j++) {
			const next = chunks[j];
			if (!next) continue;
			if (next.type === "tool_result") {
				result = next;
				break;
			}
			// Stop scanning if we hit another tool_use — pairing is done
			// nearest-neighbour to keep the algorithm O(n).
			if (next.type === "tool_use") break;
		}
		calls.push({
			sequence: c.sequence,
			toolName: c.toolName ?? null,
			input: c.content,
			output: result?.content ?? null,
			startedAt: c.recordedAt,
			completedAt: result?.recordedAt ?? null,
		});
	}
	return calls;
}

export function buildFilesTouched(
	chunks: ReturnType<typeof listRunChunks>,
): RunFileTouched[] {
	const seen = new Map<string, RunFileTouched>();
	for (const c of chunks) {
		if (c.type !== "tool_use") continue;
		const paths = extractFilePaths(c.toolName ?? null, c.content);
		for (const p of paths) {
			if (seen.has(p)) continue;
			seen.set(p, {
				path: p,
				tool: c.toolName ?? "unknown",
				firstSeenAt: c.recordedAt,
			});
		}
	}
	return Array.from(seen.values());
}

function loadHeader(runId: string): RunHeader | null {
	const row = getRawDb()
		.prepare(
			`SELECT r.id                AS id,
                    r.agent             AS agentSlug,
                    r.status            AS status,
                    r.started_at        AS startedAt,
                    r.ended_at          AS endedAt,
                    r.first_chunk_at    AS firstChunkAt,
                    r.exit_code         AS exitCode,
                    r.system_prompt     AS systemPrompt,
                    r.issue_id          AS issueId,
                    ar.company_id       AS companyId,
                    ar.display_name     AS displayName
               FROM runs r
          LEFT JOIN agent_roster ar ON ar.slug = r.agent
              WHERE r.id = ?`,
		)
		.get(runId) as RunHeader | undefined;
	return row ?? null;
}

function loadArtifacts(
	companyId: string | null,
	issueId: string | null,
	agentSlug: string | null,
): RunArtifactRef[] {
	if (!issueId && !agentSlug) return [];
	const conditions: string[] = [];
	const params: Array<string | null> = [];
	if (companyId) {
		conditions.push("(company_id = ? OR company_id IS NULL)");
		params.push(companyId);
	}
	if (issueId) {
		conditions.push("issue_id = ?");
		params.push(issueId);
	}
	if (agentSlug && !issueId) {
		conditions.push("agent_slug = ?");
		params.push(agentSlug);
	}
	const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
	try {
		const rows = getRawDb()
			.prepare(
				`SELECT id, name, mime_type AS mimeType, created_at AS createdAt
                   FROM artifacts ${where}
               ORDER BY created_at`,
			)
			.all(...params) as RunArtifactRef[];
		return rows;
	} catch {
		return [];
	}
}

export function assembleRunBundle(runId: string): RunBundle | null {
	const header = loadHeader(runId);
	if (!header) return null;
	const chunks = listRunChunks(runId, -1, 5000);
	const toolCalls = buildToolCalls(chunks);
	const filesTouched = buildFilesTouched(chunks);
	const artifacts = loadArtifacts(
		header.companyId,
		header.issueId,
		header.agentSlug,
	);
	return {
		run: header,
		systemPrompt: header.systemPrompt,
		chunks,
		toolCalls,
		filesTouched,
		artifacts,
		stats: {
			chunkCount: chunks.length,
			toolCallCount: toolCalls.length,
			fileCount: filesTouched.length,
			artifactCount: artifacts.length,
		},
	};
}

// Re-export for tests that need it without going through run-chunks.
export type { RunChunkType };
