/**
 * audit.ts — guaranteed activity logging for state-changing endpoints.
 *
 * Each entry records why the action happened, optional parent linkage, and a
 * hash pointer to the previous entry so the trail can be verified later.
 */

import { createHash, randomUUID } from "node:crypto";
import { getRawDb } from "@setra/db";
import type { Context } from "hono";
import { tryGetCompanyId } from "./company-scope.js";

export interface AuditEntry {
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

function normalizePayload(payload: unknown): {
	payloadJson: string | null;
	reason: string | null;
	parentId: string | null;
} {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return {
			payloadJson: payload === undefined ? null : JSON.stringify(payload),
			reason: null,
			parentId: null,
		};
	}
	const payloadRecord = { ...(payload as Record<string, unknown>) };
	const reason =
		typeof payloadRecord.reason === "string" ? payloadRecord.reason : null;
	const parentId =
		typeof payloadRecord.parent_id === "string"
			? payloadRecord.parent_id
			: typeof payloadRecord.parentId === "string"
				? payloadRecord.parentId
				: null;
	delete payloadRecord.reason;
	delete payloadRecord.parent_id;
	delete payloadRecord.parentId;
	return {
		payloadJson:
			Object.keys(payloadRecord).length > 0
				? JSON.stringify(payloadRecord)
				: null,
		reason,
		parentId,
	};
}

function getPreviousAuditEntry(): AuditEntry | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT id, company_id, issue_id, project_id, actor, event, entity_type, entity_id, payload, reason, parent_id, prev_hash, created_at
         FROM activity_log
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
			)
			.get() as AuditEntry | undefined) ?? null
	);
}

export function appendAuditEntry(input: {
	companyId: string | null;
	issueId?: string | null;
	projectId?: string | null;
	actor: string;
	action: string;
	entityType: string;
	entityId: string;
	payload?: unknown;
	reason?: string | null;
	parentId?: string | null;
}): AuditEntry {
	const meta = normalizePayload(input.payload);
	const previous = getPreviousAuditEntry();
	const createdAt = new Date().toISOString();
	const entry: AuditEntry = {
		id: randomUUID(),
		company_id: input.companyId,
		issue_id: input.issueId ?? null,
		project_id: input.projectId ?? null,
		actor: input.actor,
		event: input.action,
		entity_type: input.entityType,
		entity_id: input.entityId,
		payload: meta.payloadJson,
		reason: input.reason ?? meta.reason ?? input.action,
		parent_id: input.parentId ?? meta.parentId ?? null,
		prev_hash: previous ? hashAuditEntry(previous) : null,
		created_at: createdAt,
	};
	getRawDb()
		.prepare(
			`INSERT INTO activity_log
         (id, company_id, issue_id, project_id, actor, event, entity_type, entity_id, payload, reason, parent_id, prev_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			entry.id,
			entry.company_id,
			entry.issue_id,
			entry.project_id,
			entry.actor,
			entry.event,
			entry.entity_type,
			entry.entity_id,
			entry.payload,
			entry.reason,
			entry.parent_id,
			entry.prev_hash,
			entry.created_at,
		);
	return entry;
}

export async function logActivity(
	c: Context,
	action: string,
	entityType: string,
	entityId: string,
	payload?: unknown,
): Promise<void> {
	appendAuditEntry({
		companyId: tryGetCompanyId(c),
		actor: c.req.header("x-actor-id") ?? "system",
		action,
		entityType,
		entityId,
		payload,
	});
}

export function verifyAuditChain(entries: AuditEntry[]): {
	valid: boolean;
	index: number;
	expected: string | null;
	actual: string | null;
} {
	let previous: AuditEntry | null = null;
	for (const [index, entry] of entries.entries()) {
		const expected = previous ? hashAuditEntry(previous) : null;
		const actual = entry.prev_hash ?? null;
		if (expected !== actual) {
			return { valid: false, index, expected, actual };
		}
		previous = entry;
	}
	return { valid: true, index: -1, expected: null, actual: null };
}
