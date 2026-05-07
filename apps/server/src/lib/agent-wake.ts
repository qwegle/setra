/**
 * agent-wake.ts — Keeps agents alive by waking them on events.
 *
 * Agents wake up when:
 * 1. Human comments on an issue (in_review or in_progress)
 * 2. New message in collaboration channel mentions an agent
 * 3. Agent-to-agent communication triggers a response
 *
 * This prevents agents from going permanently idle while issues
 * await human interaction.
 */

import * as crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import * as assistantRepo from "../repositories/assistant.repo.js";
import { emit } from "../sse/handler.js";
import {
	type DelegationMessage,
	ackDelegationMessage,
	loadPendingDelegationMessages,
	subscribeToBrokerMessages,
} from "./company-broker.js";
import { getCompanySettings } from "./company-settings.js";
import { addAutomationIssueComment } from "./issue-comments.js";
import { createLogger } from "./logger.js";
import { jobQueue } from "./queue.js";
import { withRetry } from "./retry.js";
import { spawnServerRun } from "./server-runner.js";
import { recordLlmCost } from "./track-llm-cost.js";

// Debounce: don't wake the same agent for the same issue within 60s
const lastWake = new Map<string, number>();
const WAKE_DEBOUNCE_MS = 60_000;
const log = createLogger("agent-wake");

interface AgentRow {
	id: string;
	slug: string;
	display_name: string;
	adapter_type: string;
	model_id: string | null;
	company_id: string;
}

let wakeProcessorRegistered = false;
const brokerSubscriptions = new Map<string, () => void>();

function enqueueAgentTaskRun(
	agent: AgentRow,
	companyId: string,
	task: string,
): string {
	const BOARD_PROJECT_ID = "00000000000000000000000000000001";
	const now = new Date().toISOString();
	const plotId = `bp${agent.id.replace(/-/g, "")}`.slice(0, 32);
	const runId = crypto.randomUUID();
	assistantRepo.ensureBoardProject(BOARD_PROJECT_ID, now);
	assistantRepo.ensureBoardPlot(plotId, BOARD_PROJECT_ID, agent.slug, now);
	assistantRepo.insertRun(runId, plotId, agent.slug, agent.model_id, now);
	assistantRepo.insertChunk(runId, task, now);
	emit("run:updated", {
		runId,
		agentId: agent.slug,
		status: "pending",
		companyId,
	});
	void spawnServerRun({
		runId,
		agentSlug: agent.slug,
		companyId,
		task,
		issueId: null,
	}).catch((err) => {
		log.warn("agent wake failed", {
			agentSlug: agent.slug,
			error: err instanceof Error ? err.message : String(err),
		});
	});
	return runId;
}

export function wakeDelegatedAgent(message: DelegationMessage): void {
	queueDelegationWake(message);
}

function queueDelegationWake(message: DelegationMessage): void {
	registerWakeQueueProcessor();
	const existing = getRawDb()
		.prepare(
			`SELECT id FROM jobs
			  WHERE type = 'wake'
			    AND status IN ('waiting', 'active')
			    AND json_extract(payload, '$.eventId') = ?
			  LIMIT 1`,
		)
		.get(message.eventId) as { id: string } | undefined;
	if (existing) return;
	jobQueue.add("wake", message as unknown as Record<string, unknown>, {
		priority: 1,
		maxAttempts: 2,
	});
}

export function registerWakeQueueProcessor(): void {
	if (wakeProcessorRegistered) return;
	wakeProcessorRegistered = true;
	jobQueue.process("wake", async (job) => {
		const payload = job.payload as unknown as DelegationMessage;
		const agent = getRawDb()
			.prepare(
				`SELECT id, slug, display_name, adapter_type, model_id, company_id
				   FROM agent_roster
				  WHERE company_id = ? AND slug = ? AND is_active = 1
				  LIMIT 1`,
			)
			.get(payload.companyId, payload.targetAgent) as AgentRow | undefined;
		if (!agent) {
			ackDelegationMessage(payload.eventId, payload.targetAgent);
			return { skipped: true };
		}
		const task = [
			`Delegated task from @${payload.fromAgent}: ${payload.task}`,
			payload.context ? `Context:\n${payload.context}` : "",
			"Reply with progress or completion details once done.",
		]
			.filter(Boolean)
			.join("\n\n");
		const runId = enqueueAgentTaskRun(agent, payload.companyId, task);
		ackDelegationMessage(payload.eventId, payload.targetAgent);
		return { runId, agentSlug: payload.targetAgent };
	});
}

