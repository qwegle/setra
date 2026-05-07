import * as crypto from "node:crypto";
import { getRawDb } from "@setra/db";

export interface WebhookEventRecord {
	id: string;
	integration_id: string;
	company_id: string;
	direction: "inbound" | "outbound";
	event_name: string | null;
	target_url: string | null;
	payload: string | null;
	status: string;
	issue_id: string | null;
	response_status: number | null;
	error_message: string | null;
	created_at: string;
}

let eventsTableReady = false;

export function ensureWebhookEventsTable(): void {
	if (eventsTableReady) return;
	const db = getRawDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS webhook_events (
			id TEXT PRIMARY KEY,
			integration_id TEXT NOT NULL,
			company_id TEXT NOT NULL,
			direction TEXT NOT NULL DEFAULT 'inbound',
			event_name TEXT,
			target_url TEXT,
			payload TEXT,
			status TEXT DEFAULT 'received',
			issue_id TEXT,
			response_status INTEGER,
			error_message TEXT,
			created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE INDEX IF NOT EXISTS idx_webhook_events_company_created
			ON webhook_events (company_id, created_at DESC);
	`);
	eventsTableReady = true;
}

export function createWebhookEvent(input: {
	integrationId: string;
	companyId: string;
	direction: "inbound" | "outbound";
	eventName?: string | null;
	targetUrl?: string | null;
	payload?: unknown;
	status?: string;
	issueId?: string | null;
	responseStatus?: number | null;
	errorMessage?: string | null;
}): string {
	ensureWebhookEventsTable();
	const id = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT INTO webhook_events
				(id, integration_id, company_id, direction, event_name, target_url, payload, status, issue_id, response_status, error_message)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			input.integrationId,
			input.companyId,
			input.direction,
			input.eventName ?? null,
			input.targetUrl ?? null,
			input.payload === undefined ? null : JSON.stringify(input.payload),
			input.status ?? "received",
			input.issueId ?? null,
			input.responseStatus ?? null,
			input.errorMessage ?? null,
		);
	return id;
}

export function updateWebhookEvent(
	id: string,
	updates: {
		status?: string;
		issueId?: string | null;
		responseStatus?: number | null;
		errorMessage?: string | null;
	},
): void {
	ensureWebhookEventsTable();
	getRawDb()
		.prepare(
			`UPDATE webhook_events
			SET status = COALESCE(?, status),
				issue_id = COALESCE(?, issue_id),
				response_status = COALESCE(?, response_status),
				error_message = COALESCE(?, error_message)
			WHERE id = ?`,
		)
		.run(
			updates.status ?? null,
			updates.issueId ?? null,
			updates.responseStatus ?? null,
			updates.errorMessage ?? null,
			id,
		);
}

export function listWebhookEvents(
	companyId: string,
	limit = 50,
): WebhookEventRecord[] {
	ensureWebhookEventsTable();
	return getRawDb()
		.prepare(
			`SELECT id, integration_id, company_id, direction, event_name, target_url, payload, status, issue_id, response_status, error_message, created_at
			FROM webhook_events
			WHERE company_id = ?
			ORDER BY created_at DESC
			LIMIT ?`,
		)
		.all(companyId, limit) as WebhookEventRecord[];
}
