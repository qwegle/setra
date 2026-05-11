import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmpDir = mkdtempSync(join(tmpdir(), "setra-durability-"));
mkdirSync(join(tmpDir, ".setra"), { recursive: true });
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DATA = process.env.SETRA_DATA_DIR;

let getRawDb: typeof import("@setra/db").getRawDb;
let ensureTables: typeof import("../db/schema.js").ensureTables;
let runMigrations: typeof import("@setra/db").runMigrations;
import type { checkPostTurnDurability as CheckPostTurnDurabilityType } from "../lib/post-turn-durability.js";
let checkPostTurnDurability: typeof CheckPostTurnDurabilityType;

beforeAll(async () => {
	process.env.HOME = tmpDir;
	process.env.SETRA_DATA_DIR = join(tmpDir, ".setra");
	process.env.JWT_SECRET = "x".repeat(32);
	const dbMod = await import("@setra/db");
	getRawDb = dbMod.getRawDb;
	runMigrations = dbMod.runMigrations;
	dbMod.getDb();
	const schemaMod = await import("../db/schema.js");
	ensureTables = schemaMod.ensureTables;
	const durMod = await import("../lib/post-turn-durability.js");
	checkPostTurnDurability = durMod.checkPostTurnDurability;
	ensureTables();
	runMigrations();
	getRawDb().pragma("foreign_keys = OFF");
});

afterAll(() => {
	if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
	if (ORIGINAL_DATA !== undefined) process.env.SETRA_DATA_DIR = ORIGINAL_DATA;
	rmSync(tmpDir, { recursive: true, force: true });
});

function insertRun(
	id: string,
	opts: { toolCalls?: number; filesTouched?: number } = {},
): void {
	const db = getRawDb();
	db.prepare(
		`INSERT INTO runs (id, plot_id, agent, status, started_at, updated_at,
            tool_calls_count, files_touched_count)
         VALUES (?, ?, 'cto', 'running', strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?)`,
	).run(id, `plot-${id}`, opts.toolCalls ?? 0, opts.filesTouched ?? 0);
}

function insertChunk(runId: string, sequence: number): void {
	const db = getRawDb();
	db.prepare(
		`INSERT INTO chunks (run_id, sequence, content)
         VALUES (?, ?, 'hello')`,
	).run(runId, sequence);
}

describe("checkPostTurnDurability", () => {
	it("flags a run with no chunks, no tool calls, no files touched as non-durable", () => {
		insertRun("run-empty");
		const r = checkPostTurnDurability("run-empty");
		expect(r.durable).toBe(false);
		expect(r.chunkCount).toBe(0);
		expect(r.toolCallCount).toBe(0);
		expect(r.filesTouched).toBe(0);
		expect(r.reason).toBeTruthy();
	});

	it("treats any chunks as durable evidence", () => {
		insertRun("run-with-chunks");
		insertChunk("run-with-chunks", 0);
		const r = checkPostTurnDurability("run-with-chunks");
		expect(r.durable).toBe(true);
		expect(r.chunkCount).toBe(1);
	});

	it("treats tool_calls_count > 0 as durable evidence", () => {
		insertRun("run-with-tools", { toolCalls: 3 });
		const r = checkPostTurnDurability("run-with-tools");
		expect(r.durable).toBe(true);
		expect(r.toolCallCount).toBe(3);
	});

	it("treats files_touched_count > 0 as durable evidence", () => {
		insertRun("run-with-files", { filesTouched: 2 });
		const r = checkPostTurnDurability("run-with-files");
		expect(r.durable).toBe(true);
		expect(r.filesTouched).toBe(2);
	});

	it("returns non-durable for an unknown run id rather than crashing", () => {
		const r = checkPostTurnDurability("does-not-exist");
		expect(r.durable).toBe(false);
		expect(r.chunkCount).toBe(0);
	});
});
