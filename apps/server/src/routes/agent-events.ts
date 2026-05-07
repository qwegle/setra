/**
 * agent-events.ts — REST API for the agent event bus.
 *
 * Mounted at /api/agent-events (to avoid collision with the SSE /api/events route).
 *
 * Endpoints:
 *   GET  /api/agent-events/agent/:slug   — inbox for a specific agent
 *   POST /api/agent-events               — publish an event
 *   POST /api/agent-events/ack           — acknowledge events
 *   GET  /api/agent-events/company       — all company events (CEO / dashboard)
 *   POST /api/agent-events/insights      — publish a gossip insight
 *   GET  /api/agent-events/insights      — query gossip insights
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
	type AgentEvent,
	type AgentEventType,
	ackEvents,
	getAgentInbox,
	getCompanyEvents,
	publishEvent,
} from "../lib/agent-event-bus.js";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import { publishInsight, queryInsights } from "../lib/gossip.js";

export const agentEventsRoute = new Hono();

// ─── Validators ───────────────────────────────────────────────────────────────

const PublishEventSchema = z.object({
	eventType: z.enum([
		"task_started",
		"task_completed",
		"task_failed",
		"pr_created",
		"pr_reviewed",
		"pr_merged",
		"help_needed",
		"insight",
		"handoff",
		"status_update",
		"escalation",
	] as [AgentEventType, ...AgentEventType[]]),
	sourceAgent: z.string().min(1),
	targetAgent: z.string().optional(),
	issueId: z.string().optional(),
	runId: z.string().optional(),
	payload: z.record(z.unknown()).default({}),
});

const AckSchema = z.object({
	agentSlug: z.string().min(1),
	eventIds: z.array(z.string()).min(1),
});

const PublishInsightSchema = z.object({
	agentSlug: z.string().min(1),
	insight: z.string().min(1),
	context: z.string().default(""),
	tags: z.array(z.string()).default([]),
});

const QueryInsightSchema = z.object({
	agentSlug: z.string().min(1),
	topic: z.string().min(1),
	limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ─── GET /agent-events/agent/:slug — inbox ────────────────────────────────────

agentEventsRoute.get("/agent/:slug", (c) => {
	const companyId = getCompanyId(c);
	const slug = c.req.param("slug");
	const since = c.req.query("since");
	const events = getAgentInbox(slug, companyId, since);
	return c.json(events);
});

// ─── POST /agent-events — publish ─────────────────────────────────────────────

agentEventsRoute.post(
	"/",
	zValidator("json", PublishEventSchema),
	async (c) => {
		const companyId = getCompanyId(c);
		const body = c.req.valid("json");
		const eventInput: Omit<AgentEvent, "id" | "createdAt"> = {
			companyId,
			eventType: body.eventType,
			sourceAgent: body.sourceAgent,
			payload: body.payload,
		};
		if (body.targetAgent) eventInput.targetAgent = body.targetAgent;
		if (body.issueId) eventInput.issueId = body.issueId;
		if (body.runId) eventInput.runId = body.runId;
		const id = publishEvent(eventInput);
		await logActivity(c, "publish_agent_event", "agent_event", id, {
			eventType: body.eventType,
			sourceAgent: body.sourceAgent,
		});
		return c.json({ id }, 201);
	},
);

// ─── POST /agent-events/ack — acknowledge ─────────────────────────────────────

agentEventsRoute.post("/ack", zValidator("json", AckSchema), async (c) => {
	const companyId = getCompanyId(c);
	const body = c.req.valid("json");
	ackEvents(body.agentSlug, body.eventIds);
	await logActivity(c, "ack_agent_events", "agent_event_ack", body.agentSlug, {
		companyId,
		count: body.eventIds.length,
	});
	return c.json({ acked: body.eventIds.length });
});

// ─── GET /agent-events/company — all company events ──────────────────────────

agentEventsRoute.get("/company", (c) => {
	const companyId = getCompanyId(c);
	const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
	const events = getCompanyEvents(companyId, limit);
	return c.json(events);
});

// ─── POST /agent-events/insights — publish gossip ────────────────────────────

agentEventsRoute.post(
	"/insights",
	zValidator("json", PublishInsightSchema),
	async (c) => {
		const companyId = getCompanyId(c);
		const body = c.req.valid("json");
		publishInsight(
			body.agentSlug,
			companyId,
			body.insight,
			body.context,
			body.tags,
		);
		await logActivity(c, "publish_insight", "agent_insight", body.agentSlug, {
			companyId,
			tags: body.tags,
		});
		return c.json({ ok: true }, 201);
	},
);

// ─── GET /agent-events/insights — query gossip ───────────────────────────────

agentEventsRoute.get(
	"/insights",
	zValidator("query", QueryInsightSchema),
	(c) => {
		const companyId = getCompanyId(c);
		const { agentSlug, topic, limit } = c.req.valid("query");
		const results = queryInsights(agentSlug, companyId, topic, limit);
		return c.json(results);
	},
);
