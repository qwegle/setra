/**
 * transcript-exporter.ts — read-only JSONL projection of SQL run/chunk/
 * message state.
 *
 * Inspired by DeepCode's session.jsonl pattern (MIT, Copyright 2025
 * Data Intelligence Lab@HKU): a per-session append-only file you can
 * tail, jq, or grep without holding any DB locks. Setra differs in that
 * the SQL store remains the source of truth — this file is purely a
 * derived view, safe to delete and rebuild from the DB.
 *
 * File layout: $SETRA_TRANSCRIPT_DIR/<plotId>/transcript.jsonl
 *   (falls back to $SETRA_DATA_DIR/transcripts/<plotId>/transcript.jsonl,
 *    then ~/.setra/transcripts/<plotId>/transcript.jsonl).
 *
 * Line schema (one JSON object per line):
 *   {"_type":"metadata", "plotId", "createdAt"}            — first line
 *   {"_type":"run_started",   "runId", "agent", "taskIdRef?", "ts"}
 *   {"_type":"chunk",         "runId", "sequence", "chunkType",
 *                             "toolName?", "content", "ts"}
 *   {"_type":"team_message",  "messageId", "channel", "fromAgent",
 *                             "messageType", "taskIdRef?", "content", "ts"}
 *   {"_type":"run_completed", "runId", "status", "outcome?", "ts"}
 *
 * All append helpers are best-effort and never throw — a disk-full or
 * permissions error must not abort an agent run.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("transcript-exporter");

function resolveTranscriptRoot(): string {
	const explicit = process.env["SETRA_TRANSCRIPT_DIR"]?.trim();
	if (explicit) return explicit;
	const dataDir = process.env["SETRA_DATA_DIR"]?.trim();
	if (dataDir) return join(dataDir, "transcripts");
	return join(homedir(), ".setra", "transcripts");
}

export function transcriptPathForPlot(plotId: string): string {
	return join(resolveTranscriptRoot(), plotId, "transcript.jsonl");
}

function nowIso(): string {
	return new Date().toISOString();
}

function ensureHeader(plotId: string, file: string): void {
	if (existsSync(file)) return;
	mkdirSync(dirname(file), { recursive: true });
	const header = {
		_type: "metadata",
		plotId,
		createdAt: nowIso(),
	};
	writeFileSync(file, `${JSON.stringify(header)}\n`, { encoding: "utf8" });
}

function appendLine(plotId: string, line: object): void {
	if (process.env["SETRA_TRANSCRIPT_DISABLED"] === "1") return;
	try {
		const file = transcriptPathForPlot(plotId);
		ensureHeader(plotId, file);
		appendFileSync(file, `${JSON.stringify(line)}\n`, { encoding: "utf8" });
	} catch (err) {
		log.debug("transcript append failed (non-fatal)", {
			plotId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

export interface RunStartedTranscript {
	runId: string;
	agent: string;
	branchName?: string | null;
	taskIdRef?: string | null;
	startedAt?: string;
}

export function recordRunStartedTranscript(
	plotId: string | null | undefined,
	run: RunStartedTranscript,
): void {
	if (!plotId) return;
	appendLine(plotId, {
		_type: "run_started",
		runId: run.runId,
		agent: run.agent,
		branchName: run.branchName ?? null,
		taskIdRef: run.taskIdRef ?? null,
		ts: run.startedAt ?? nowIso(),
	});
}

export interface RunCompletedTranscript {
	runId: string;
	status: string;
	outcome?: string | null;
	endedAt?: string;
}

export function recordRunCompletedTranscript(
	plotId: string | null | undefined,
	run: RunCompletedTranscript,
): void {
	if (!plotId) return;
	appendLine(plotId, {
		_type: "run_completed",
		runId: run.runId,
		status: run.status,
		outcome: run.outcome ?? null,
		ts: run.endedAt ?? nowIso(),
	});
}

export interface ChunkTranscript {
	runId: string;
	sequence: number;
	chunkType: string;
	toolName?: string | null;
	content: string;
	recordedAt?: string;
}

export function recordChunkTranscript(
	plotId: string | null | undefined,
	chunk: ChunkTranscript,
): void {
	if (!plotId) return;
	appendLine(plotId, {
		_type: "chunk",
		runId: chunk.runId,
		sequence: chunk.sequence,
		chunkType: chunk.chunkType,
		toolName: chunk.toolName ?? null,
		content: chunk.content,
		ts: chunk.recordedAt ?? nowIso(),
	});
}

export interface TeamMessageTranscript {
	messageId: string;
	channel: string;
	fromAgent: string;
	messageType?: string | null;
	taskIdRef?: string | null;
	content: string;
	createdAt?: string;
}

export function recordTeamMessageTranscript(
	plotId: string | null | undefined,
	msg: TeamMessageTranscript,
): void {
	if (!plotId) return;
	appendLine(plotId, {
		_type: "team_message",
		messageId: msg.messageId,
		channel: msg.channel,
		fromAgent: msg.fromAgent,
		messageType: msg.messageType ?? null,
		taskIdRef: msg.taskIdRef ?? null,
		content: msg.content,
		ts: msg.createdAt ?? nowIso(),
	});
}
