/**
 * setra.sh — Company Formation: Team Broker
 *
 * TypeScript port of setra's broker.go, redesigned for setra.
 *
 * Key differences from setra's broker:
 *
 *   setra                            setra
 *   ──────────────────────────────── ──────────────────────────────────────
 *   State in JSON file               State in SQLite (team_messages table)
 *   Fixed port 7890                  Configurable port, auto-increment on conflict
 *   Single in-memory subscriber set  SSE + IPC to Electron renderer
 *   No message persistence on crash  DB-backed resume: zero message loss
 *   No per-agent cost in messages    Usage attached to every message row
 *   Global rate limit only           Global + per-agent rate limits
 *   Human approval via interview     First-class ApprovalRequest with diff viewer
 *
 * Architecture:
 *   The broker is an HTTP server spawned by the company launcher.
 *   Agents connect via MCP (the setra-core MCP server calls broker endpoints).
 *   The Electron UI subscribes via SSE for real-time updates.
 *   The broker persists all messages to SQLite via the setra DB layer.
 *
 * The broker does NOT directly spawn agents. The launcher does that.
 * The broker is purely a message bus + state store + SSE hub.
 */

import http from "node:http";
import { nanoid } from "nanoid";
import type {
	AgentActivitySnapshot,
	AgentStatus,
	AnswerApprovalRequest,
	ApprovalRequest,
	BrokerSSEEvent,
	CompanyMessage,
	CompanyTask,
	GetMessagesRequest,
	GetMessagesResponse,
	MessageUsage,
	PostApprovalRequest,
	PostMessageRequest,
	PostMessageResponse,
} from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITING
// From setra: 600 req/min global, 1000 req/min per agent.
// setra matches these defaults and makes them configurable.
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitBucket {
	timestamps: number[]; // Unix ms
}

