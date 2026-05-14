import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tmpDir: string;

async function loadModule() {
	vi.resetModules();
	tmpDir = mkdtempSync(join(tmpdir(), "setra-skill-promo-"));
	process.env.SETRA_DATA_DIR = tmpDir;
	const { rawSqlite } = await import("../../db/client.js");
	// CREATE TABLE matches the production schema (see db/schema.ts).
	rawSqlite.exec(`
		CREATE TABLE IF NOT EXISTS skills (
			id TEXT PRIMARY KEY,
			company_id TEXT,
			name TEXT NOT NULL,
			slug TEXT NOT NULL,
			description TEXT,
			category TEXT,
			trigger TEXT,
			prompt TEXT,
			is_active INTEGER NOT NULL DEFAULT 1,
			usage_count INTEGER NOT NULL DEFAULT 0,
			last_used_at TEXT,
			is_learned INTEGER NOT NULL DEFAULT 0,
			source_run_id TEXT,
			source_agent_slug TEXT,
			lessons_learned TEXT,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
	`);
	return { ...(await import("../skill-promotion.js")), rawSqlite };
}

const baseInput = {
	runId: "run-1",
	agentSlug: "backend",
	companyId: "company-A",
	outcome: "success" as const,
	issueTitle: "Fix login flake",
	skillTags: ["backend", "debugging"],
	lessonsLearned: "Wrap the retry in a backoff helper.",
	costUsd: 0.12,
	durationMs: 90_000,
};

beforeEach(() => {
	delete process.env.SETRA_DATA_DIR;
});

afterEach(() => {
	if (tmpDir) {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* best-effort */
		}
	}
});

describe("promoteReflectionToSkill", () => {
	it("inserts a learned skill row per skill tag on a successful run", async () => {
		const { promoteReflectionToSkill, rawSqlite } = await loadModule();
		const touched = promoteReflectionToSkill(baseInput);

		expect(touched.sort()).toEqual(["learned-backend", "learned-debugging"]);

		const rows = rawSqlite
			.prepare(
				`SELECT slug, is_learned, usage_count, source_run_id, source_agent_slug
				 FROM skills WHERE company_id = ? ORDER BY slug`,
			)
			.all("company-A") as Array<{
			slug: string;
			is_learned: number;
			usage_count: number;
			source_run_id: string;
			source_agent_slug: string;
		}>;
		expect(rows).toHaveLength(2);
		for (const row of rows) {
			expect(row.is_learned).toBe(1);
			expect(row.usage_count).toBe(1);
			expect(row.source_run_id).toBe("run-1");
			expect(row.source_agent_slug).toBe("backend");
		}
	});

	it("is idempotent on (companyId, slug) and increments usage_count", async () => {
		const { promoteReflectionToSkill, rawSqlite } = await loadModule();
		promoteReflectionToSkill(baseInput);
		promoteReflectionToSkill({ ...baseInput, runId: "run-2" });
		promoteReflectionToSkill({ ...baseInput, runId: "run-3" });

		const row = rawSqlite
			.prepare(
				`SELECT usage_count, source_run_id FROM skills
				 WHERE company_id = ? AND slug = ?`,
			)
			.get("company-A", "learned-backend") as
			| { usage_count: number; source_run_id: string }
			| undefined;
		expect(row).toBeDefined();
		expect(row?.usage_count).toBe(3);
		expect(row?.source_run_id).toBe("run-3");
	});

	it("skips promotion for failed outcomes", async () => {
		const { promoteReflectionToSkill, rawSqlite } = await loadModule();
		const touched = promoteReflectionToSkill({
			...baseInput,
			outcome: "failed",
		});
		expect(touched).toEqual([]);
		const count = (
			rawSqlite.prepare(`SELECT COUNT(*) as c FROM skills`).get() as {
				c: number;
			}
		).c;
		expect(count).toBe(0);
	});

	it("skips promotion for trivial cost or duration", async () => {
		const { promoteReflectionToSkill, rawSqlite } = await loadModule();
		expect(
			promoteReflectionToSkill({ ...baseInput, costUsd: 0.00001 }),
		).toEqual([]);
		expect(promoteReflectionToSkill({ ...baseInput, durationMs: 500 })).toEqual(
			[],
		);
		const count = (
			rawSqlite.prepare(`SELECT COUNT(*) as c FROM skills`).get() as {
				c: number;
			}
		).c;
		expect(count).toBe(0);
	});

	it("scopes promoted skills to companyId", async () => {
		const { promoteReflectionToSkill, rawSqlite } = await loadModule();
		promoteReflectionToSkill(baseInput);
		promoteReflectionToSkill({ ...baseInput, companyId: "company-B" });

		const companyACount = (
			rawSqlite
				.prepare(`SELECT COUNT(*) as c FROM skills WHERE company_id = ?`)
				.get("company-A") as { c: number }
		).c;
		const companyBCount = (
			rawSqlite
				.prepare(`SELECT COUNT(*) as c FROM skills WHERE company_id = ?`)
				.get("company-B") as { c: number }
		).c;
		expect(companyACount).toBe(2);
		expect(companyBCount).toBe(2);
	});
});

describe("listTopLearnedSkills", () => {
	it("returns top-K learned skills ordered by usage_count desc", async () => {
		const { promoteReflectionToSkill, listTopLearnedSkills } =
			await loadModule();
		// "backend" promoted 3×, "debugging" promoted 1×.
		promoteReflectionToSkill({ ...baseInput, skillTags: ["backend"] });
		promoteReflectionToSkill({
			...baseInput,
			runId: "r2",
			skillTags: ["backend"],
		});
		promoteReflectionToSkill({
			...baseInput,
			runId: "r3",
			skillTags: ["backend", "debugging"],
		});

		const top = listTopLearnedSkills("company-A", 5);
		expect(top.map((s) => s.slug)).toEqual([
			"learned-backend",
			"learned-debugging",
		]);
		expect(top[0]?.usage_count).toBe(3);
		expect(top[1]?.usage_count).toBe(1);
	});

	it("excludes learned skills from other companies", async () => {
		const { promoteReflectionToSkill, listTopLearnedSkills } =
			await loadModule();
		promoteReflectionToSkill(baseInput);
		promoteReflectionToSkill({ ...baseInput, companyId: "company-B" });

		const top = listTopLearnedSkills("company-A", 5);
		expect(top).toHaveLength(2);
		for (const skill of top) {
			expect(skill.source_agent_slug).toBe("backend");
		}
	});
});
