/**
 * transcript-exporter.test.ts — verifies the JSONL projection writer.
 *
 * The exporter is wired through recordRunChunk and createMessage so a
 * single chunk write should produce both the SQL row and a transcript
 * line. We use SETRA_TRANSCRIPT_DIR to redirect output into a tmp dir.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = [
	"HOME",
	"SETRA_DATA_DIR",
	"SETRA_TRANSCRIPT_DIR",
	"SETRA_TRANSCRIPT_DISABLED",
] as const;
const savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;
let transcriptDir: string;

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-transcript-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	transcriptDir = join(tmpDir, "transcripts");
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");
	process.env["SETRA_TRANSCRIPT_DIR"] = transcriptDir;
});

afterEach(async () => {
	try {
		const { closeDb } = await import("@setra/db");
		closeDb();
	} catch {
		/* not yet imported */
	}
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

async function bootstrapDb() {
	const { getDb, getRawDb } = await import("@setra/db");
	getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
	const raw = getRawDb();
	raw.exec(`
    CREATE TABLE agent_roster (slug TEXT PRIMARY KEY, company_id TEXT);
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      plot_id TEXT,
      agent TEXT NOT NULL,
      task_id_ref TEXT,
      first_chunk_at TEXT,
      system_prompt TEXT
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      content TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      tool_name TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE team_messages (
      id TEXT PRIMARY KEY,
      plot_id TEXT,
      from_agent TEXT NOT NULL,
      channel TEXT NOT NULL,
      content TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      company_id TEXT,
      created_at TEXT NOT NULL,
      task_id_ref TEXT
    );
  `);
	raw
		.prepare(`INSERT INTO agent_roster (slug, company_id) VALUES (?, ?)`)
		.run("eng", "co-1");
	raw
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, task_id_ref) VALUES (?, ?, ?, ?)`,
		)
		.run("run-1", "plot-A", "eng", "task-42");
	return raw;
}

function readTranscriptLines(plotId: string): Array<Record<string, unknown>> {
	const file = join(transcriptDir, plotId, "transcript.jsonl");
	const raw = readFileSync(file, "utf8").trim();
	return raw
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("transcript-exporter", () => {
	it("writes a metadata header then a chunk line on the first recordRunChunk", async () => {
		await bootstrapDb();
		const { recordRunChunk } = await import("../lib/run-chunks.js");

		recordRunChunk({
			runId: "run-1",
			type: "assistant",
			content: "hello",
		});

		const lines = readTranscriptLines("plot-A");
		expect(lines.length).toBe(2);
		expect(lines[0]).toMatchObject({ _type: "metadata", plotId: "plot-A" });
		expect(lines[1]).toMatchObject({
			_type: "chunk",
			runId: "run-1",
			sequence: 0,
			chunkType: "assistant",
			content: "hello",
		});
	});

	it("appends multiple chunks in sequence", async () => {
		await bootstrapDb();
		const { recordRunChunk } = await import("../lib/run-chunks.js");

		recordRunChunk({ runId: "run-1", type: "input", content: "a" });
		recordRunChunk({
			runId: "run-1",
			type: "tool_use",
			content: "b",
			toolName: "bash",
		});

		const lines = readTranscriptLines("plot-A");
		const chunks = lines.filter((l) => l._type === "chunk");
		expect(chunks.length).toBe(2);
		expect(chunks[0]?.sequence).toBe(0);
		expect(chunks[1]).toMatchObject({
			sequence: 1,
			chunkType: "tool_use",
			toolName: "bash",
		});
	});

	it("records team messages with taskIdRef", async () => {
		await bootstrapDb();
		const { createMessage } = await import(
			"../repositories/collaboration.repo.js"
		);

		createMessage({
			channel: "#eng",
			content: "starting task",
			fromAgent: "eng",
			companyId: "co-1",
			plotId: "plot-A",
			taskIdRef: "task-42",
		});

		const lines = readTranscriptLines("plot-A");
		const msg = lines.find((l) => l._type === "team_message");
		expect(msg).toMatchObject({
			channel: "#eng",
			fromAgent: "eng",
			taskIdRef: "task-42",
			content: "starting task",
		});
	});

	it("respects SETRA_TRANSCRIPT_DISABLED", async () => {
		process.env["SETRA_TRANSCRIPT_DISABLED"] = "1";
		await bootstrapDb();
		const { recordRunChunk } = await import("../lib/run-chunks.js");
		recordRunChunk({ runId: "run-1", type: "assistant", content: "x" });
		const fs = await import("node:fs");
		expect(fs.existsSync(join(transcriptDir, "plot-A"))).toBe(false);
	});

	it("does not throw when the run has no plot", async () => {
		const raw = await bootstrapDb();
		raw
			.prepare(`INSERT INTO runs (id, plot_id, agent) VALUES (?, NULL, ?)`)
			.run("run-orphan", "eng");
		const { recordRunChunk } = await import("../lib/run-chunks.js");
		expect(() =>
			recordRunChunk({ runId: "run-orphan", type: "input", content: "x" }),
		).not.toThrow();
	});
});