export function startBrokerWakeSubscriptions(): void {
	registerWakeQueueProcessor();
	const agents = getRawDb()
		.prepare(
			`SELECT id, slug, display_name, adapter_type, model_id, company_id
			   FROM agent_roster
			  WHERE is_active = 1 AND company_id IS NOT NULL`,
		)
		.all() as AgentRow[];
	for (const agent of agents) {
		if (brokerSubscriptions.has(agent.slug)) continue;
		for (const pending of loadPendingDelegationMessages(
			agent.company_id,
			agent.slug,
		)) {
			queueDelegationWake(pending);
		}
		const unsubscribe = subscribeToBrokerMessages(agent.slug, (message) => {
			if (message.companyId !== agent.company_id) return;
			queueDelegationWake(message);
		});
		brokerSubscriptions.set(agent.slug, unsubscribe);
	}
}

/**
 * Wake an agent when a human comments on an issue.
 * The agent reads the comment and responds in the issue thread.
 */
export function wakeAgentForIssueComment(
	issueId: string,
	companyId: string | null,
	commentBody: string,
): void {
	if (!companyId) return;

	const db = getRawDb();
	const issue = db
		.prepare(
			`SELECT id, slug, title, status, assigned_agent_id, description
			 FROM board_issues WHERE id = ? AND company_id = ?`,
		)
		.get(issueId, companyId) as {
		id: string;
		slug: string;
		title: string;
		status: string;
		assigned_agent_id: string | null;
		description: string | null;
	} | null;

	if (!issue) return;

	// Only wake for issues that are in active states
	const WAKE_STATUSES = new Set(["in_progress", "in_review", "todo"]);
	if (!WAKE_STATUSES.has(issue.status)) return;

	// Find the right agent to respond
	let agent: AgentRow | null = null;
	if (issue.assigned_agent_id) {
		agent = db
			.prepare(
				`SELECT id, slug, display_name, adapter_type, model_id, company_id
				 FROM agent_roster WHERE id = ? AND is_active = 1`,
			)
			.get(issue.assigned_agent_id) as AgentRow | null;
	}
	if (!agent) {
		// Fall back to CTO for technical issues, CEO for others
		agent = db
			.prepare(
				`SELECT id, slug, display_name, adapter_type, model_id, company_id
				 FROM agent_roster WHERE company_id = ? AND is_active = 1
				 AND slug IN ('cto', 'ceo')
				 ORDER BY CASE slug WHEN 'cto' THEN 0 ELSE 1 END
				 LIMIT 1`,
			)
			.get(companyId) as AgentRow | null;
	}
	if (!agent) return;

	// Debounce
	const key = `${agent.slug}:${issueId}`;
	const now = Date.now();
	if (lastWake.has(key) && now - (lastWake.get(key) ?? 0) < WAKE_DEBOUNCE_MS) {
		return;
	}
	lastWake.set(key, now);

	// Spawn a lightweight response run (async, don't block the request)
	respondToComment(agent, issue, commentBody, companyId).catch((err) => {
		log.warn("respondToComment failed", {
			issueId,
			agentSlug: agent.slug,
			error: err instanceof Error ? err.message : String(err),
		});
	});
}

async function respondToComment(
	agent: AgentRow,
	issue: {
		id: string;
		slug: string;
		title: string;
		description: string | null;
	},
	comment: string,
	companyId: string,
): Promise<void> {
	// Get recent comments for context
	const db = getRawDb();
	const recentComments = db
		.prepare(
			`SELECT author, body, created_at FROM issue_comments
			 WHERE issue_id = ? AND company_id = ?
			 ORDER BY created_at DESC LIMIT 10`,
		)
		.all(issue.id, companyId) as Array<{
		author: string;
		body: string;
		created_at: string;
	}>;

	const commentHistory = recentComments
		.reverse()
		.map((c) => `[${c.author}]: ${c.body}`)
		.join("\n");

	// Resolve API key from company settings (settings.json), not process.env
	const settings = getCompanySettings(companyId) as Record<string, unknown>;
	const apiKey =
		(typeof settings["openai_api_key"] === "string"
			? settings["openai_api_key"]
			: "") ||
		(process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "");
	if (!apiKey) return;

	const systemPrompt = `You are ${agent.display_name} (${agent.slug}), an AI agent working on issue ${issue.slug}: "${issue.title}".
A human just commented on this issue. Read their comment and respond helpfully.
Keep your response concise (2-4 sentences). If they're asking you to do something, acknowledge it.
If the issue is in review and they approve, say thanks. If they have feedback, acknowledge it.`;

	const userPrompt = `Issue: ${issue.slug} — ${issue.title}
${issue.description ? `Description: ${issue.description}\n` : ""}
Recent comments:
${commentHistory}

Latest human comment: ${comment}

Respond to the human's comment:`;

	try {
		const data = await withRetry(
			async () => {
				const resp = await fetch("https://api.openai.com/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model: agent.model_id ?? "gpt-4o-mini",
						max_completion_tokens: 300,
						messages: [
							{ role: "system", content: systemPrompt },
							{ role: "user", content: userPrompt },
						],
					}),
				});
				if (!resp.ok) {
					const errBody = await resp.text().catch(() => "");
					throw new Error(
						`openai-api ${resp.status}: ${errBody.slice(0, 200)}`,
					);
				}
				return (await resp.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
			},
			{
				maxAttempts: 2,
				onRetry: (attempt, error, delay) => {
					log.warn("wake retry", {
						attempt,
						agentSlug: agent.slug,
						delayMs: Math.round(delay),
						error: error.message,
					});
				},
			},
		);
		const reply = data.choices?.[0]?.message?.content?.trim();
		if (!reply) return;

		// Record cost
		if (data.usage) {
			recordLlmCost({
				agentSlug: agent.slug,
				model: agent.model_id ?? "gpt-4o-mini",
				usage: data.usage,
				source: "wake-reply",
				companyId,
			});
		}

		addAutomationIssueComment(issue.id, companyId, reply, agent.slug);
	} catch {
		/* best-effort */
	}
}

