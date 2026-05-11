/**
 * plot-branch.test.ts — verifies POST /api/plots/:id/branch.
 *
 * Bootstraps a minimal SQL fixture (projects + plots + runs + marks),
 * invokes the route through Hono's fetch adapter, and asserts the new
 * plot row is created with branched_from_* metadata.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = ["HOME", "SETRA_DATA_DIR"] as const;
const savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-plotbranch-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");
});

afterEach(async () => {
	try {
		const { closeDb } = await import("@setra/db");
		closeDb();
	} catch {
		/* ignore */
	}
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

async function bootstrap() {
	const { getDb, getRawDb } = await import("@setra/db");
	getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
	const raw = getRawDb();
	raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      company_id TEXT
    );
    CREATE TABLE plots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_id TEXT NOT NULL,
      worktree_path TEXT,
      branch TEXT NOT NULL,
      base_branch TEXT NOT NULL,
      ground_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      agent_template TEXT,
      description TEXT,
      auto_checkpoint INTEGER NOT NULL DEFAULT 1,
      checkpoint_interval_s INTEGER NOT NULL DEFAULT 300,
      total_cost_usd REAL NOT NULL DEFAULT 0,
      last_active_at TEXT,
      claimed_by_session_id TEXT,
      branched_from_plot_id TEXT,
      branched_from_run_id TEXT,
      branched_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      plot_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      branch_name TEXT,
      status TEXT
    );
    CREATE TABLE marks (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      plot_id TEXT,
      commit_hash TEXT NOT NULL,
      branch TEXT NOT NULL,
      created_at TEXT
    );
  `);
	raw
		.prepare(`INSERT INTO projects (id, company_id) VALUES (?, ?)`)
		.run("proj-1", "co-1");
	raw
		.prepare(
			`INSERT INTO plots (id, name, project_id, branch, base_branch)
       VALUES (?, ?, ?, ?, ?)`,
		)
		.run("plot-src", "Source", "proj-1", "setra/plot-src", "main");
	raw
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, branch_name)
       VALUES (?, ?, ?, ?, ?)`,
		)
		.run("run-1", "plot-src", "eng", "completed", "setra/plot-src");
	raw
		.prepare(
			`INSERT INTO marks (id, run_id, plot_id, commit_hash, branch, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run("mark-1", "run-1", "plot-src", "deadbeef", "setra/plot-src", "now");
	return raw;
}

async function buildApp() {
	const { Hono } = await import("hono");
	const { plotsRoute } = await import("../routes/plots.js");
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("companyId", "co-1");
		await next();
	});
	app.route("/api/plots", plotsRoute);
	return app;
}

describe("POST /api/plots/:id/branch", () => {
	it("creates a new plot with branched_from_* set", async () => {
		const raw = await bootstrap();
		const app = await buildApp();

		const res = await app.request("/api/plots/plot-src/branch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fromRunId: "run-1", name: "fork-1" }),
		});

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			id: string;
			branchedFromPlotId: string;
			branchedFromRunId: string;
			baseBranch: string;
		};
		expect(body.branchedFromPlotId).toBe("plot-src");
		expect(body.branchedFromRunId).toBe("run-1");
		// baseBranch should be the mark's commit hash
		expect(body.baseBranch).toBe("deadbeef");

		const row = raw
			.prepare(
				`SELECT branched_from_plot_id, branched_from_run_id, branched_at, base_branch, name
           FROM plots WHERE id = ?`,
			)
			.get(body.id) as {
			branched_from_plot_id: string;
			branched_from_run_id: string;
			branched_at: string;
			base_branch: string;
			name: string;
		};
		expect(row.branched_from_plot_id).toBe("plot-src");
		expect(row.branched_from_run_id).toBe("run-1");
		expect(row.base_branch).toBe("deadbeef");
		expect(row.name).toBe("fork-1");
		expect(row.branched_at).toBeTruthy();
	});

	it("404s on unknown plot", async () => {
		await bootstrap();
		const app = await buildApp();
		const res = await app.request("/api/plots/missing/branch", {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});

	it("404s when plot belongs to a different company", async () => {
		const raw = await bootstrap();
		raw
			.prepare(`UPDATE projects SET company_id = ? WHERE id = ?`)
			.run("co-other", "proj-1");
		const app = await buildApp();
		const res = await app.request("/api/plots/plot-src/branch", {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});

	it("rejects fromRunId not belonging to the plot", async () => {
		const raw = await bootstrap();
		raw
			.prepare(
				`INSERT INTO plots (id, name, project_id, branch, base_branch)
         VALUES (?, ?, ?, ?, ?)`,
			)
			.run("plot-other", "Other", "proj-1", "setra/plot-other", "main");
		raw
			.prepare(
				`INSERT INTO runs (id, plot_id, agent, status) VALUES (?, ?, ?, ?)`,
			)
			.run("run-other", "plot-other", "eng", "completed");

		const app = await buildApp();
		const res = await app.request("/api/plots/plot-src/branch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ fromRunId: "run-other" }),
		});
		expect(res.status).toBe(400);
	});
});
