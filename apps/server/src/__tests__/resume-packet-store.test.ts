import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const tmpDir = mkdtempSync(join(tmpdir(), "setra-resume-store-"));
mkdirSync(join(tmpDir, ".setra"), { recursive: true });
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DATA = process.env.SETRA_DATA_DIR;

import type * as StoreModule from "../lib/resume-packet-store.js";

let getRawDb: typeof import("@setra/db").getRawDb;
let primeResumePackets: typeof StoreModule.primeResumePackets;
let consumeResumePacketFor: typeof StoreModule.consumeResumePacketFor;
let listCachedResumePackets: typeof StoreModule.listCachedResumePackets;
let _resetResumePacketStore: typeof StoreModule._resetResumePacketStore;

beforeAll(async () => {
	process.env.HOME = tmpDir;
	process.env.SETRA_DATA_DIR = join(tmpDir, ".setra");
	process.env.JWT_SECRET = "x".repeat(32);
	const dbMod = await import("@setra/db");
	getRawDb = dbMod.getRawDb;
	dbMod.getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
	const schemaMod = await import("../db/schema.js");
	schemaMod.ensureTables();
	await dbMod.runMigrations();
	schemaMod.ensureTables();
	getRawDb().pragma("foreign_keys = OFF");
	const storeMod = await import("../lib/resume-packet-store.js");
	primeResumePackets = storeMod.primeResumePackets;
	consumeResumePacketFor = storeMod.consumeResumePacketFor;
	listCachedResumePackets = storeMod.listCachedResumePackets;
	_resetResumePacketStore = storeMod._resetResumePacketStore;
});

afterAll(() => {
	if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
	if (ORIGINAL_DATA !== undefined) process.env.SETRA_DATA_DIR = ORIGINAL_DATA;
	rmSync(tmpDir, { recursive: true, force: true });
});

const FRESH = new Date(Date.now() - 1_000).toISOString();

function reset(): void {
	const db = getRawDb();
	db.prepare("DELETE FROM runs").run();
	db.prepare("DELETE FROM review_items").run();
	_resetResumePacketStore();
}

function insertRun(id: string, agent: string): void {
	getRawDb()
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, started_at, updated_at)
             VALUES (?, ?, ?, 'running', ?, ?)`,
		)
		.run(id, `plot-${id}`, agent, FRESH, FRESH);
}

describe("resume-packet-store", () => {
	beforeEach(() => reset());

	it("primes one packet per agent and lists them", () => {
		insertRun("r1", "cto");
		insertRun("r2", "dev");
		const count = primeResumePackets();
		expect(count).toBe(2);
		const slugs = listCachedResumePackets()
			.map((p) => p.agentSlug)
			.sort();
		expect(slugs).toEqual(["cto", "dev"]);
	});

	it("consumes a packet exactly once per (companyId, agentSlug)", () => {
		insertRun("r1", "cto");
		primeResumePackets();
		const first = consumeResumePacketFor(null, "cto");
		expect(first?.agentSlug).toBe("cto");
		expect(first?.body).toContain("Session resumed");
		const second = consumeResumePacketFor(null, "cto");
		expect(second).toBeNull();
	});

	it("returns null when no packet exists for the agent", () => {
		insertRun("r1", "cto");
		primeResumePackets();
		expect(consumeResumePacketFor(null, "ghost")).toBeNull();
	});

	it("re-priming clears prior unconsumed packets", () => {
		insertRun("r1", "cto");
		primeResumePackets();
		expect(listCachedResumePackets()).toHaveLength(1);
		reset();
		// no runs now
		const count = primeResumePackets();
		expect(count).toBe(0);
		expect(consumeResumePacketFor(null, "cto")).toBeNull();
	});
});