/**
 * Wake agents when a new channel message arrives.
 * Called from collaboration route when human posts in a channel.
 * All active agents in the company "see" the message.
 */
export function wakeAgentsForChannelMessage(
	companyId: string,
	channel: string,
	message: string,
	fromAgent: string,
): void {
	if (fromAgent !== "human") return;

	const db = getRawDb();
	const agents = db
		.prepare(
			`SELECT id, slug, display_name, adapter_type, model_id, company_id
			 FROM agent_roster WHERE company_id = ? AND is_active = 1
			 AND slug NOT LIKE 'assistant%'`,
		)
		.all(companyId) as AgentRow[];
	if (agents.length === 0) return;

	const mentionedSlugs = new Set(
		(message.match(/@([a-zA-Z0-9._-]+)/g) ?? []).map((m) =>
			m.slice(1).toLowerCase(),
		),
	);
	const historicalMembers = new Set(
		(
			db
				.prepare(
					`SELECT DISTINCT lower(from_agent) AS slug
				   FROM team_messages
				  WHERE company_id = ? AND channel = ? AND from_agent IS NOT NULL`,
				)
				.all(companyId, channel) as Array<{ slug: string | null }>
		)
			.map((row) => row.slug ?? "")
			.filter(Boolean),
	);
	const channelSlug = channel.trim().toLowerCase();
	const targetAgents = agents.filter((agent) => {
		const slug = agent.slug.toLowerCase();
		if (mentionedSlugs.size > 0) return mentionedSlugs.has(slug);
		if (channelSlug === "general") return true;
		return historicalMembers.has(slug) || slug === channelSlug;
	});
	if (targetAgents.length === 0) return;

	const recentMessages = db
		.prepare(
			`SELECT from_agent, content, created_at FROM team_messages
			 WHERE company_id = ? AND channel = ?
			 ORDER BY created_at DESC LIMIT 10`,
		)
		.all(companyId, channel) as Array<{
		from_agent: string;
		content: string;
		created_at: string;
	}>;
	const history = recentMessages
		.reverse()
		.map((row) => `[${row.from_agent}]: ${row.content}`)
		.join("\n");
	const now = new Date().toISOString();
	const BOARD_PROJECT_ID = "00000000000000000000000000000001";
	assistantRepo.ensureBoardProject(BOARD_PROJECT_ID, now);

	for (const agent of targetAgents) {
		const debounceKey = `${agent.slug}:channel:${channel}:${message.slice(0, 120)}`;
		const last = lastWake.get(debounceKey) ?? 0;
		if (Date.now() - last < WAKE_DEBOUNCE_MS) continue;
		lastWake.set(debounceKey, Date.now());

		const plotId = `bp${agent.id.replace(/-/g, "")}`.slice(0, 32);
		const runId = crypto.randomUUID();
		assistantRepo.ensureBoardPlot(plotId, BOARD_PROJECT_ID, agent.slug, now);
		assistantRepo.insertRun(runId, plotId, agent.slug, agent.model_id, now);
		assistantRepo.insertChunk(
			runId,
			`Channel: #${channel}\nRecent messages:\n${history}\n\nLatest human message from @${fromAgent}: ${message}\n\nReply in the collaboration channel as ${agent.display_name} (@${agent.slug}). Keep it concise and useful.`,
			now,
		);
		emit("run:updated", { runId, agentId: agent.slug, status: "pending" });
		void spawnServerRun({
			runId,
			agentSlug: agent.slug,
			companyId,
			task: `Channel: #${channel}\nRecent messages:\n${history}\n\nLatest human message from @${fromAgent}: ${message}\n\nReply in the collaboration channel as ${agent.display_name} (@${agent.slug}). Keep it concise and useful.`,
			issueId: null,
		}).catch((err) => {
			log.warn("channel wake failed", {
				agentSlug: agent.slug,
				channel,
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}
}
