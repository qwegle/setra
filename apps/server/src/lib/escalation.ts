import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { getRawDb } from "@setra/db";
import { MemoryStore } from "@setra/memory";
import * as approvalsRepo from "../repositories/approvals.repo.js";
import {
	ensureProjectAgentsInfrastructure,
	getScopedProjectOrThrow,
	listProjectAgents,
} from "./project-agents.js";

function getMemoryDbPath(companyId: string): string {
	const dataDir = process.env.SETRA_DATA_DIR ?? join(homedir(), ".setra");
	return join(dataDir, "memory", `${companyId}.db`);
}

function nextSequence(channel: string, companyId: string): number {
	const row = getRawDb()
		.prepare(
			`SELECT COALESCE(MAX(sequence), 0) AS s
			   FROM team_messages
			  WHERE channel = ? AND company_id = ?`,
		)
		.get(channel, companyId) as { s: number } | undefined;
	return (row?.s ?? 0) + 1;
}

function insertChannelMessage(input: {
	companyId: string;
	channel: string;
	fromAgent: string;
	content: string;
	messageType?: string;
	messageKind?: string;
}): { id: string; createdAt: string } {
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	getRawDb()
		.prepare(
			`INSERT INTO team_messages (
				id, plot_id, from_agent, channel, content, message_type,
				message_kind, sequence, company_id, created_at
			 ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			input.fromAgent,
			input.channel,
			input.content,
			input.messageType ?? "status",
			input.messageKind ?? null,
			nextSequence(input.channel, input.companyId),
			input.companyId,
			createdAt,
		);
	return { id, createdAt };
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 2)
		.slice(0, 12);
}

function buildLikeClause(tokens: string[]): { sql: string; params: string[] } {
	if (tokens.length === 0) return { sql: "", params: [] };
	return {
		sql: ` AND (${tokens.map(() => "lower(t.content) LIKE ?").join(" OR ")})`,
		params: tokens.map((token) => `%${token}%`),
	};
}

async function searchSemanticMemory(input: {
	companyId: string;
	projectId: string;
	query: string;
}): Promise<string[]> {
	try {
		const store = new MemoryStore({ dbPath: getMemoryDbPath(input.companyId) });
		await store.init();
		const results = await store.search(input.query, {
			limit: 4,
			minScore: 0.35,
			plotId: input.projectId,
		});
		return results.map((result) => result.entry.content.slice(0, 240));
	} catch {
		return [];
	}
}

export async function lookupEscalationContext(input: {
	companyId: string;
	projectId: string;
	question: string;
}): Promise<{ traces: string[]; memories: string[] }> {
	ensureProjectAgentsInfrastructure();
	const tokens = tokenize(input.question);
	const like = buildLikeClause(tokens);
	const traces = getRawDb()
		.prepare(
			`SELECT t.content
			   FROM traces t
			  WHERE t.project_id = ?${like.sql}
			  ORDER BY t.created_at DESC
			  LIMIT 5`,
		)
		.all(input.projectId, ...like.params) as Array<{ content: string }>;
	const memories = await searchSemanticMemory({
		companyId: input.companyId,
		projectId: input.projectId,
		query: input.question,
	});
	return {
		traces: traces.map((trace) => trace.content.slice(0, 240)),
		memories,
	};
}

export async function postProjectHelpRequest(input: {
	companyId: string;
	projectId: string;
	agentRosterId: string;
	agentSlug: string;
	agentName: string;
	task: string;
	tried: string;
	question: string;
	context?: string;
	runId?: string | null;
	issueId?: string | null;
}): Promise<{ messageId: string; approvalId: string | null }> {
	const project = getScopedProjectOrThrow(input.projectId, input.companyId);
	const channelRow = getRawDb()
		.prepare(`SELECT slug FROM team_channels WHERE project_id = ? LIMIT 1`)
		.get(input.projectId) as { slug: string } | undefined;
	const channel = channelRow?.slug ?? `proj-${project.slug}`;
	const contextLookup = await lookupEscalationContext({
		companyId: input.companyId,
		projectId: input.projectId,
		question: `${input.task}\n${input.question}\n${input.tried}`,
	});
	const similarSections = [...contextLookup.traces, ...contextLookup.memories]
		.slice(0, 4)
		.map((entry) => `- ${entry}`)
		.join("\n");
	const content = [
		`🔍 **Help Needed** — ${input.agentName}`,
		`**Task**: ${input.task}`,
		`**What I tried**: ${input.tried}`,
		`**Question**: ${input.question}`,
		input.context ? `**Context**: ${input.context}` : "",
		similarSections ? `**Memory / traces checked**:\n${similarSections}` : "",
	]
		.filter(Boolean)
		.join("\n");
	const inserted = insertChannelMessage({
		companyId: input.companyId,
		channel,
		fromAgent: input.agentSlug,
		content,
		messageType: "help_request",
		messageKind: "help_request",
	});

	const teammates = listProjectAgents(input.projectId, input.companyId).filter(
		(agent) => agent.agentRosterId !== input.agentRosterId,
	);
	for (const teammate of teammates) {
		getRawDb()
			.prepare(
				`INSERT INTO agent_events (
					id, company_id, event_type, source_agent, target_agent,
					issue_id, run_id, payload, created_at
				 ) VALUES (?, ?, 'help_needed', ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				crypto.randomUUID(),
				input.companyId,
				input.agentSlug,
				teammate.slug,
				input.issueId ?? null,
				input.runId ?? null,
				JSON.stringify({
					projectId: input.projectId,
					question: input.question,
					messageId: inserted.id,
				}),
				inserted.createdAt,
			);
	}

	const timer = setTimeout(async () => {
		try {
			const response = getRawDb()
				.prepare(
					`SELECT id
					   FROM team_messages
					  WHERE company_id = ?
					    AND channel = ?
					    AND created_at > ?
					    AND from_agent != ?
					  LIMIT 1`,
				)
				.get(input.companyId, channel, inserted.createdAt, input.agentSlug) as
				| { id: string }
				| undefined;
			if (response) return;
			const approval = await approvalsRepo.createApproval({
				companyId: input.companyId,
				type: "approval_request",
				entityType: "project",
				entityId: input.projectId,
				title: `Help request from ${input.agentName}`,
				description: `${input.task}\n\n${input.question}`,
				requestedBy: input.agentSlug,
				riskLevel: "medium",
			});
			insertChannelMessage({
				companyId: input.companyId,
				channel,
				fromAgent: input.agentSlug,
				content: `🧾 **Approval Request** — ${input.agentName} still needs direction on **${input.task}**. Please review the pending approval${approval?.id ? ` (${approval.id.slice(0, 8)})` : ""}.`,
				messageType: "approval_request",
				messageKind: "approval_request",
			});
		} catch {
			/* best-effort escalation */
		}
	}, 30_000);
	if (typeof (timer as { unref?: () => void }).unref === "function") {
		(timer as { unref: () => void }).unref();
	}

	return { messageId: inserted.id, approvalId: null };
}

export function hashEscalationSummary(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
