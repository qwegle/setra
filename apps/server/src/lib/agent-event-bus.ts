/**
 * agent-event-bus.ts — publish/subscribe event system for agent communication.
 *
 * Agents publish typed events (task started, PR created, help needed, …) and
 * subscribe to their inbox.  Events are persisted in `agent_events`; delivery
 * acknowledgements live in `agent_event_acks`.  All queries are scoped to a
 * companyId so data never leaks across tenants.
 */

import { getRawDb } from "@setra/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentEventType =
	| "task_started"
	| "task_completed"
	| "task_failed"
	| "pr_created"
	| "pr_reviewed"
	| "pr_merged"
	| "help_needed"
	| "insight"
	| "handoff"
	| "status_update"
	| "escalation";

export interface AgentEvent {
	id: string;
	companyId: string;
	eventType: AgentEventType;
	sourceAgent: string;
	targetAgent?: string;
	issueId?: string;
	runId?: string;
	payload: Record<string, unknown>;
	createdAt: string;
}

// ─── Internal row shape returned by better-sqlite3 ───────────────────────────

interface AgentEventRow {
	id: string;
	company_id: string;
	event_type: string;
	source_agent: string;
	target_agent: string | null;
	issue_id: string | null;
	run_id: string | null;
	payload: string | null;
	created_at: string;
}

function rowToEvent(row: AgentEventRow): AgentEvent {
	let payload: Record<string, unknown> = {};
	try {
		payload = JSON.parse(row.payload ?? "{}") as Record<string, unknown>;
	} catch {
		/* malformed payload — skip */
	}
	const event: AgentEvent = {
		id: row.id,
		companyId: row.company_id,
		eventType: row.event_type as AgentEventType,
		sourceAgent: row.source_agent,
		payload,
		createdAt: row.created_at,
	};
	if (row.target_agent !== null) event.targetAgent = row.target_agent;
	if (row.issue_id !== null) event.issueId = row.issue_id;
	if (row.run_id !== null) event.runId = row.run_id;
	return event;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Publish an event.  Returns the generated event id.
 */
export function publishEvent(
	event: Omit<AgentEvent, "id" | "createdAt">,
): string {
	const id = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT INTO agent_events
         (id, company_id, event_type, source_agent, target_agent,
          issue_id, run_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			event.companyId,
			event.eventType,
			event.sourceAgent,
			event.targetAgent ?? null,
			event.issueId ?? null,
			event.runId ?? null,
			JSON.stringify(event.payload),
		);
	return id;
}

/**
 * Return events an agent hasn't acked yet.
 *
 * Includes:
 *  - Broadcast events (no targetAgent) not yet acked by this agent
 *  - Direct events explicitly targeting this agent not yet acked
 *
 * If `since` (ISO timestamp) is provided, only events after that point are
 * returned — useful for polling without re-processing old history.
 */
export function getAgentInbox(
	agentSlug: string,
	companyId: string,
	since?: string,
): AgentEvent[] {
	const sinceClause = since ? `AND ae.created_at > ?` : "";
	const params: unknown[] = [companyId, agentSlug, agentSlug];
	if (since) params.push(since);

	const rows = getRawDb()
		.prepare(
			`SELECT ae.*
       FROM agent_events ae
      WHERE ae.company_id = ?
        AND (ae.target_agent IS NULL OR ae.target_agent = ?)
        AND ae.source_agent != ?
        AND NOT EXISTS (
          SELECT 1 FROM agent_event_acks ack
           WHERE ack.event_id = ae.id AND ack.agent_slug = ?
        )
        ${sinceClause}
      ORDER BY ae.created_at ASC`,
		)
		.all(...params, agentSlug) as AgentEventRow[];

	return rows.map(rowToEvent);
}

/**
 * Acknowledge (mark as processed) a list of events for an agent.
 */
export function ackEvents(agentSlug: string, eventIds: string[]): void {
	if (eventIds.length === 0) return;
	const insert = getRawDb().prepare(
		`INSERT OR IGNORE INTO agent_event_acks (event_id, agent_slug)
     VALUES (?, ?)`,
	);
	const tx = getRawDb().transaction((ids: string[]) => {
		for (const id of ids) {
			insert.run(id, agentSlug);
		}
	});
	tx(eventIds);
}

/**
 * Return the most recent events for a company (CEO monitoring / dashboard).
 */
export function getCompanyEvents(companyId: string, limit = 50): AgentEvent[] {
	const rows = getRawDb()
		.prepare(
			`SELECT * FROM agent_events
       WHERE company_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
		)
		.all(companyId, limit) as AgentEventRow[];
	return rows.map(rowToEvent);
}
