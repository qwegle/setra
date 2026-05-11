/**
 * Cold-start integration test: a fresh data directory must boot through
 * ensureTables() THEN runMigrations() THEN seedBuiltins() — the order
 * apps/server/src/index.ts uses — without throwing.
 *
 * apps/server/src/db/client.ts opens its better-sqlite3 connection at
 * module-init time and caches it. Since vitest reuses module imports
 * across tests in a file, we use a single beforeAll/afterAll lifecycle
 * and a single tmp data directory for this entire file. That mirrors
 * production: the server boots once and reuses the connection.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENV_KEYS = ["HOME", "SETRA_DATA_DIR"] as const;
const savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;

beforeAll(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-coldstart-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");
	// Seed an empty company-settings file so company-settings.ts doesn't
	// accidentally read a developer's real ~/.setra/settings.json.
	writeFileSync(
		join(tmpDir, ".setra", "settings.json"),
		JSON.stringify({ version: 2, companies: {} }),
		"utf8",
	);
});

afterAll(async () => {
	try {
		const { closeDb } = await import("@setra/db");
		closeDb();
	} catch {
		/* never opened */
	}
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("cold-start", () => {
	it("boots a fresh database through ensureTables -> runMigrations -> seedBuiltins", async () => {
		const { getDb, getRawDb, runMigrations, seedBuiltins } = await import(
			"@setra/db"
		);
		getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });

		// Real boot order: ensureTables() first because migration 0009
		// references the ensureTables-owned `approvals` table.
		const { ensureTables } = await import("../db/schema.js");
		expect(() => ensureTables()).not.toThrow();

		await expect(runMigrations()).resolves.toBeUndefined();

		// Idempotent: ensureTables must run cleanly a second time after the
		// migration loop. Otherwise an in-place upgrade would crash on the
		// next process restart.
		expect(() => ensureTables()).not.toThrow();

		// seedBuiltins fills in the default company / agent templates.
		expect(() => seedBuiltins()).not.toThrow();
		expect(() => seedBuiltins()).not.toThrow();

		// Anchor tables that the rest of the app assumes exist after boot.
		const tables = (
			getRawDb()
				.prepare(
					`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'`,
				)
				.all() as Array<{ name: string }>
		).map((r) => r.name);
		expect(tables).toContain("board_projects");
		expect(tables).toContain("board_issues");
		expect(tables).toContain("runs");
		expect(tables).toContain("agent_roster");
		expect(tables).toContain("approvals");
	});
});
