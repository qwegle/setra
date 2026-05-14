/**
 * Tests for ensureGovernanceApproval — the central enforcement helper used by
 * routes/agents.ts (agent_hire) and any future deploy gate.
 *
 * Note: apps/server/src/db/client.ts opens its better-sqlite3 connection at
 * module-init time and binds to whatever SETRA_DATA_DIR is set then. Because
 * vitest caches dynamic imports across tests in a file, we set the temp dir
 * exactly once in beforeAll and reset per-test state via DELETE statements
 * and by rewriting ~/.setra/settings.json directly.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ENV_KEYS = ["HOME", "SETRA_DATA_DIR"] as const;
const savedEnv: Record<string, string | undefined> = {};
let tmpDir: string;
let raw: InstanceType<typeof Database>;

beforeAll(async () => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-gate-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
	process.env["SETRA_DATA_DIR"] = join(tmpDir, ".setra");

	const { getDb, getRawDb } = await import("@setra/db");
	getDb({ dbPath: join(tmpDir, ".setra", "setra.db") });
	raw = getRawDb();
	raw.exec(`
    CREATE TABLE board_issues (
      id TEXT PRIMARY KEY,
      title TEXT,
      slug TEXT,
      pr_url TEXT
    );
    CREATE TABLE review_items (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      type TEXT,
      entity_type TEXT,
      entity_id TEXT,
      title TEXT,
      description TEXT,
      requested_by TEXT,
      target_issue_slug TEXT,
      estimated_cost_usd REAL,
      diff TEXT,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      comment TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
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

beforeEach(() => {
	raw.exec("DELETE FROM review_items;");
	// Reset settings file so each test starts from a clean slate.
	writeFileSync(
		join(tmpDir, ".setra", "settings.json"),
		JSON.stringify({ version: 2, companies: {} }),
		"utf8",
	);
});

async function setSettings(
	companyId: string,
	settings: Record<string, unknown>,
) {
	const { setCompanySettings } = await import("../lib/company-settings.js");
	setCompanySettings(companyId, settings);
}

const baseInput = {
	companyId: "co-1",
	action: "agent_hire" as const,
	entityType: "agent_template",
	entityId: "tpl-1:fred",
	title: "Hire Fred",
	description: "Add a new engineer.",
	requestedBy: "human",
};

describe("ensureGovernanceApproval", () => {
	it("allows when companyId is null", async () => {
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const result = await ensureGovernanceApproval({
			...baseInput,
			companyId: null,
		});
		expect(result.allow).toBe(true);
	});

	it("allows when governance_auto_approve is set", async () => {
		await setSettings("co-1", { governance_auto_approve: true });
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const result = await ensureGovernanceApproval(baseInput);
		expect(result.allow).toBe(true);
	});

	it("creates a pending approval when gated", async () => {
		await setSettings("co-1", {});
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const result = await ensureGovernanceApproval(baseInput);
		expect(result.allow).toBe(false);
		expect(result.status).toBe("pending");
		expect(result.approvalId).toBeTruthy();

		const rows = raw
			.prepare(`SELECT type, status FROM review_items WHERE company_id = ?`)
			.all("co-1") as Array<{ type: string; status: string }>;
		expect(rows).toHaveLength(1);
		expect(rows[0]?.type).toBe("agent_hire");
		expect(rows[0]?.status).toBe("pending");
	});

	it("returns the existing pending approval on resubmit (idempotent)", async () => {
		await setSettings("co-1", {});
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const a = await ensureGovernanceApproval(baseInput);
		const b = await ensureGovernanceApproval(baseInput);
		expect(b.allow).toBe(false);
		expect(b.approvalId).toBe(a.approvalId);

		const count = (
			raw.prepare(`SELECT COUNT(*) AS n FROM review_items`).get() as {
				n: number;
			}
		).n;
		expect(count).toBe(1);
	});

	it("allows once the approval is marked approved", async () => {
		await setSettings("co-1", {});
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const first = await ensureGovernanceApproval(baseInput);
		expect(first.allow).toBe(false);

		raw
			.prepare(`UPDATE review_items SET status = 'approved' WHERE id = ?`)
			.run(first.approvalId);

		const second = await ensureGovernanceApproval(baseInput);
		expect(second.allow).toBe(true);
		expect(second.approvalId).toBe(first.approvalId);
	});

	it("blocks with status=rejected once the approval is rejected", async () => {
		await setSettings("co-1", {});
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const first = await ensureGovernanceApproval(baseInput);
		raw
			.prepare(`UPDATE review_items SET status = 'rejected' WHERE id = ?`)
			.run(first.approvalId);

		const second = await ensureGovernanceApproval(baseInput);
		expect(second.allow).toBe(false);
		expect(second.status).toBe("rejected");
	});

	it("respects a per-company approval-actions allowlist", async () => {
		await setSettings("co-1", {
			governance_approval_actions: ["pr_merge"],
		});
		const { ensureGovernanceApproval } = await import(
			"../lib/approval-gates.js"
		);
		const result = await ensureGovernanceApproval(baseInput);
		expect(result.allow).toBe(true);
	});
});
