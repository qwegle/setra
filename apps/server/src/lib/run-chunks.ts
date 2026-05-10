/**
 * run-chunks.ts — single source of truth for writing run chunks and
 * publishing live activity events to subscribers.
 *
 * Every code path that streams agent output (direct runs, dispatcher,
 * agent-wake, channel-wake, idle-converse, routines scheduler, PTY
 * bridge) writes through `recordRunChunk`. The helper:
 *
 *   1. assigns a sequence number scoped to the run
 *   2. INSERTs into the `chunks` table with a current timestamp
 *   3. emits a `run:chunk` SSE event so the board can render the
 *      "what is the agent doing right now" strip without polling
 *   4. stamps `runs.first_chunk_at` on the first chunk so the project
 *      manager dashboard can compute time-to-first-token SLAs
 *
 * The helper resolves agent slug and company id from the parent `runs`
 * row when not supplied so existing callers can be migrated with a
 * one-line replacement.
 */

import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";
import { createLogger } from "./logger.js";

const log = createLogger("run-chunks");

export type RunChunkType =
	| "input"
	| "system"
	| "assistant"
	| "tool_use"
	| "tool_result"
	| "stdout"
	| "stderr"
	| "output";

export interface RecordRunChunkInput {
	runId: string;
	type: RunChunkType;
	content: string;
	toolName?: string | null;
	agentSlug?: string | null;
	companyId?: string | null;
	now?: string;
}

interface RunMeta {
	agent: string;
	companyId: string | null;
}

const META_CACHE = new Map<string, RunMeta>();

function nowIso(): string {
	return new Date().toISOString().replace("Z", "Z");
}

function lookupRunMeta(runId: string): RunMeta {
	const cached = META_CACHE.get(runId);
	if (cached) return cached;
	const row = getRawDb()
		.prepare(
			`SELECT r.agent AS agent, ar.company_id AS companyId
               FROM runs r
          LEFT JOIN agent_roster ar ON ar.slug = r.agent
              WHERE r.id = ?`,
		)
		.get(runId) as { agent?: string; companyId?: string | null } | undefined;
	const meta: RunMeta = {
		agent: row?.agent ?? "",
		companyId: row?.companyId ?? null,
	};
	META_CACHE.set(runId, meta);
	return meta;
}

function getNextChunkSeq(runId: string): number {
	const row = getRawDb()
		.prepare(
			`SELECT COALESCE(MAX(sequence), -1) AS s FROM chunks WHERE run_id = ?`,
		)
		.get(runId) as { s: number };
	return Number(row?.s ?? -1) + 1;
}

function stampFirstChunk(runId: string, ts: string): void {
	try {
		getRawDb()
			.prepare(
				`UPDATE runs SET first_chunk_at = ? WHERE id = ? AND first_chunk_at IS NULL`,
			)
			.run(ts, runId);
	} catch (err) {
		// Column added in migration 0010; tolerate older DBs without crashing.
		log.debug("first_chunk_at stamp failed (older schema?)", {
			runId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Write a single chunk for a run and broadcast it on the SSE bus.
 * Safe to call from any code path. Errors are caught and logged so a
 * persistence failure never aborts the agent run itself.
 */
export function recordRunChunk(input: RecordRunChunkInput): {
	sequence: number;
	recordedAt: string;
} | null {
	const ts = input.now ?? nowIso();
	let sequence = 0;
	try {
		sequence = getNextChunkSeq(input.runId);
		getRawDb()
			.prepare(
				`INSERT INTO chunks (run_id, sequence, content, chunk_type, tool_name, recorded_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				input.runId,
				sequence,
				input.content,
				input.type,
				input.toolName ?? null,
				ts,
			);
		if (sequence === 0) stampFirstChunk(input.runId, ts);
	} catch (err) {
		log.warn("recordRunChunk persist failed", {
			runId: input.runId,
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}

	const meta =
		input.agentSlug && typeof input.companyId !== "undefined"
			? { agent: input.agentSlug, companyId: input.companyId ?? null }
			: lookupRunMeta(input.runId);

	try {
		emit("run:chunk", {
			runId: input.runId,
			agentId: meta.agent,
			companyId: meta.companyId,
			sequence,
			type: input.type,
			toolName: input.toolName ?? null,
			content: input.content,
			recordedAt: ts,
		});
	} catch (err) {
		log.debug("run:chunk emit failed (no subscribers?)", {
			runId: input.runId,
			error: err instanceof Error ? err.message : String(err),
		});
	}

	return { sequence, recordedAt: ts };
}

/**
 * Persist the resolved system prompt actually sent to the model so an
 * audit / replay surface can reconstruct the run end-to-end.
 *
 * Tolerates older schemas (no `system_prompt` column) by swallowing the
 * error, so the runtime never breaks because of an old DB.
 */
export function persistRunSystemPrompt(
	runId: string,
	systemPrompt: string,
): void {
	try {
		getRawDb()
			.prepare(`UPDATE runs SET system_prompt = ? WHERE id = ?`)
			.run(systemPrompt, runId);
	} catch (err) {
		log.debug("persistRunSystemPrompt failed (older schema?)", {
			runId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

/**
 * Read recent chunks for a run; used by REST clients that cannot
 * subscribe to SSE (e.g. evidence-bundle export, integration tests).
 */
export function listRunChunks(
	runId: string,
	since = -1,
	limit = 500,
): Array<{
	sequence: number;
	type: RunChunkType;
	toolName: string | null;
	content: string;
	recordedAt: string;
}> {
	const rows = getRawDb()
		.prepare(
			`SELECT sequence, chunk_type AS type, tool_name AS toolName, content, recorded_at AS recordedAt
               FROM chunks
              WHERE run_id = ? AND sequence > ?
              ORDER BY sequence ASC
              LIMIT ?`,
		)
		.all(runId, since, limit) as Array<{
		sequence: number;
		type: RunChunkType;
		toolName: string | null;
		content: string;
		recordedAt: string;
	}>;
	return rows;
}

/**
 * Drop a run from the meta cache; used by tests and by the dispatcher
 * when a run is recreated under a recycled id.
 */
export function clearRunChunkCache(runId?: string): void {
	if (runId) {
		META_CACHE.delete(runId);
		return;
	}
	META_CACHE.clear();
}
