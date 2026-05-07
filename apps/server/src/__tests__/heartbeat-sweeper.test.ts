import Database from "better-sqlite3";
/**
 * Tests for heartbeat-sweeper.ts.
 *
 * Uses an in-memory better-sqlite3 connection so we can verify the sweep
 * SQL without touching the @setra/db singleton (cf. agent-lifecycle.test.ts
 * which does need that singleton).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sweepOnce } from "../lib/heartbeat-sweeper.js";

type Db = InstanceType<typeof Database>;

function makeDb(): Db {
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE runs (
      id            TEXT PRIMARY KEY,
      plot_id       TEXT,
      agent         TEXT,
      status        TEXT NOT NULL,
      updated_at    TEXT,
      ended_at      TEXT,
      error_message TEXT
    );
    CREATE TABLE agent_roster (
      id     TEXT PRIMARY KEY,
      slug   TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'idle'
    );
  `);
	return db;
}

describe("sweepOnce — heartbeat watchdog", () => {
	let db: Db;
	const NOW = Date.parse("2025-01-01T12:00:00.000Z");

	beforeEach(() => {
		db = makeDb();
	});

	it("fails stale running/pending runs and idles their agents", () => {
		const fresh = new Date(NOW - 60_000).toISOString(); // 1 min ago
		const stale = new Date(NOW - 10 * 60_000).toISOString(); // 10 min ago

		db.prepare(
			`INSERT INTO agent_roster (id, slug, status) VALUES ('a1','claude','running')`,
		).run();
		db.prepare(
			`INSERT INTO agent_roster (id, slug, status) VALUES ('a2','codex','running')`,
		).run();

		db.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, updated_at) VALUES (?,?,?,?,?)`,
		).run("r-fresh", "p1", "claude", "running", fresh);
		db.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, updated_at) VALUES (?,?,?,?,?)`,
		).run("r-stale", "p2", "codex", "running", stale);
		db.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, updated_at) VALUES (?,?,?,?,?)`,
		).run("r-pending-stale", "p3", "codex", "pending", stale);

		const result = sweepOnce(db as unknown as Db, 5 * 60_000, NOW);
		expect(result.failedRunIds.sort()).toEqual(["r-pending-stale", "r-stale"]);

		const rows = db
			.prepare(
				`SELECT id, status, error_message, ended_at FROM runs ORDER BY id`,
			)
			.all() as Array<{
			id: string;
			status: string;
			error_message: string | null;
			ended_at: string | null;
		}>;
		const fr = rows.find((r) => r.id === "r-fresh")!;
		const sr = rows.find((r) => r.id === "r-stale")!;
		expect(fr.status).toBe("running");
		expect(fr.error_message).toBeNull();
		expect(sr.status).toBe("failed");
		expect(sr.error_message).toMatch(/heartbeat timeout/);
		expect(sr.ended_at).toBe(new Date(NOW).toISOString());

		const claude = db
			.prepare(`SELECT status FROM agent_roster WHERE slug='claude'`)
			.get() as { status: string };
		const codex = db
			.prepare(`SELECT status FROM agent_roster WHERE slug='codex'`)
			.get() as { status: string };
		expect(claude.status).toBe("running"); // no failed runs for claude
		expect(codex.status).toBe("idle"); // codex had a failed run → freed
	});

	it("ignores completed/failed/cancelled runs even if their heartbeat is ancient", () => {
		const ancient = new Date(NOW - 60 * 60_000).toISOString();
		for (const s of ["completed", "failed", "cancelled"] as const) {
			db.prepare(
				`INSERT INTO runs (id, agent, status, updated_at) VALUES (?,?,?,?)`,
			).run(`r-${s}`, "claude", s, ancient);
		}
		const result = sweepOnce(db as unknown as Db, 5 * 60_000, NOW);
		expect(result.failedRunIds).toEqual([]);

		const rows = db
			.prepare(`SELECT id, status FROM runs ORDER BY id`)
			.all() as Array<{ id: string; status: string }>;
		expect(rows.map((r) => r.status).sort()).toEqual([
			"cancelled",
			"completed",
			"failed",
		]);
	});

	it("returns no failures when all heartbeats are within the window", () => {
		const recent = new Date(NOW - 30_000).toISOString();
		db.prepare(
			`INSERT INTO runs (id, agent, status, updated_at) VALUES ('r1','claude','running',?)`,
		).run(recent);
		db.prepare(
			`INSERT INTO runs (id, agent, status, updated_at) VALUES ('r2','codex','pending',?)`,
		).run(recent);

		const result = sweepOnce(db as unknown as Db, 5 * 60_000, NOW);
		expect(result.failedRunIds).toEqual([]);
	});

	it("keeps an agent running when another active run still exists", () => {
		const stale = new Date(NOW - 10 * 60_000).toISOString();
		const fresh = new Date(NOW - 30_000).toISOString();
		db.prepare(
			`INSERT INTO agent_roster (id, slug, status) VALUES ('a1','claude','running')`,
		).run();
		db.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, updated_at) VALUES (?,?,?,?,?)`,
		).run("r-stale", "p1", "claude", "running", stale);
		db.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, updated_at) VALUES (?,?,?,?,?)`,
		).run("r-fresh", "p2", "claude", "running", fresh);

		const result = sweepOnce(db as unknown as Db, 5 * 60_000, NOW);
		expect(result.failedRunIds).toEqual(["r-stale"]);

		const claude = db
			.prepare(`SELECT status FROM agent_roster WHERE slug='claude'`)
			.get() as { status: string };
		expect(claude.status).toBe("running");
	});
});
