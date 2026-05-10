/**
 * Cold-start integration test: a fresh data dir must boot through every
 * SQL migration AND the server-local ensureTables() pass without throwing.
 *
 * This guards the seam where packages/db/migrations/*.sql and
 * apps/server/src/db/schema.ts:ensureTables() must agree about column
 * names and idempotent ALTERs. It also serves as smoke coverage for
 * seedBuiltins() so a brand-new install always has a default company.
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
	tmpDir = mkdtempSync(join(tmpdir(), "setra-coldstart-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");
});

afterEach(async () => {
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
	it("runs all SQL migrations on an empty database", async () => {
		const { getDb, runMigrations, getRawDb } = await import("@setra/db");
		getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });

		await expect(runMigrations()).resolves.toBeUndefined();

		const tables = (
			getRawDb()
				.prepare(
					`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'`,
				)
				.all() as Array<{ name: string }>
		).map((r) => r.name);

		// Spot-check: anchor tables that the rest of the app assumes exist.
		// agent_roster lives in apps/server/src/db/schema.ts ensureTables(),
		// not in the SQL migrations, so we only assert the migration-owned set
		// here. The third test below verifies ensureTables() layers on top.
		expect(tables).toContain("board_projects");
		expect(tables).toContain("board_issues");
		expect(tables).toContain("runs");
	});

	it("seeds builtins on a fresh database", async () => {
		const { getDb, runMigrations, seedBuiltins, getRawDb } = await import(
			"@setra/db"
		);
		getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
		await runMigrations();

		expect(() => seedBuiltins()).not.toThrow();

		// seedBuiltins is idempotent — second call must be a no-op.
		expect(() => seedBuiltins()).not.toThrow();
	});

	it("ensureTables() runs cleanly after migrations", async () => {
		const { getDb, runMigrations } = await import("@setra/db");
		getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
		await runMigrations();

		const { ensureTables } = await import("../db/schema.js");
		// Idempotent: must succeed twice without ALTER duplicate-column errors
		// escaping the try/catch in the migration loop.
		expect(() => ensureTables()).not.toThrow();
		expect(() => ensureTables()).not.toThrow();
	});
});
