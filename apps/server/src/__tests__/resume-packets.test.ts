import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmpDir = mkdtempSync(join(tmpdir(), "setra-resume-"));
mkdirSync(join(tmpDir, ".setra"), { recursive: true });
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DATA = process.env.SETRA_DATA_DIR;

let getRawDb: typeof import("@setra/db").getRawDb;
import type { buildResumePackets as BuildResumePacketsType } from "../lib/resume-packets.js";
let buildResumePackets: typeof BuildResumePacketsType;
let RESUME_STALE_THRESHOLD_MS: number;

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
	const raw = getRawDb();
	raw.pragma("foreign_keys = OFF");
	const mod = await import("../lib/resume-packets.js");
	buildResumePackets = mod.buildResumePackets;
	RESUME_STALE_THRESHOLD_MS = mod.RESUME_STALE_THRESHOLD_MS;
});

afterAll(() => {
	if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
	if (ORIGINAL_DATA !== undefined) process.env.SETRA_DATA_DIR = ORIGINAL_DATA;
	rmSync(tmpDir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-05-10T15:00:00.000Z");
const FRESH = new Date(NOW - 1_000).toISOString();
let STALE = "";

beforeAll(() => {
	STALE = new Date(NOW - RESUME_STALE_THRESHOLD_MS - 1_000).toISOString();
});

function reset(): void {
	const db = getRawDb();
	db.prepare("DELETE FROM runs").run();
	db.prepare("DELETE FROM review_items").run();
}

function insertRun(
	id: string,
	agent: string,
	status: string,
	updatedAt: string,
): void {
	getRawDb()
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, started_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(id, `plot-${id}`, agent, status, updatedAt, updatedAt);
}

function insertApproval(
	id: string,
	type: string,
	requestedBy: string,
	createdAt: string,
	status = "pending",
): void {
	getRawDb()
		.prepare(
			`INSERT INTO review_items (id, company_id, type, title, description,
                requested_by, status, created_at, updated_at)
             VALUES (?, 'co-1', ?, ?, '', ?, ?, ?, ?)`,
		)
		.run(id, type, `${type}/${id}`, requestedBy, status, createdAt, createdAt);
}

describe("buildResumePackets", () => {
	it("returns no packets when nothing is in flight", () => {
		reset();
		expect(buildResumePackets(NOW)).toEqual([]);
	});

	it("emits a packet per agent with active runs", () => {
		reset();
		insertRun("run-a", "cto", "running", FRESH);
		insertRun("run-b", "cto", "pending", FRESH);
		insertRun("run-c", "dev", "running", FRESH);
		const packets = buildResumePackets(NOW);
		const slugs = packets.map((p) => p.agentSlug).sort();
		expect(slugs).toEqual(["cto", "dev"]);
		const cto = packets.find((p) => p.agentSlug === "cto");
		expect(cto?.activeRunIds.sort()).toEqual(["run-a", "run-b"]);
		expect(cto?.body).toContain("Session resumed");
	});

	it("drops stale runs older than 1h", () => {
		reset();
		insertRun("run-old", "cto", "running", STALE);
		insertRun("run-new", "cto", "running", FRESH);
		const packets = buildResumePackets(NOW);
		expect(packets).toHaveLength(1);
		expect(packets[0]?.activeRunIds).toEqual(["run-new"]);
	});

	it("includes pending approvals on the requester's packet", () => {
		reset();
		insertApproval("appr-1", "pr_merge", "ceo", FRESH);
		const packets = buildResumePackets(NOW);
		const ceo = packets.find((p) => p.agentSlug === "ceo");
		expect(ceo?.pendingApprovalIds).toEqual(["appr-1"]);
		expect(ceo?.body).toContain("Pending approval");
	});

	it("ignores resolved approvals and stale ones", () => {
		reset();
		insertApproval("appr-fresh-resolved", "pr_merge", "ceo", FRESH, "approved");
		insertApproval("appr-stale-pending", "pr_merge", "ceo", STALE, "pending");
		expect(buildResumePackets(NOW)).toEqual([]);
	});
});
