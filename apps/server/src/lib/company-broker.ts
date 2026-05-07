import crypto from "node:crypto";
import type { CompanyMessage } from "@setra/company";
import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";

export interface DelegationMessage {
	eventId: string;
	companyId: string;
	runId: string;
	fromAgent: string;
	targetAgent: string;
	task: string;
	context: string;
	issueId: string | null;
	messageId: string;
	createdAt: string;
}

type BrokerSubscriber = (message: DelegationMessage) => void;

const subscribers = new Map<string, Set<BrokerSubscriber>>();

function nextSequence(channel: string, companyId: string): number {
	const row = getRawDb()
		.prepare(
			`SELECT COALESCE(MAX(sequence), 0) AS s FROM team_messages WHERE channel = ? AND company_id = ?`,
		)
		.get(channel, companyId) as { s: number } | undefined;
	return (row?.s ?? 0) + 1;
}

function resolveCompanyRunId(companyId: string, runId?: string | null): string {
	if (runId) return runId;
	const active = getRawDb()
		.prepare(
			`SELECT r.id
			   FROM runs r
			   JOIN agent_roster a ON a.slug = r.agent
			  WHERE a.company_id = ? AND r.status IN ('pending', 'running')
			  ORDER BY r.started_at DESC
			  LIMIT 1`,
		)
		.get(companyId) as { id: string } | undefined;
	return active?.id ?? `company:${companyId}`;
}

function insertBrokerMessage(params: {
	companyId: string;
	fromAgent: string;
	targetAgent: string;
	runId: string;
	task: string;
	context: string;
	issueId?: string | null;
	kind?: CompanyMessage["kind"];
}): DelegationMessage {
	const db = getRawDb();
	const eventId = crypto.randomUUID();
	const messageId = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const channel = "general";
	const content = `Delegation for @${params.targetAgent}: ${params.task}${params.context ? `\n\nContext:\n${params.context}` : ""}`;
	db.prepare(
		`INSERT INTO team_messages (id, plot_id, from_agent, channel, content, sequence, company_id, created_at, message_kind)
		 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		messageId,
		params.fromAgent,
		channel,
		content,
		nextSequence(channel, params.companyId),
		params.companyId,
		createdAt,
		params.kind ?? "task",
	);
	db.prepare(
		`INSERT INTO agent_events (id, company_id, event_type, source_agent, target_agent, issue_id, run_id, payload, created_at)
		 VALUES (?, ?, 'delegation', ?, ?, ?, ?, ?, ?)`,
	).run(
		eventId,
		params.companyId,
		params.fromAgent,
		params.targetAgent,
		params.issueId ?? null,
		params.runId,
		JSON.stringify({ task: params.task, context: params.context, messageId }),
		createdAt,
	);
	return {
		eventId,
		companyId: params.companyId,
		runId: params.runId,
		fromAgent: params.fromAgent,
		targetAgent: params.targetAgent,
		task: params.task,
		context: params.context,
		issueId: params.issueId ?? null,
		messageId,
		createdAt,
	};
}

export function publishDelegationMessage(input: {
	companyId: string;
	fromAgent: string;
	targetAgent: string;
	task: string;
	context: string;
	issueId?: string | null;
	runId?: string | null;
}): DelegationMessage {
	const message = insertBrokerMessage({
		...input,
		runId: resolveCompanyRunId(input.companyId, input.runId),
	});
	emit("broker:delegated", {
		companyId: input.companyId,
		fromAgent: input.fromAgent,
		targetAgent: input.targetAgent,
		task: input.task,
		runId: message.runId,
	});
	const subs = subscribers.get(input.targetAgent);
	if (subs) {
		for (const handler of subs) handler(message);
	}
	void import("./agent-wake.js")
		.then((mod) => mod.wakeDelegatedAgent(message))
		.catch(() => {
			/* broker wake is best-effort */
		});
	return message;
}

function resolveLeadAgent(companyId: string, excluding: string): string | null {
	const row = getRawDb()
		.prepare(
			`SELECT slug FROM agent_roster
			  WHERE company_id = ? AND is_active = 1 AND slug != ?
			  ORDER BY CASE WHEN lower(slug) = 'ceo' THEN 0 WHEN lower(slug) = 'cto' THEN 1 ELSE 2 END, created_at ASC
			  LIMIT 1`,
		)
		.get(companyId, excluding) as { slug: string } | undefined;
	return row?.slug ?? null;
}

export function publishAgentCompletionMessage(input: {
	companyId: string;
	fromAgent: string;
	content: string;
	issueId?: string | null;
	runId?: string | null;
}): void {
	if (input.fromAgent.toLowerCase() === "ceo") return;
	const targetAgent = resolveLeadAgent(input.companyId, input.fromAgent);
	if (!targetAgent || targetAgent === input.fromAgent) return;
	publishDelegationMessage({
		companyId: input.companyId,
		fromAgent: input.fromAgent,
		targetAgent,
		task: `Review the completed work from @${input.fromAgent}`,
		context: input.content.slice(0, 5000),
		issueId: input.issueId ?? null,
		runId: input.runId ?? null,
	});
}

export function subscribeToBrokerMessages(
	agentSlug: string,
	handler: BrokerSubscriber,
): () => void {
	const existing = subscribers.get(agentSlug) ?? new Set<BrokerSubscriber>();
	existing.add(handler);
	subscribers.set(agentSlug, existing);
	return () => {
		const current = subscribers.get(agentSlug);
		if (!current) return;
		current.delete(handler);
		if (current.size === 0) subscribers.delete(agentSlug);
	};
}

export function loadPendingDelegationMessages(
	companyId: string,
	agentSlug: string,
): DelegationMessage[] {
	const rows = getRawDb()
		.prepare(
			`SELECT e.id, e.company_id, e.run_id, e.source_agent, e.target_agent, e.issue_id, e.payload, e.created_at
			   FROM agent_events e
			   LEFT JOIN agent_event_acks a ON a.event_id = e.id AND a.agent_slug = ?
			  WHERE e.company_id = ?
			    AND e.event_type = 'delegation'
			    AND e.target_agent = ?
			    AND a.event_id IS NULL
			  ORDER BY e.created_at ASC`,
		)
		.all(agentSlug, companyId, agentSlug) as Array<{
		id: string;
		company_id: string;
		run_id: string;
		source_agent: string;
		target_agent: string;
		issue_id: string | null;
		payload: string;
		created_at: string;
	}>;
	return rows.map((row) => {
		const payload = JSON.parse(row.payload) as {
			task?: string;
			context?: string;
			messageId?: string;
		};
		return {
			eventId: row.id,
			companyId: row.company_id,
			runId: row.run_id,
			fromAgent: row.source_agent,
			targetAgent: row.target_agent,
			task: payload.task ?? "Delegated task",
			context: payload.context ?? "",
			issueId: row.issue_id,
			messageId: payload.messageId ?? row.id,
			createdAt: row.created_at,
		};
	});
}

export function ackDelegationMessage(eventId: string, agentSlug: string): void {
	getRawDb()
		.prepare(
			`INSERT OR IGNORE INTO agent_event_acks (event_id, agent_slug, acked_at)
			 VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
		)
		.run(eventId, agentSlug);
}
