/**
 * Tests for run-bundle.ts — assembles the SDLC evidence pack from
 * recorded chunks plus linked artifacts.
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
	tmpDir = mkdtempSync(join(tmpdir(), "setra-bundle-"));
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
		.run("run-1", "eng", "completed", "issue-1", "You are an engineer.", "t0");
	return raw;
}

describe("assembleRunBundle", () => {
	it("returns null when the run does not exist", async () => {
		await bootstrap();
		const { assembleRunBundle } = await import("../lib/run-bundle.js");
		expect(assembleRunBundle("nope")).toBeNull();
	});

	it("collects chunks, tool calls, files touched, and artifacts", async () => {
		const raw = await bootstrap();
		const { recordRunChunk } = await import("../lib/run-chunks.js");
		const { assembleRunBundle } = await import("../lib/run-bundle.js");

		recordRunChunk({
			runId: "run-1",
			type: "input",
			content: "Edit the auth module",
		});
		recordRunChunk({
			runId: "run-1",
			type: "assistant",
			content: "Reading the file...",
		});
		recordRunChunk({
			runId: "run-1",
			type: "tool_use",
			toolName: "edit",
			content: JSON.stringify({ path: "src/auth/login.ts", new_str: "x" }),
		});
		recordRunChunk({
			runId: "run-1",
			type: "tool_result",
			content: "ok",
		});
		recordRunChunk({
			runId: "run-1",
			type: "tool_use",
			toolName: "bash",
			content: "pnpm test src/auth/login.test.ts",
		});
		recordRunChunk({
			runId: "run-1",
			type: "tool_result",
			content: "1 passed",
		});

		// Linked artifact (commit record) for the same issue.
		raw
			.prepare(
				`INSERT INTO artifacts (id, company_id, issue_id, name, mime_type, content, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"art-1",
				"co-1",
				"issue-1",
				"commit:abcd1234",
				"application/vnd.setra.commit+json",
				"{}",
				"t1",
			);

		const bundle = assembleRunBundle("run-1");
		expect(bundle).not.toBeNull();
		expect(bundle?.run.agentSlug).toBe("eng");
		expect(bundle?.run.companyId).toBe("co-1");
		expect(bundle?.systemPrompt).toBe("You are an engineer.");
		expect(bundle?.chunks).toHaveLength(6);
		expect(bundle?.toolCalls).toHaveLength(2);
		expect(bundle?.toolCalls[0]?.toolName).toBe("edit");
		expect(bundle?.toolCalls[0]?.output).toBe("ok");
		expect(bundle?.toolCalls[1]?.toolName).toBe("bash");
		expect(bundle?.toolCalls[1]?.output).toBe("1 passed");

		const paths = bundle?.filesTouched.map((f) => f.path) ?? [];
		expect(paths).toContain("src/auth/login.ts");
		expect(paths).toContain("src/auth/login.test.ts");

		expect(bundle?.artifacts).toHaveLength(1);
		expect(bundle?.artifacts[0]?.name).toBe("commit:abcd1234");

		expect(bundle?.stats.chunkCount).toBe(6);
		expect(bundle?.stats.toolCallCount).toBe(2);
		expect(bundle?.stats.fileCount).toBeGreaterThanOrEqual(2);
		expect(bundle?.stats.artifactCount).toBe(1);
	});

	it("returns an empty toolCalls list when no tool_use chunks exist", async () => {
		await bootstrap();
		const { recordRunChunk } = await import("../lib/run-chunks.js");
		const { assembleRunBundle } = await import("../lib/run-bundle.js");

		recordRunChunk({ runId: "run-1", type: "assistant", content: "thinking" });
		const bundle = assembleRunBundle("run-1");
		expect(bundle?.toolCalls).toHaveLength(0);
		expect(bundle?.filesTouched).toHaveLength(0);
	});
});
