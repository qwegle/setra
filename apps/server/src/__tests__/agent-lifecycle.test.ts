/**
 * Tests for agent-lifecycle.ts.
 *
 * The lifecycle module talks to two singletons (the @setra/db connection
 * and the server-local rawSqlite connection in apps/server/src/db/client.ts),
 * both of which read $HOME / SETRA_DATA_DIR at module-import time. So we
 * set those BEFORE any local import, then dynamically import the module so
 * the singletons bind to the per-test directory.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = [
	"HOME",
	"SETRA_DATA_DIR",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"OPENROUTER_API_KEY",
	"GROQ_API_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-lifecycle-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");
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

describe("recheckAvailability — smart auto-start on key save", () => {
	it("flips awaiting_key agents to idle once a provider key appears", async () => {
		const { getDb, getRawDb } = await import("@setra/db");
		getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
		const raw = getRawDb();

		raw.exec(`
      CREATE TABLE agent_roster (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        adapter_type TEXT NOT NULL,
        model_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        paused_reason TEXT,
        company_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

		raw
			.prepare(
				`INSERT INTO agent_roster (id, slug, adapter_type, model_id, status) VALUES (?, ?, 'auto', NULL, 'awaiting_key')`,
			)
			.run("a1", "ceo");
		raw
			.prepare(
				`INSERT INTO agent_roster (id, slug, adapter_type, model_id, status) VALUES (?, ?, 'auto', NULL, 'idle')`,
			)
			.run("a2", "engineer");

		// No keys yet → recheck should not activate anything.
		const { recheckAvailability } = await import("../lib/agent-lifecycle.js");
		expect(recheckAvailability().activated).toBe(0);

		// Save a key, recheck should activate the awaiting_key one only.
		process.env["GROQ_API_KEY"] = "gsk-test";
		const r2 = recheckAvailability();
		expect(r2.examined).toBe(1);
		expect(r2.activated).toBe(1);
		expect(r2.agents[0]?.adapter).toBe("groq");

		const ceo = raw
			.prepare(`SELECT status, adapter_type FROM agent_roster WHERE slug='ceo'`)
			.get() as { status: string; adapter_type: string };
		expect(ceo.status).toBe("idle");
		expect(ceo.adapter_type).toBe("groq");
	});
});

describe("pauseAllAgents — budget hard-stop", () => {
	it("pauses idle/running agents and cancels pending/running runs", async () => {
		const { getDb, getRawDb } = await import("@setra/db");
		getDb({ dbPath: join(tmpDir, ".setra", "setra-2.db") });
		const raw = getRawDb();

		raw.exec(`
      CREATE TABLE agent_roster (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        adapter_type TEXT NOT NULL,
        model_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        paused_reason TEXT,
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at TEXT,
        ended_at TEXT
      );
    `);

		raw
			.prepare(
				`INSERT INTO agent_roster (id, slug, adapter_type, status) VALUES (?, ?, 'claude_local', 'idle')`,
			)
			.run("a1", "alpha");
		raw
			.prepare(
				`INSERT INTO agent_roster (id, slug, adapter_type, status) VALUES (?, ?, 'claude_local', 'running')`,
			)
			.run("a2", "beta");
		raw
			.prepare(
				`INSERT INTO agent_roster (id, slug, adapter_type, status) VALUES (?, ?, 'claude_local', 'awaiting_key')`,
			)
			.run("a3", "gamma");
		raw
			.prepare(`INSERT INTO runs (id, status) VALUES (?, ?)`)
			.run("r1", "pending");
		raw
			.prepare(`INSERT INTO runs (id, status) VALUES (?, ?)`)
			.run("r2", "running");
		raw
			.prepare(`INSERT INTO runs (id, status) VALUES (?, ?)`)
			.run("r3", "completed");

		const { pauseAllAgents } = await import("../lib/agent-lifecycle.js");
		const result = pauseAllAgents("budget_hard_stop: $10 >= $10");
		expect(result.agentsPaused).toBe(2); // alpha + beta, NOT gamma (awaiting_key untouched)
		expect(result.runsCancelled).toBe(2); // r1 + r2

		const states = raw
			.prepare(
				`SELECT slug, status, paused_reason FROM agent_roster ORDER BY slug`,
			)
			.all() as Array<{
			slug: string;
			status: string;
			paused_reason: string | null;
		}>;
		expect(states.find((s) => s.slug === "alpha")?.status).toBe("paused");
		expect(states.find((s) => s.slug === "beta")?.status).toBe("paused");
		expect(states.find((s) => s.slug === "gamma")?.status).toBe("awaiting_key");
		expect(states.find((s) => s.slug === "alpha")?.paused_reason).toContain(
			"budget_hard_stop",
		);

		const cancelled = raw
			.prepare(`SELECT count(*) as n FROM runs WHERE status='cancelled'`)
			.get() as { n: number };
		expect(cancelled.n).toBe(2);
	});
});
