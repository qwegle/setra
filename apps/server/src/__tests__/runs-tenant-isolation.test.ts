/**
 * Tenant-isolation tests for /api/runs/* endpoints.
 *
 * Asserts that a caller scoped to company A cannot read run data
 * (header, chunks, or evidence bundle) that belongs to company B.
 * Cross-tenant requests are rejected with 404 (not 403) to avoid
 * disclosing the existence of ids that belong to other tenants.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmpDir = mkdtempSync(join(tmpdir(), "setra-runs-tenant-"));
mkdirSync(join(tmpDir, ".setra"), { recursive: true });
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DATA = process.env.SETRA_DATA_DIR;
const ORIGINAL_JWT = process.env.JWT_SECRET;

// biome-ignore lint/suspicious/noExplicitAny: test scaffolding
let app: any;

beforeAll(async () => {
	process.env.HOME = tmpDir;
	process.env.SETRA_DATA_DIR = join(tmpDir, ".setra");
	process.env.JWT_SECRET = "x".repeat(32);
	const dbMod = await import("@setra/db");
	dbMod.getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
	const schemaMod = await import("../db/schema.js");
	schemaMod.ensureTables();
	await dbMod.runMigrations();
	schemaMod.ensureTables();
	const raw = dbMod.getRawDb();
	raw.pragma("foreign_keys = OFF");
	raw
		.prepare(
			`INSERT INTO agent_roster (id, slug, display_name, company_id, status)
             VALUES ('a-a', 'dev-a', 'Dev A', 'co-a', 'active'),
                    ('a-b', 'dev-b', 'Dev B', 'co-b', 'active')`,
		)
		.run();
	const now = new Date().toISOString();
	raw
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, started_at, updated_at)
             VALUES ('run-a', 'p-a', 'dev-a', 'completed', ?, ?),
                    ('run-b', 'p-b', 'dev-b', 'completed', ?, ?)`,
		)
		.run(now, now, now, now);
	const routesMod = await import("../routes/runs.js");
	const { Hono } = await import("hono");
	app = new Hono();
	app.use("*", async (c: any, next: any) => {
		const tenant = c.req.header("x-test-tenant");
		if (tenant) c.set("companyId", tenant);
		return next();
	});
	app.route("/api/runs", routesMod.runsRoute);
});

afterAll(() => {
	if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
	if (ORIGINAL_DATA !== undefined) process.env.SETRA_DATA_DIR = ORIGINAL_DATA;
	if (ORIGINAL_JWT !== undefined) process.env.JWT_SECRET = ORIGINAL_JWT;
	rmSync(tmpDir, { recursive: true, force: true });
});

function asCompany(path: string, tenant: string) {
	return app.request(path, {
		method: "GET",
		headers: { "x-test-tenant": tenant },
	});
}

describe("/api/runs tenant isolation", () => {
	it("returns 404 when company A asks for company B's run header", async () => {
		const res = await asCompany("/api/runs/run-b", "co-a");
		expect(res.status).toBe(404);
	});

	it("allows company A to read its own run header", async () => {
		const res = await asCompany("/api/runs/run-a", "co-a");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; run: { id: string } };
		expect(body.ok).toBe(true);
		expect(body.run.id).toBe("run-a");
	});

	it("rejects cross-tenant chunks and bundle lookups with 404", async () => {
		const r1 = await asCompany("/api/runs/run-b/chunks", "co-a");
		const r2 = await asCompany("/api/runs/run-b/bundle", "co-a");
		expect(r1.status).toBe(404);
		expect(r2.status).toBe(404);
	});

	it("treats unknown ids as 404 (no information leak)", async () => {
		const res = await asCompany("/api/runs/does-not-exist", "co-a");
		expect(res.status).toBe(404);
	});
});
