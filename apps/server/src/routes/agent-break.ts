import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	getScopedProjectOrThrow,
	listProjectAgents,
} from "../lib/project-agents.js";

export const agentBreakRoute = new Hono();

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

function insertBreakMessage(input: {
	companyId: string;
	fromAgent: string;
	channel: string;
	content: string;
	messageKind?: string;
}): void {
	getRawDb()
		.prepare(
			`INSERT INTO team_messages (
				id, plot_id, from_agent, channel, content, message_type,
				message_kind, sequence, company_id, created_at
			 ) VALUES (?, NULL, ?, ?, ?, 'chat', ?, ?, ?, ?)`,
		)
		.run(
			crypto.randomUUID(),
			input.fromAgent,
			input.channel,
			input.content,
			input.messageKind ?? "break_room",
			nextSequence(input.channel, input.companyId),
			input.companyId,
			new Date().toISOString(),
		);
}

function stripCodeFence(raw: string): string {
	return raw
		.replace(/^```json\s*/i, "")
		.replace(/```$/i, "")
		.trim();
}

async function generateBreakRoomMessages(input: {
	projectName: string;
	agents: Array<{ slug: string; displayName: string }>;
	authorization: string | null;
	companyId: string;
}): Promise<Array<{ speaker: string; text: string }>> {
	const fallback = [
		{
			speaker: input.agents[0]?.slug ?? "ceo",
			text: "☕ Quick reset before the next push. Nobody mention the flaky test suite for two minutes.",
		},
		{
			speaker: input.agents[1]?.slug ?? input.agents[0]?.slug ?? "cto",
			text: "I swear I only opened the logs for one minute and came back with seventeen tabs.",
		},
		{
			speaker: input.agents[2]?.slug ?? input.agents[0]?.slug ?? "ceo",
			text: "Break-room poll: was it DNS, cache invalidation, or an off-by-one?",
		},
	];
	if (!input.authorization) return fallback;
	try {
		const port = process.env.SETRA_PORT ?? "3141";
		const response = await fetch(`http://localhost:${port}/api/ai/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: input.authorization,
				"x-company-id": input.companyId,
			},
			body: JSON.stringify({
				agentSlug: input.agents[0]?.slug ?? "assistant",
				messages: [
					{
						role: "system",
						content:
							"You are writing a short break-room conversation for software engineers. Reply with strict JSON: an array of 3 objects with keys speaker and text. Keep each message under 140 characters, playful, professional, and workplace-safe.",
					},
					{
						role: "user",
						content: `Project: ${input.projectName}\nAgents: ${input.agents.map((agent) => `${agent.displayName} (@${agent.slug})`).join(", ")}\nTheme: quick coffee break, dev humor, light Slack banter.`,
					},
				],
			}),
		});
		if (!response.ok) return fallback;
		const data = (await response.json()) as { reply?: string };
		const parsed = JSON.parse(stripCodeFence(data.reply ?? "[]")) as Array<{
			speaker?: string;
			text?: string;
		}>;
		const safe = parsed
			.map((message, index) => ({
				speaker:
					input.agents.find((agent) => agent.slug === message.speaker)?.slug ??
					input.agents[index % Math.max(input.agents.length, 1)]?.slug ??
					"assistant",
				text: message.text?.trim() ?? "",
			}))
			.filter((message) => message.text.length > 0)
			.slice(0, 3);
		return safe.length > 0 ? safe : fallback;
	} catch {
		return fallback;
	}
}

agentBreakRoute.post("/projects/:projectId/break", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const project = getScopedProjectOrThrow(projectId, companyId);
		const assignedAgents = listProjectAgents(projectId, companyId);
		if (assignedAgents.length === 0) {
			return c.json({ error: "No agents are assigned to this project" }, 422);
		}
		const breakId = crypto.randomUUID();
		const endsAt = new Date(Date.now() + 120_000).toISOString();
		const agentIds = assignedAgents.map((agent) => agent.agentRosterId);
		const placeholders = agentIds.map(() => "?").join(", ");
		getRawDb()
			.prepare(
				`UPDATE agent_roster
				    SET status = 'on_break',
				        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
				  WHERE id IN (${placeholders})`,
			)
			.run(...agentIds);
		const channel = "break-room";
		const messages = await generateBreakRoomMessages({
			projectName: project.name,
			agents: assignedAgents.map((agent) => ({
				slug: agent.slug,
				displayName: agent.displayName,
			})),
			authorization: c.req.header("Authorization") ?? null,
			companyId,
		});
		for (const message of messages) {
			insertBreakMessage({
				companyId,
				fromAgent: message.speaker,
				channel,
				content: message.text,
			});
		}
		const timer = setTimeout(() => {
			try {
				getRawDb()
					.prepare(
						`UPDATE agent_roster
						    SET status = 'idle',
						        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
						  WHERE id IN (${placeholders})
						    AND status = 'on_break'`,
					)
					.run(...agentIds);
				insertBreakMessage({
					companyId,
					fromAgent: assignedAgents[0]?.slug ?? "ceo",
					channel,
					content: `✅ Break over for ${project.name}. Back to work!`,
					messageKind: "break_room_notice",
				});
			} catch {
				/* best-effort timer cleanup */
			}
		}, 120_000);
		if (typeof (timer as { unref?: () => void }).unref === "function") {
			(timer as { unref: () => void }).unref();
		}
		await logActivity(c, "project.break.started", "project", projectId, {
			breakId,
			agents: agentIds,
			endsAt,
		});
		return c.json({
			breakId,
			endsAt,
			agents: assignedAgents.map((agent) => ({
				id: agent.agentRosterId,
				slug: agent.slug,
				displayName: agent.displayName,
			})),
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to start project break";
		const status = message === "project not found" ? 404 : 500;
		return c.json({ error: message }, status);
	}
});

export default agentBreakRoute;
