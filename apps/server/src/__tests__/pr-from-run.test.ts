/**
 * Integration test for pr-from-run: assembles a real bundle from an in-memory
 * SQLite, mocks GitHub fetch, and verifies the PR body contains the rendered
 * evidence markdown.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["HOME", "SETRA_DATA_DIR"] as const;
const savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;
let originalFetch: typeof fetch;

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-prfromrun-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");
	originalFetch = globalThis.fetch;
});

afterEach(async () => {
	try {
		const { closeDb } = await import("@setra/db");
		closeDb();
	} catch {
		/* ignore */
	}
	globalThis.fetch = originalFetch;
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
    CREATE TABLE agent_roster (
      slug TEXT PRIMARY KEY,
      company_id TEXT,
      display_name TEXT
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      status TEXT,
      started_at TEXT,
      ended_at TEXT,
      first_chunk_at TEXT,
      exit_code INTEGER,
      system_prompt TEXT,
      issue_id TEXT
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      content TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      tool_name TEXT,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      issue_id TEXT,
      agent_slug TEXT,
      name TEXT NOT NULL,
      mime_type TEXT,
      content TEXT,
      created_at TEXT
    );
  `);
	raw
		.prepare(
			`INSERT INTO agent_roster (slug, company_id, display_name) VALUES (?, ?, ?)`,
		)
		.run("eng", "co-1", "Engineer");
	raw
		.prepare(
			`INSERT INTO runs (id, agent, status, issue_id, system_prompt, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run("run-xyz", "eng", "success", "issue-1", "Be excellent.", "t0");
}

describe("openPullRequestFromRun", () => {
	it("opens a PR whose body is the rendered run evidence", async () => {
		await bootstrap();
		const { recordRunChunk } = await import("../lib/run-chunks.js");
		recordRunChunk({
			runId: "run-xyz",
			type: "tool_use",
			toolName: "edit",
			content: JSON.stringify({ path: "src/auth/login.ts" }),
		});
		recordRunChunk({
			runId: "run-xyz",
			type: "tool_result",
			content: "ok",
		});

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				html_url: "https://github.com/o/r/pull/42",
				number: 42,
				state: "open",
			}),
		} as Response);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const { openPullRequestFromRun } = await import("../lib/pr-from-run.js");
		const result = await openPullRequestFromRun({
			runId: "run-xyz",
			repoUrl: "github.com/o/r",
			token: "tok",
		});
		expect(result.prUrl).toBe("https://github.com/o/r/pull/42");
		expect(result.prNumber).toBe(42);
		expect(result.branch).toBe("setra/run-run-xyz");
		expect(result.bodyMarkdown).toContain("# Setra run evidence: run-xyz");
		expect(result.bodyMarkdown).toContain("src/auth/login.ts");
		expect(fetchMock).toHaveBeenCalledOnce();
		const callBody = JSON.parse(
			(fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string,
		);
		expect(callBody.head).toBe("setra/run-run-xyz");
		expect(callBody.body).toContain("Setra run evidence");
	});

	it("throws when the run is missing", async () => {
		await bootstrap();
		const { openPullRequestFromRun } = await import("../lib/pr-from-run.js");
		await expect(
			openPullRequestFromRun({
				runId: "ghost",
				repoUrl: "github.com/o/r",
				token: "tok",
			}),
		).rejects.toThrow(/Run not found/);
	});

	it("refuses to open a PR for an unsuccessful run", async () => {
		await bootstrap();
		const { getRawDb } = await import("@setra/db");
		getRawDb()
			.prepare(`UPDATE runs SET status = ? WHERE id = ?`)
			.run("error", "run-xyz");
		const { openPullRequestFromRun } = await import("../lib/pr-from-run.js");
		await expect(
			openPullRequestFromRun({
				runId: "run-xyz",
				repoUrl: "github.com/o/r",
				token: "tok",
			}),
		).rejects.toThrow(/only successful runs/);
	});
});
