import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface AuditEntry {
	id: string;
	company_id: string | null;
	issue_id: string | null;
	project_id: string | null;
	actor: string;
	event: string;
	entity_type: string | null;
	entity_id: string | null;
	payload: string | null;
	reason: string | null;
	parent_id: string | null;
	prev_hash: string | null;
	created_at: string;
}

let db: Database.Database;

function createDb(): Database.Database {
	const nextDb = new Database(":memory:");
	nextDb.exec(`
		CREATE TABLE activity_log (
			id TEXT PRIMARY KEY,
			company_id TEXT,
			issue_id TEXT,
			project_id TEXT,
			actor TEXT NOT NULL,
			event TEXT NOT NULL,
			entity_type TEXT,
			entity_id TEXT,
			payload TEXT,
			reason TEXT,
			parent_id TEXT,
			prev_hash TEXT,
			created_at TEXT NOT NULL
		);
	`);
	return nextDb;
}

function hashAuditEntry(entry: AuditEntry): string {
	return createHash("sha256")
		.update(
			JSON.stringify({
				id: entry.id,
				company_id: entry.company_id,
				issue_id: entry.issue_id,
				project_id: entry.project_id,
				actor: entry.actor,
				event: entry.event,
				entity_type: entry.entity_type,
				entity_id: entry.entity_id,
				payload: entry.payload,
				reason: entry.reason,
				parent_id: entry.parent_id,
				prev_hash: entry.prev_hash,
				created_at: entry.created_at,
			}),
		)
		.digest("hex");
}

async function loadAuditModule() {
	vi.resetModules();
	vi.doMock("@setra/db", () => ({
		getRawDb: () => db,
	}));
	return import("../audit.js");
}

beforeEach(() => {
	db = createDb();
});

afterEach(() => {
	db.close();
	vi.restoreAllMocks();
});

describe("audit trail", () => {
	it("writes entries with the expected fields", async () => {
		const { appendAuditEntry } = await loadAuditModule();
		const entry = appendAuditEntry({
			companyId: "co-1",
			issueId: "iss-1",
			projectId: "proj-1",
			actor: "user-1",
			action: "issue.updated",
			entityType: "issue",
			entityId: "iss-1",
			payload: { status: "done" },
			reason: "manual update",
			parentId: "parent-1",
		});

		const saved = db
			.prepare(
				"SELECT company_id, issue_id, project_id, actor, event, entity_type, entity_id, payload, reason, parent_id FROM activity_log WHERE id = ?",
			)
			.get(entry.id) as Record<string, string | null>;
		expect(saved.company_id).toBe("co-1");
		expect(saved.issue_id).toBe("iss-1");
		expect(saved.project_id).toBe("proj-1");
		expect(saved.actor).toBe("user-1");
		expect(saved.event).toBe("issue.updated");
		expect(saved.entity_type).toBe("issue");
		expect(saved.entity_id).toBe("iss-1");
		expect(saved.payload).toBe(JSON.stringify({ status: "done" }));
		expect(saved.reason).toBe("manual update");
		expect(saved.parent_id).toBe("parent-1");
	});

	it("computes the hash chain from the previous entry", async () => {
		const { appendAuditEntry } = await loadAuditModule();
		const first = appendAuditEntry({
			companyId: "co-1",
			actor: "user-1",
			action: "issue.created",
			entityType: "issue",
			entityId: "iss-1",
		});
		const second = appendAuditEntry({
			companyId: "co-1",
			actor: "user-2",
			action: "issue.updated",
			entityType: "issue",
			entityId: "iss-1",
		});

		expect(second.prev_hash).toBe(hashAuditEntry(first as AuditEntry));
	});

	it("verifies a valid audit chain", async () => {
		const { appendAuditEntry, verifyAuditChain } = await loadAuditModule();
		const entries = [
			appendAuditEntry({
				companyId: "co-1",
				actor: "user-1",
				action: "issue.created",
				entityType: "issue",
				entityId: "iss-1",
			}),
			appendAuditEntry({
				companyId: "co-1",
				actor: "user-2",
				action: "issue.updated",
				entityType: "issue",
				entityId: "iss-1",
			}),
		];

		expect(verifyAuditChain(entries as AuditEntry[])).toMatchObject({
			valid: true,
			index: -1,
		});
	});

	it("detects tampered audit chains", async () => {
		const { appendAuditEntry, verifyAuditChain } = await loadAuditModule();
		const entries = [
			appendAuditEntry({
				companyId: "co-1",
				actor: "user-1",
				action: "issue.created",
				entityType: "issue",
				entityId: "iss-1",
			}),
			appendAuditEntry({
				companyId: "co-1",
				actor: "user-2",
				action: "issue.updated",
				entityType: "issue",
				entityId: "iss-1",
			}),
		] as AuditEntry[];
		const tampered = entries.map((entry) => ({ ...entry }));
		tampered[1] = { ...tampered[1]!, prev_hash: "tampered" };

		expect(verifyAuditChain(tampered)).toMatchObject({
			valid: false,
			index: 1,
			actual: "tampered",
		});
	});
});
