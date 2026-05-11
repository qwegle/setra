import type { DomainEvent } from "@setra/domain";
import { InMemoryEventBus } from "@setra/infrastructure";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

type Subscriber = {
	companyId: string | null;
	topics: Set<string> | null;
	send: (id: string, event: string, data: unknown) => void;
};

/**
 * Map SSE event names to a coarse topic taxonomy so clients can subscribe
 * narrowly via `?topics=runs,activity,approvals,issues,wiki`. Inspired by
 * WUPHF's five orthogonal subscriber sets (broker_streams.go). Unknown event
 * names fall through to the catch-all `other` topic.
 */
function topicForEvent(event: string): string {
	if (event === "ping") return "ping";
	if (event.startsWith("run:")) return "runs";
	if (event.startsWith("issue:")) return "issues";
	if (event.startsWith("approval") || event === "review_resolved")
		return "approvals";
	if (event.startsWith("activity") || event.startsWith("agent:"))
		return "activity";
	if (event.startsWith("wiki")) return "wiki";
	if (event.startsWith("office") || event.startsWith("workspace"))
		return "office";
	return "other";
}

function parseTopics(raw: string | null | undefined): Set<string> | null {
	if (!raw) return null;
	const parts = raw
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (parts.length === 0) return null;
	if (parts.includes("*") || parts.includes("all")) return null;
	return new Set(parts);
}

function topicMatches(
	subscriberTopics: Set<string> | null,
	event: string,
): boolean {
	if (!subscriberTopics) return true;
	const topic = topicForEvent(event);
	if (topic === "ping") return true;
	return subscriberTopics.has(topic);
}

type BufferedEvent = {
	id: number;
	event: string;
	data: unknown;
	companyId: string | null;
};

const subscribers = new Set<Subscriber>();
const eventBuffer: BufferedEvent[] = [];
const MAX_BUFFERED_EVENTS = 1000;
let nextEventId = 1;

function payloadCompanyId(data: unknown): string | null {
	return typeof data === "object" &&
		data !== null &&
		"companyId" in (data as Record<string, unknown>)
		? (((data as Record<string, unknown>)["companyId"] as
				| string
				| null
				| undefined) ?? null)
		: null;
}

function shouldDeliver(
	subscriberCompanyId: string | null,
	eventCompanyId: string | null,
): boolean {
	if (eventCompanyId === null) return true;
	if (subscriberCompanyId === null) return true;
	return subscriberCompanyId === eventCompanyId;
}

function rememberEvent(event: string, data: unknown): string {
	const record: BufferedEvent = {
		id: nextEventId++,
		event,
		data,
		companyId: payloadCompanyId(data),
	};
	eventBuffer.push(record);
	if (eventBuffer.length > MAX_BUFFERED_EVENTS)
		eventBuffer.splice(0, eventBuffer.length - MAX_BUFFERED_EVENTS);
	return String(record.id);
}

function replayBufferedEvents(
	subscriber: Subscriber,
	lastEventId: number,
): void {
	for (const record of eventBuffer) {
		if (record.id <= lastEventId) continue;
		if (!shouldDeliver(subscriber.companyId, record.companyId)) continue;
		if (!topicMatches(subscriber.topics, record.event)) continue;
		subscriber.send(String(record.id), record.event, record.data);
	}
}

function broadcast(event: string, data: unknown = {}) {
	const eventId = rememberEvent(event, data);
	const eventCompanyId = payloadCompanyId(data);
	for (const sub of subscribers) {
		if (!shouldDeliver(sub.companyId, eventCompanyId)) continue;
		if (!topicMatches(sub.topics, event)) continue;
		try {
			sub.send(eventId, event, data);
		} catch {
			/* client disconnected */
		}
	}
}

export const domainEventBus = new InMemoryEventBus<DomainEvent>();

function mapDomainEventToSse(
	event: DomainEvent,
): { event: string; data: unknown } | null {
	switch (event.type) {
		case "issue.updated":
			return {
				event: "issue:updated",
				data: {
					id: event.issueId,
					projectId: event.projectId,
					event: event.event,
					branchName: event.branchName,
					sha: event.sha,
					prUrl: event.prUrl,
					lifecycleStage: event.lifecycleStage,
					companyId: event.companyId,
				},
			};
		case "run.updated":
			return {
				event: "run:updated",
				data: {
					runId: event.runId,
					agentId: event.agentId,
					issueId: event.issueId,
					status: event.status,
					event: event.event,
					companyId: event.companyId,
				},
			};
		case "run.completed":
			return {
				event: "run:completed",
				data: {
					runId: event.runId,
					agentId: event.agentId,
					issueId: event.issueId,
					status: event.status,
					companyId: event.companyId,
				},
			};
		default:
			return null;
	}
}

domainEventBus.subscribe("*", (event) => {
	const mapped = mapDomainEventToSse(event);
	if (mapped) broadcast(mapped.event, mapped.data);
});

export function publishDomainEvent(event: DomainEvent) {
	domainEventBus.publish(event);
}

export function emit(event: string, data: unknown = {}) {
	broadcast(event, data);
}

export const sseRoute = new Hono();

sseRoute.get("/", (c) => {
	const companyId =
		(c.get("companyId") as string | undefined) ??
		c.req.header("x-company-id") ??
		c.req.query("companyId") ??
		null;
	const lastEventId = Number.parseInt(
		c.req.header("Last-Event-ID") ?? c.req.query("lastEventId") ?? "0",
		10,
	);
	const topics = parseTopics(c.req.query("topics"));
	return streamSSE(c, async (stream) => {
		const subscriber: Subscriber = {
			companyId,
			topics,
			send: (id, event, data) => {
				stream
					.writeSSE({ id, event, data: JSON.stringify(data) })
					.catch(() => {});
			},
		};

		subscribers.add(subscriber);
		if (Number.isFinite(lastEventId) && lastEventId > 0) {
			replayBufferedEvents(subscriber, lastEventId);
		}

		const kv = setInterval(
			() => stream.writeSSE({ event: "ping", data: "" }).catch(() => {}),
			15_000,
		);

		await new Promise<void>((resolve) => {
			stream.onAbort(() => resolve());
		});

		clearInterval(kv);
		subscribers.delete(subscriber);
	});
});