const DEFAULT_GLOBAL_RATE_LIMIT = 600;
const DEFAULT_AGENT_RATE_LIMIT = 1000;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// From setra resume.go: messages older than 1 hour are not replayed for context.
export const STALE_MESSAGE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// BROKER DB INTERFACE
// The broker needs to persist and query messages. We depend on this interface
// so the broker is testable without a real SQLite connection.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerDB {
	/** Persist a message and return it with server-assigned timestamps. */
	insertMessage(
		msg: Omit<CompanyMessage, "createdAt" | "reactions">,
	): Promise<CompanyMessage>;

	/** Fetch messages with cursor-based pagination. */
	getMessages(params: {
		companyRunId: string;
		channel: string;
		sinceId?: string;
		limit: number;
		scope?: "all" | "agent" | "inbox" | "outbox";
		mySlug?: string;
	}): Promise<CompanyMessage[]>;

	/** Get ALL messages for a run (used for resume packet building). */
	getAllMessages(companyRunId: string): Promise<CompanyMessage[]>;

	/** Persist a task update. */
	upsertTask(
		task: Omit<CompanyTask, "createdAt" | "updatedAt">,
	): Promise<CompanyTask>;

	/** Fetch tasks for a run. */
	getTasks(
		companyRunId: string,
		includeCompleted?: boolean,
	): Promise<CompanyTask[]>;

	/** Persist an approval request. */
	insertApprovalRequest(
		req: Omit<ApprovalRequest, "createdAt" | "updatedAt">,
	): Promise<ApprovalRequest>;

	/** Update approval request status. */
	updateApprovalRequest(
		id: string,
		update: Partial<ApprovalRequest>,
	): Promise<ApprovalRequest>;

	/** Get pending approval requests for a run. */
	getPendingApprovals(companyRunId: string): Promise<ApprovalRequest[]>;

	/** Update per-member cost in company_runs. */
	updateRunCost(
		companyRunId: string,
		memberSlug: string,
		usage: MessageUsage,
	): Promise<void>;

	/** Record an agent activity snapshot. */
	upsertActivity(
		snapshot: AgentActivitySnapshot & { companyRunId: string },
	): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKER CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface BrokerConfig {
	companyRunId: string;
	port: number;
	/** Shared secret for bearer token auth. Random hex, generated at run start. */
	token: string;
	db: BrokerDB;
	/** CORS origins to allow (the Electron renderer origin). */
	allowedOrigins?: string[];
	globalRateLimit?: number;
	agentRateLimit?: number;
	/** Called when an approval request is answered. Launcher uses this to resume blocked agents. */
	onApprovalAnswered?: (req: ApprovalRequest) => void;
	/** Called when a message is posted (launcher uses for agent wake-up logic). */
	onMessage?: (msg: CompanyMessage) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROKER CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class TeamBroker {
	private readonly config: BrokerConfig;
	private server: http.Server | null = null;
	private readonly token: string;

	// In-memory caches (written-through to DB)
	private messages: Map<string, CompanyMessage[]> = new Map(); // channel → messages
	private tasks: CompanyTask[] = [];
	private approvals: ApprovalRequest[] = [];
	private activity: Map<string, AgentActivitySnapshot> = new Map(); // slug → snapshot
	private lastTaggedAt: Map<string, number> = new Map(); // slug → unix ms

	// SSE subscribers: subscriber ID → response writer
	private subscribers: Map<number, http.ServerResponse> = new Map();
	private nextSubscriberId = 0;

	// Rate limiting
	private globalBucket: RateLimitBucket = { timestamps: [] };
	private agentBuckets: Map<string, RateLimitBucket> = new Map();
	private lastRateLimitPrune = Date.now();

	private stopped = false;

	constructor(config: BrokerConfig) {
		this.config = config;
		this.token = config.token;
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────

	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				void this.handleRequest(req, res).catch((err) => {
					console.error("[broker] unhandled error:", err);
					res
						.writeHead(500)
						.end(JSON.stringify({ error: "internal server error" }));
				});
			});

			this.server.listen(this.config.port, "127.0.0.1", () => {
				console.log(
					`[broker] listening on :${this.config.port} (run: ${this.config.companyRunId})`,
				);
				resolve();
			});

			this.server.once("error", reject);
		});
	}

	async stop(): Promise<void> {
		this.stopped = true;
		// Drain all SSE subscribers
		for (const [, res] of this.subscribers) {
			try {
				res.end();
			} catch {
				/* ignore */
			}
		}
		this.subscribers.clear();
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => resolve());
			} else {
				resolve();
			}
		});
	}

	// ─── HTTP Request Router ───────────────────────────────────────────────────

	private async handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const url = new URL(req.url ?? "/", `http://localhost:${this.config.port}`);

		// CORS for Electron renderer
		const origin = req.headers.origin ?? "";
		if (this.isAllowedOrigin(origin)) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.setHeader(
				"Access-Control-Allow-Headers",
				"Content-Type, Authorization, X-Setra-Agent",
			);
		}
		if (req.method === "OPTIONS") {
			res.writeHead(204).end();
			return;
		}

		// Auth: Bearer token required for all endpoints except /health and /events
		const isPublicPath =
			url.pathname === "/health" || url.pathname === "/events";
		if (!isPublicPath) {
			const authHeader = req.headers.authorization ?? "";
			if (
				!authHeader.startsWith("Bearer ") ||
				authHeader.slice(7) !== this.token
			) {
				res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
				return;
			}
		}

		// Global rate limit
		if (!isPublicPath && !this.checkGlobalRateLimit()) {
			res.writeHead(429).end(JSON.stringify({ error: "rate limit exceeded" }));
			return;
		}

		// Per-agent rate limit (from X-Setra-Agent header, same as setra's X-setra-Agent)
		const agentSlug = (req.headers["x-setra-agent"] as string) ?? "";
		if (agentSlug && !this.checkAgentRateLimit(agentSlug)) {
			res
				.writeHead(429)
				.end(
					JSON.stringify({ error: `agent ${agentSlug} rate limit exceeded` }),
				);
			return;
		}

		// Route
		const method = req.method ?? "GET";
		const path = url.pathname;

		if (method === "GET" && path === "/health")
			return this.handleHealth(req, res);
		if (method === "GET" && path === "/events") return this.handleSSE(req, res);
		if (method === "POST" && path === "/messages")
			return this.handlePostMessage(req, res);
		if (method === "GET" && path === "/messages")
			return this.handleGetMessages(req, res, url);
		if (method === "GET" && path === "/tasks")
			return this.handleGetTasks(req, res, url);
		if (method === "POST" && path === "/tasks")
			return this.handlePostTask(req, res);
		if (method === "GET" && path === "/approvals")
			return this.handleGetApprovals(req, res);
		if (method === "POST" && path === "/approvals")
			return this.handlePostApproval(req, res);
		if (
			method === "POST" &&
			path.startsWith("/approvals/") &&
			path.endsWith("/answer")
		)
			return this.handleAnswerApproval(req, res, path);
		if (method === "POST" && path === "/activity")
			return this.handlePostActivity(req, res);
		if (method === "GET" && path === "/activity")
			return this.handleGetActivity(req, res);
		if (method === "POST" && path === "/agent-heartbeat")
			return this.handleAgentHeartbeat(req, res);
		if (method === "GET" && path === "/agent-activity")
			return this.handleGetActivity(req, res);
		if (method === "POST" && path === "/messages/react")
			return this.handleReact(req, res);
		if (method === "GET" && path === "/members")
			return this.handleGetMembers(req, res);
		if (method === "GET" && path === "/channels")
			return this.handleGetChannels(req, res);

		res.writeHead(404).end(JSON.stringify({ error: "not found" }));
	}

	// ─── SSE (Server-Sent Events) ───────────────────────────────────────────────
	// Streams real-time events to the Electron UI and to agent-monitoring code.
	// setra: browser-based SSE to web UI. setra: same pattern, targeted at Electron.

	private handleSSE(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		const id = this.nextSubscriberId++;
		this.subscribers.set(id, res);

		// Send a heartbeat every 15s to keep the connection alive
		const heartbeat = setInterval(() => {
			this.sendSSEToOne(res, {
				type: "heartbeat",
				data: { ts: new Date().toISOString() },
			});
		}, 15_000);

		res.on("close", () => {
			clearInterval(heartbeat);
			this.subscribers.delete(id);
		});
	}

	private broadcastSSE(event: BrokerSSEEvent): void {
		const payload = `data: ${JSON.stringify(event)}\n\n`;
		for (const [, res] of this.subscribers) {
			try {
				res.write(payload);
			} catch {
				/* subscriber disconnected */
			}
		}
	}

	private sendSSEToOne(res: http.ServerResponse, event: BrokerSSEEvent): void {
		try {
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		} catch {
			/* ignore */
		}
	}

	// ─── Messages ───────────────────────────────────────────────────────────────

	private async handlePostMessage(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const body = await readBody<PostMessageRequest>(req);
		if (!body.channel || !body.from || !body.content) {
			res
				.writeHead(400)
				.end(
					JSON.stringify({ error: "channel, from, and content are required" }),
				);
			return;
		}

		// Auto-detect @mentions not in tagged array (same as setra detectUntaggedMentions)
		const tagged = body.tagged ?? [];
		const autoTagged = detectUntaggedMentions(body.content, tagged);
		const effectiveTagged = autoTagged.length
			? [...tagged, ...autoTagged]
			: tagged;

		const msg = await this.config.db.insertMessage({
			id: nanoid(),
			companyRunId: this.config.companyRunId,
			channel: body.channel,
			from: body.from,
			kind: body.kind ?? "text",
			content: body.content,
			tagged: effectiveTagged,
			replyTo: body.replyTo ?? null,
			approvalRequestId: null,
			usage: body.usage ?? null,
		});

		// Track last time each tagged agent was mentioned (for wake-up logic in launcher)
		const now = Date.now();
		for (const slug of effectiveTagged) {
			this.lastTaggedAt.set(slug, now);
		}

		// Update per-member cost if usage is present
		if (body.usage && body.from !== "human") {
			await this.config.db.updateRunCost(
				this.config.companyRunId,
				body.from,
				body.usage,
			);
			this.broadcastSSE({
				type: "cost_update",
				data: {
					runId: this.config.companyRunId,
					member: body.from,
					costUsd: body.usage.costUsd,
					totalCostUsd: this.getTotalCostForMember(body.from),
				},
			});
		}

		this.broadcastSSE({ type: "message", data: msg });
		this.config.onMessage?.(msg);

		const response: PostMessageResponse = {
			id: msg.id,
			channel: msg.channel,
			from: msg.from,
			timestamp: msg.createdAt,
		};
		res.writeHead(200).end(JSON.stringify(response));
	}

	private async handleGetMessages(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
		url: URL,
	): Promise<void> {
		const sinceId = url.searchParams.get("since_id");
		const mySlug = url.searchParams.get("my_slug");
		const params: GetMessagesRequest = {
			channel: url.searchParams.get("channel") ?? "general",
			limit: Math.min(
				Number.parseInt(url.searchParams.get("limit") ?? "10", 10),
				100,
			),
			scope:
				(url.searchParams.get("scope") as GetMessagesRequest["scope"]) ?? "all",
			...(sinceId ? { sinceId } : {}),
			...(mySlug ? { mySlug } : {}),
		};

		const messages = await this.config.db.getMessages({
			companyRunId: this.config.companyRunId,
			...params,
			limit: params.limit ?? 10,
		});

		const taggedCount = params.mySlug
			? messages.filter((m) => m.tagged.includes(params.mySlug!)).length
			: 0;

		const lastId =
			messages.length > 0 ? messages[messages.length - 1]?.id : undefined;
		const response: GetMessagesResponse = {
			messages,
			taggedCount,
			...(lastId ? { nextCursor: lastId } : {}),
		};
		res.writeHead(200).end(JSON.stringify(response));
	}

	// ─── Tasks ──────────────────────────────────────────────────────────────────

	private async handleGetTasks(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
		url: URL,
	): Promise<void> {
		const includeDone = url.searchParams.get("include_done") === "true";
		const tasks = await this.config.db.getTasks(
			this.config.companyRunId,
			includeDone,
		);
		res.writeHead(200).end(JSON.stringify({ tasks }));
	}

	private async handlePostTask(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const body = await readBody<Partial<CompanyTask>>(req);
		if (!body.title || !body.createdBy) {
			res
				.writeHead(400)
				.end(JSON.stringify({ error: "title and createdBy are required" }));
			return;
		}

		const task = await this.config.db.upsertTask({
			id: body.id ?? nanoid(),
			companyRunId: this.config.companyRunId,
			channel: body.channel ?? "general",
			title: body.title,
			details: body.details ?? null,
			owner: body.owner ?? null,
			createdBy: body.createdBy,
			status: body.status ?? "open",
			taskType: body.taskType ?? null,
			worktreeBranch: body.worktreeBranch ?? null,
			worktreePath: body.worktreePath ?? null,
			dependsOn: body.dependsOn ?? [],
			threadId: body.threadId ?? null,
			completedAt: null,
		});

		this.broadcastSSE({ type: "task", data: task });
		res.writeHead(200).end(JSON.stringify(task));
	}

	// ─── Approval Requests ──────────────────────────────────────────────────────

	private async handleGetApprovals(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const approvals = await this.config.db.getPendingApprovals(
			this.config.companyRunId,
		);
		res.writeHead(200).end(JSON.stringify({ approvals }));
	}

	private async handlePostApproval(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const body = await readBody<PostApprovalRequest>(req);
		if (!body.fromMember || !body.title || !body.description || !body.kind) {
			res.writeHead(400).end(
				JSON.stringify({
					error: "fromMember, title, description, kind required",
				}),
			);
			return;
		}

		const approval = await this.config.db.insertApprovalRequest({
			id: nanoid(),
			companyRunId: this.config.companyRunId,
			fromMember: body.fromMember,
			channel: body.channel,
			title: body.title,
			description: body.description,
			kind: body.kind,
			payload: body.payload ?? null,
			diff: body.diff ?? null,
			status: "pending",
			blocking: body.blocking ?? false,
			humanResponse: null,
			answeredAt: null,
		});

		this.broadcastSSE({ type: "approval_request", data: approval });

		// If blocking, post a system message to the channel
		if (body.blocking) {
			await this.config.db.insertMessage({
				id: nanoid(),
				companyRunId: this.config.companyRunId,
				channel: body.channel,
				from: body.fromMember,
				kind: "approval",
				content: `⏸ **Approval required**: ${body.title}\n\n${body.description}`,
				tagged: ["human"],
				replyTo: null,
				approvalRequestId: approval.id,
				usage: null,
			});
		}

		res.writeHead(200).end(JSON.stringify(approval));
	}

	private async handleAnswerApproval(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		path: string,
	): Promise<void> {
		// path: /approvals/{id}/answer
		const approvalId = path.split("/")[2];
		if (!approvalId) {
			res
				.writeHead(400)
				.end(JSON.stringify({ error: "approval id required in path" }));
			return;
		}

		const body = await readBody<AnswerApprovalRequest>(req);
		if (!body.status) {
			res.writeHead(400).end(JSON.stringify({ error: "status required" }));
			return;
		}

		const updated = await this.config.db.updateApprovalRequest(approvalId, {
			status: body.status,
			humanResponse: body.humanResponse ?? null,
			answeredAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		this.broadcastSSE({ type: "approval_answered", data: updated });
		this.config.onApprovalAnswered?.(updated);

		res.writeHead(200).end(JSON.stringify(updated));
	}

	// ─── Activity ───────────────────────────────────────────────────────────────

	private async handlePostActivity(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const body = await readBody<AgentActivitySnapshot>(req);
		if (!body.slug) {
			res.writeHead(400).end(JSON.stringify({ error: "slug required" }));
			return;
		}

		const snapshot: AgentActivitySnapshot = {
			slug: body.slug,
			status: body.status ?? "idle",
			activity: body.activity ?? "",
			lastTime: new Date().toISOString(),
			totalMs: body.totalMs ?? 0,
			firstEventMs: body.firstEventMs ?? 0,
			firstTextMs: body.firstTextMs ?? 0,
			firstToolMs: body.firstToolMs ?? 0,
			costUsd: body.costUsd ?? 0,
			...(body.detail ? { detail: body.detail } : {}),
			...(body.currentTaskId ? { currentTaskId: body.currentTaskId } : {}),
		};

		this.activity.set(body.slug, snapshot);
		await this.config.db.upsertActivity({
			...snapshot,
			companyRunId: this.config.companyRunId,
		});
		this.broadcastSSE({ type: "activity", data: snapshot });

		res.writeHead(200).end(JSON.stringify({ ok: true }));
	}

	private handleGetActivity(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		const snapshots = Array.from(this.activity.values());
		res.writeHead(200).end(JSON.stringify({ activity: snapshots }));
	}

	// ─── Agent Heartbeat ─────────────────────────────────────────────────────────
	// Agents call POST /agent-heartbeat every ~15s to report presence.
	// Updates the in-memory activity map and broadcasts an SSE "activity" event.

	private async handleAgentHeartbeat(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const body = await readBody<{
			slug: string;
			status?: AgentStatus;
			activity?: string;
			detailedActivity?: string;
		}>(req);

		if (!body.slug) {
			res.writeHead(400).end(JSON.stringify({ error: "slug required" }));
			return;
		}

		const existing = this.activity.get(body.slug);
		const detail = body.detailedActivity ?? existing?.detail;
		const currentTask = existing?.currentTaskId;
		const snapshot: AgentActivitySnapshot = {
			slug: body.slug,
			status: body.status ?? existing?.status ?? "idle",
			activity: body.activity ?? existing?.activity ?? "heartbeat",
			lastTime: new Date().toISOString(),
			totalMs: existing?.totalMs ?? 0,
			firstEventMs: existing?.firstEventMs ?? 0,
			firstTextMs: existing?.firstTextMs ?? 0,
			firstToolMs: existing?.firstToolMs ?? 0,
			costUsd: existing?.costUsd ?? 0,
			...(detail ? { detail } : {}),
			...(currentTask ? { currentTaskId: currentTask } : {}),
		};

		this.activity.set(body.slug, snapshot);
		await this.config.db.upsertActivity({
			...snapshot,
			companyRunId: this.config.companyRunId,
		});
		this.broadcastSSE({ type: "activity", data: snapshot });

		res.writeHead(200).end(JSON.stringify({ ok: true }));
	}

	// ─── Reactions ──────────────────────────────────────────────────────────────

	private async handleReact(
		req: http.IncomingMessage,
		res: http.ServerResponse,
	): Promise<void> {
		const body = await readBody<{
			messageId: string;
			emoji: string;
			from: string;
		}>(req);
		if (!body.messageId || !body.emoji || !body.from) {
			res
				.writeHead(400)
				.end(JSON.stringify({ error: "messageId, emoji, from required" }));
			return;
		}
		// TODO: update team_messages reactions_json column
		res.writeHead(200).end(JSON.stringify({ ok: true }));
	}

	// ─── Roster ─────────────────────────────────────────────────────────────────

	private handleGetMembers(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		const members = Array.from(this.activity.values()).map((a) => ({
			slug: a.slug,
			status: a.status,
			activity: a.activity,
			costUsd: a.costUsd,
			lastTime: a.lastTime,
		}));
		res.writeHead(200).end(JSON.stringify({ members }));
	}

	private handleGetChannels(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		// Channels are loaded from the company definition at startup; returned here
		// for agent tooling (team_channels MCP tool calls this endpoint).
		res.writeHead(200).end(JSON.stringify({ channels: [] })); // populated by launcher on startup
	}

	// ─── Health ─────────────────────────────────────────────────────────────────

	private handleHealth(
		_req: http.IncomingMessage,
		res: http.ServerResponse,
	): void {
		res.writeHead(200).end(
			JSON.stringify({
				ok: true,
				runId: this.config.companyRunId,
				port: this.config.port,
				subscribers: this.subscribers.size,
				agents: this.activity.size,
			}),
		);
	}

	// ─── Resume Packet Builder (ported from setra resume.go) ───────────────────
	//
	// On broker restart (Electron crash, machine reboot), agents need to
	// know where they left off. buildResumePackets constructs a per-agent
	// context string by combining:
	//   1. Active tasks owned by each agent
	//   2. Unanswered human messages in the last hour
	//
	// Messages older than STALE_MESSAGE_THRESHOLD_MS are dropped — they
	// represent zombie work the human has almost certainly moved on from.
	// This is exactly setra's staleUnansweredThreshold logic, ported to TS.

	async buildResumePackets(
		memberSlugs: string[],
		leadSlug: string,
	): Promise<Map<string, string>> {
		const allMessages = await this.config.db.getAllMessages(
			this.config.companyRunId,
		);
		const tasks = await this.config.db.getTasks(
			this.config.companyRunId,
			false,
		);
		const now = Date.now();
		const cutoff = new Date(now - STALE_MESSAGE_THRESHOLD_MS).toISOString();

		// Separate human messages
		const humanMessages = allMessages.filter(
			(m) => m.from === "human" && m.createdAt >= cutoff,
		);

		// Find messages that have NOT been replied to by any agent
		const repliedToIds = new Set(
			allMessages
				.filter((m) => m.from !== "human" && m.replyTo)
				.map((m) => m.replyTo!),
		);
		const unanswered = humanMessages.filter((m) => !repliedToIds.has(m.id));

		// Group tasks by owner
		const tasksByAgent = new Map<string, CompanyTask[]>();
		for (const task of tasks) {
			if (!task.owner) continue;
			if (!memberSlugs.includes(task.owner)) continue;
			const existing = tasksByAgent.get(task.owner) ?? [];
			existing.push(task);
			tasksByAgent.set(task.owner, existing);
		}

		// Route unanswered messages: tagged → each tagged agent; untagged → lead
		const msgsByAgent = new Map<string, CompanyMessage[]>();
		for (const msg of unanswered) {
			const targets = msg.tagged.length
				? msg.tagged.filter((s) => memberSlugs.includes(s))
				: [leadSlug];
			for (const slug of targets) {
				const existing = msgsByAgent.get(slug) ?? [];
				existing.push(msg);
				msgsByAgent.set(slug, existing);
			}
		}

		const packets = new Map<string, string>();
		for (const slug of memberSlugs) {
			const agentTasks = tasksByAgent.get(slug) ?? [];
			const agentMsgs = msgsByAgent.get(slug) ?? [];
			if (agentTasks.length === 0 && agentMsgs.length === 0) continue;
			packets.set(slug, buildResumeText(slug, agentTasks, agentMsgs));
		}

		return packets;
	}

	// ─── Helpers ────────────────────────────────────────────────────────────────

	private isAllowedOrigin(origin: string): boolean {
		if (!origin) return true; // same-origin requests
		const allowed = this.config.allowedOrigins ?? [];
		if (allowed.length === 0) return true;
		return allowed.includes(origin);
	}

	private checkGlobalRateLimit(): boolean {
		return checkBucket(
			this.globalBucket,
			this.config.globalRateLimit ?? DEFAULT_GLOBAL_RATE_LIMIT,
		);
	}

	private checkAgentRateLimit(agentSlug: string): boolean {
		let bucket = this.agentBuckets.get(agentSlug);
		if (!bucket) {
			bucket = { timestamps: [] };
			this.agentBuckets.set(agentSlug, bucket);
		}
		return checkBucket(
			bucket,
			this.config.agentRateLimit ?? DEFAULT_AGENT_RATE_LIMIT,
		);
	}

	private getTotalCostForMember(_slug: string): number {
		// Stub — the real implementation reads from companyRuns.costByMemberJson
		return 0;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function checkBucket(bucket: RateLimitBucket, limit: number): boolean {
	const now = Date.now();
	const window = now - RATE_LIMIT_WINDOW_MS;
	// Prune stale timestamps
	bucket.timestamps = bucket.timestamps.filter((t) => t > window);
	if (bucket.timestamps.length >= limit) return false;
	bucket.timestamps.push(now);
	return true;
}

async function readBody<T>(req: http.IncomingMessage): Promise<T> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.setEncoding("utf-8");
		req.on("data", (chunk: string) => {
			raw += chunk;
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(raw) as T);
			} catch {
				reject(new Error("invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}

/**
 * Auto-detect @slug mentions in content that are not already in tagged.
 * Ported from setra's detectUntaggedMentions (server.go).
 * Only flags slug-like words: alphanumeric + hyphens, 2-20 chars.
 */
function detectUntaggedMentions(content: string, tagged: string[]): string[] {
	const taggedSet = new Set(tagged.map((t) => t.toLowerCase().trim()));
	const skipSet = new Set([
		"you",
		"human",
		"nex",
		"system",
		"everyone",
		"all",
		"team",
		"channel",
	]);
	const seen = new Set<string>();
	const out: string[] = [];

	for (const word of content.split(/\s+/)) {
		if (!word.startsWith("@")) continue;
		const raw = word
			.slice(1)
			.replace(/[.,;:!?)]+$/, "")
			.toLowerCase();
		if (raw.length < 2 || raw.length > 20) continue;
		if (!/^[a-z0-9-]+$/.test(raw)) continue;
		if (skipSet.has(raw) || taggedSet.has(raw) || seen.has(raw)) continue;
		seen.add(raw);
		out.push(raw);
	}
	return out;
}

/**
 * Build a resume context string for an agent.
 * Ported from setra's buildResumePacket (resume.go).
 */
function buildResumeText(
	slug: string,
	tasks: CompanyTask[],
	msgs: CompanyMessage[],
): string {
	const lines: string[] = [
		"[Session resumed — picking up where you left off]\n",
	];

	if (tasks.length > 0) {
		lines.push("Active tasks:");
		for (const task of tasks) {
			lines.push(`- [${task.id}] ${task.title} (status: ${task.status})`);
			if (task.details) lines.push(`  ${task.details}`);
			if (task.worktreePath)
				lines.push(`  Working directory: ${task.worktreePath}`);
		}
		lines.push("");
	}

	if (msgs.length > 0) {
		lines.push("Unanswered messages:");
		for (const msg of msgs) {
			const ch = msg.channel || "general";
			lines.push(
				`- @${msg.from} (channel: "${ch}", reply_to_id: "${msg.id}"): ${msg.content}`,
			);
		}
		lines.push("");
		lines.push(
			`Reply using team_broadcast with my_slug "${slug}" and the channel and reply_to_id shown above.`,
		);
	}

	lines.push("Please pick up where you left off.");
	return lines.join("\n");
}
