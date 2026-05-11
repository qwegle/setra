/**
 * collaboration.ts — agent-to-agent message channel API
 *
 * Agents post messages via the MCP broker. This route exposes those messages
 * (stored in team_messages) to the board UI. Channels are scoped per
 * company so two companies don't see each other's chatter.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { recordObservation } from "../clone/observer.js";
import { wakeAgentsForChannelMessage } from "../lib/agent-wake.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as agentsRepo from "../repositories/agents.repo.js";
import * as collaborationRepo from "../repositories/collaboration.repo.js";
import * as issuesRepo from "../repositories/issues.repo.js";
import * as projectsRepo from "../repositories/projects.repo.js";
import { emit } from "../sse/handler.js";
import { CreateMessageSchema } from "../validators/collaboration.validators.js";

export const collaborationRoute = new Hono();

function extractMentions(content: string): string[] {
	const out = new Set<string>();
	const re = /(?:^|\s)@([a-zA-Z0-9._-]+)/g;
	for (const match of content.matchAll(re)) {
		const handle = (match[1] ?? "").trim().toLowerCase();
		if (handle) out.add(handle);
	}
	return [...out];
}

function getRosterSlugs(companyId: string | undefined | null): Set<string> {
	return new Set(
		(companyId ? agentsRepo.listRosterByCompany(companyId) : [])
			.map((r) => r.slug.toLowerCase())
			.filter(Boolean),
	);
}

function isHumanLikeSender(sender: string, rosterSlugs: Set<string>): boolean {
	const normalized = sender.trim().toLowerCase();
	if (!normalized) return true;
	if (normalized === "human") return true;
	if (normalized === "assistant") return false;
	return !rosterSlugs.has(normalized);
}

// GET /api/collaboration/channels
collaborationRoute.get("/channels", async (c) => {
	const cid = getCompanyId(c);
	return c.json(collaborationRepo.listChannels(cid));
});

// GET /api/collaboration/messages?channel=general&limit=80[&hideSystem=true]
collaborationRoute.get("/messages", async (c) => {
	const cid = getCompanyId(c);
	const channel = c.req.query("channel") ?? "general";
	const limit = Math.min(Number(c.req.query("limit") ?? 80), 200);
	// hideLifecycle is always true; hideSystem is passed from the board for extra client-side noise
	const messages = collaborationRepo.listMessages(cid, channel, limit, true);
	return c.json(messages);
});

// POST /api/collaboration/messages
collaborationRoute.post(
	"/messages",
	zValidator("json", CreateMessageSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const channel = body.channel ?? "general";
		const content = body.body ?? "";
		const fromAgent = body.agentSlug?.trim() || "human";
		const targetCid = cid;
		const rosterSlugs = getRosterSlugs(targetCid);
		const isHumanSender = isHumanLikeSender(fromAgent, rosterSlugs);

		const { id, createdAt } = collaborationRepo.createMessage({
			channel,
			content,
			fromAgent,
			companyId: targetCid,
		});

		emit("collab:message", { channel, companyId: targetCid });

		// Train clone from human messages
		if (isHumanSender && content.trim().length > 0) {
			void recordObservation(content, "chat_message", 1.0, cid);
		}

		const mentions = extractMentions(content);
		const responderSlug = mentions.includes("assistant") ? "assistant" : null;
		if (
			isHumanSender &&
			content.trim().length > 0 &&
			!content.trim().startsWith("/")
		) {
			wakeAgentsForChannelMessage(targetCid ?? "", channel, content, "human");
		}
		if (
			responderSlug === "assistant" &&
			fromAgent.toLowerCase() !== responderSlug
		) {
			replyAsAssistant(
				targetCid,
				channel,
				content,
				fromAgent,
				responderSlug,
			).catch((err) => {
				console.error("[collaboration] replyAsAssistant failed:", err);
			});
		}

		return c.json(
			{
				id,
				agentSlug: fromAgent,
				channel,
				body: content,
				threadId: null,
				createdAt,
				companyId: targetCid,
			},
			201,
		);
	},
);

async function replyAsAssistant(
	cid: string | undefined | null,
	channelId: string,
	originalMessage: string,
	mentioner: string,
	responderSlug: string,
): Promise<void> {
	// Build company context so the agent knows what's happening.
	let contextBlock = "";
	if (cid) {
		try {
			const projects = projectsRepo.listProjectsByCompany(cid);
			const agents = agentsRepo.listRosterByCompany(cid);
			const projectSummaries = projects
				.slice(0, 5)
				.map((p) => {
					const issues = projectsRepo
						.getProjectIssues(p.id, cid)
						.slice(0, 5) as Array<Record<string, unknown>>;
					const issueLine = issues.length
						? issues
								.map(
									(i) =>
										`  - [${(i.identifier as string) ?? "?"}] ${i.title as string} (${i.status as string})`,
								)
								.join("\n")
						: "  (no open issues)";
					return `Project: ${p.name}\nIssues:\n${issueLine}`;
				})
				.join("\n\n");
			const agentList = agents
				.map((a) => `@${a.slug} (${a.display_name}, ${a.adapter_type})`)
				.join(", ");
			contextBlock = `\n\n---\nCOMPANY CONTEXT\nAgents: ${agentList}\n\n${projectSummaries}\n---`;
		} catch {
			// best-effort — never block the reply
		}
	}

	// Use the agent's own system_prompt if it has one, otherwise use a generic one.
	const agentRow = cid
		? (agentsRepo
				.listRosterByCompany(cid)
				.find((r) => r.slug.toLowerCase() === responderSlug.toLowerCase()) ??
			null)
		: null;
	const agentSystemPrompt = agentRow?.system_prompt ?? null;
	const systemPrompt =
		(agentSystemPrompt ??
			`You are @${responderSlug}, an AI teammate in this company channel (#${channelId}). ` +
				`Reply conversationally and concisely (2-4 sentences). The mentioner's handle is "${mentioner}".`) +
		contextBlock;

	// Include recent channel history so replies have memory of the conversation.
	const history = collaborationRepo
		.listMessages(cid, channelId, 20)
		.filter((m) => m.messageKind !== "pinned_sprint_board")
		.slice(-15); // last 15 non-system messages

	const rosterSlugs = getRosterSlugs(cid);
	const historyMessages = history
		.filter((m) => m.agentSlug !== responderSlug) // exclude self to avoid loops
		.map((m) => ({
			role: (isHumanLikeSender(m.agentSlug, rosterSlugs)
				? "user"
				: "assistant") as "user" | "assistant",
			content: `[${m.agentSlug}]: ${m.body}`,
		}));

	// Ensure the current message is last (it may already be in history).
	const alreadyInHistory = historyMessages.some((m) =>
		m.content.includes(originalMessage),
	);
	if (!alreadyInHistory) {
		historyMessages.push({
			role: "user",
			content: `[${mentioner}]: ${originalMessage}`,
		});
	}

	const port = process.env.SETRA_PORT ?? "3141";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (cid) headers["x-company-id"] = cid;
	const instanceToken = process.env["SETRA_INSTANCE_TOKEN"]?.trim();
	if (instanceToken) headers["x-instance-token"] = instanceToken;

	const resp = await fetch(`http://localhost:${port}/api/ai/chat`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			messages: [{ role: "system", content: systemPrompt }, ...historyMessages],
			agentSlug: responderSlug,
		}),
	});

	if (!resp.ok) {
		throw new Error(
			`ai/chat ${resp.status}: ${(await resp.text()).slice(0, 200)}`,
		);
	}
	const data = (await resp.json()) as { reply?: string };
	const reply = (data.reply ?? "").trim();
	if (!reply) return;

	collaborationRepo.insertAutomatedReply({
		channelId,
		reply,
		companyId: cid,
		fromAgent: responderSlug,
	});
	emit("collab:message", { channel: channelId, companyId: cid });
}
