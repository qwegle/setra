/**
 * setra.sh — Company Formation: Core TypeScript Types
 *
 * Design philosophy:
 *   - setra stores company state in JSON files. setra stores it in SQLite.
 *   - setra has a single model per company. setra has per-member model selection.
 *   - setra tracks total cost. setra tracks cost per-agent, per-run, per-channel.
 *   - setra's broker is in-memory. setra's broker persists messages in SQLite.
 *
 * Naming:
 *   Company   — the team definition (persisted in DB, loaded from company.json)
 *   Member    — a single AI agent within a company
 *   Channel   — a named communication channel agents post into
 *   Run       — a single company execution session (ties to setra `runs` table)
 *   Message   — one message posted by an agent or human
 *   ApprovalRequest — human-in-the-loop gate before code is merged
 */

// ─────────────────────────────────────────────────────────────────────────────
// A.1  MODEL SELECTION
// ─────────────────────────────────────────────────────────────────────────────

/** Every model setra.sh supports at launch. Extend as providers add models. */
export type ModelId =
	// Anthropic
	| "claude-opus-4-5"
	| "claude-sonnet-4-5"
	| "claude-haiku-3-5"
	| "claude-opus-4"
	| "claude-sonnet-4"
	| "claude-haiku-3"
	// OpenAI
	| "gpt-4o"
	| "gpt-4o-mini"
	| "o1"
	| "o1-mini"
	| "o3"
	| "o4-mini"
	// Google
	| "gemini-2.5-pro"
	| "gemini-2.5-flash"
	| "gemini-2.0-flash"
	// xAI
	| "grok-3"
	| "grok-3-mini"
	// Ollama (local)
	| `ollama/${string}`
	// LM Studio (local)
	| `lmstudio/${string}`;

/** Per-model pricing for ledger cost calculation (USD per 1M tokens). */
export interface ModelPricing {
	modelId: ModelId;
	inputPer1M: number;
	outputPer1M: number;
	cacheReadPer1M: number; // always cheaper than input
	cacheWritePer1M: number; // always more expensive than input (first-time only)
}

// ─────────────────────────────────────────────────────────────────────────────
// A.2  PERMISSION MODEL
// Each member gets a scoped permission mode and allowed tool list.
// Directly ported from setra's permission_mode + allowed_tools pattern,
// but extended to support deny-lists in addition to allow-lists.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Controls how much the agent can do without human confirmation.
 *
 *   "auto"     — agent runs all tools without asking (coding workers)
 *   "plan"     — agent plans and presents; human confirms execution (architects)
 *   "readonly" — agent can read files/run read tools; no writes (auditors)
 *   "supervised" — every tool call requires human approval (high-risk contexts)
 */
export type PermissionMode = "auto" | "plan" | "readonly" | "supervised";

/**
 * Tool scope for a single member.
 *
 * setra uses a flat `allowed_tools` string array like:
 *   ["Edit", "Write", "Bash(go*,git*,npm*)"]
 *
 * setra extends this with an explicit deny list and MCP server scoping.
 * This way security auditors can be "readonly" with an explicit deny list
 * rather than requiring an exhaustive allow list.
 */
export interface ToolScope {
	/**
	 * Explicitly allowed tools (claude code tool names or glob patterns).
	 * If empty AND denyList is empty, the permission_mode determines defaults.
	 *
	 * Examples:
	 *   "Edit"              — file edits
	 *   "Write"             — file writes
	 *   "Bash(git*,npm*)"   — bash with git and npm only
	 *   "Bash(*)"           — unrestricted bash (careful)
	 *   "mcp__setra-core__*" — all setra-core MCP tools
	 */
	allowList?: string[];

	/**
	 * Explicitly denied tools regardless of allow list.
	 * Useful for "can do everything EXCEPT deploy/delete."
	 *
	 * Examples:
	 *   "Bash(rm*,sudo*)"
	 *   "mcp__setra-core__deploy_trigger"
	 */
	denyList?: string[];

	/**
	 * Which MCP servers this member can access.
	 * setra-core (team broker tools) is always included.
	 * User-added MCP servers are opt-in per member.
	 */
	mcpServers?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// A.3  COMPANY MEMBER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single AI agent in a company.
 *
 * setra's equivalent is `MemberSpec` / `officeMember`.
 * setra improvements:
 *   - `model`: explicit per-member model selection (setra uses global config)
 *   - `systemPrompt`: full per-member system prompt (setra uses personality string)
 *   - `toolScope`: structured allow/deny (setra uses flat string array)
 *   - `maxTurns`: per-member cap (setra hard-codes CEO=30, workers=15)
 *   - `worktreeIsolation`: whether to give this member its own git worktree
 *   - `costBudgetUsd`: optional hard spending cap per run
 */
export interface CompanyMember {
	/**
	 * URL-safe identifier for this member. Used in @mentions, routing, channels.
	 * Must be unique within the company.
	 * Examples: "ceo", "fe", "be", "qa", "tech-lead"
	 */
	slug: string;

	/** Display name shown in the UI and in @mention completions. */
	name: string;

	/**
	 * High-level role label. Shown in the UI member card.
	 * Not functionally constrained — any string is valid.
	 * Examples: "Architect", "Frontend Engineer", "QA Lead"
	 */
	role: string;

	/**
	 * The AI model this member uses.
	 * Different members CAN use different models — this is setra's differentiator.
	 * Convention: lead/architect = opus, workers = sonnet, reviewers = haiku.
	 */
	model: ModelId;

	/**
	 * Full system prompt for this member. Replaces setra's `personality` string.
	 *
	 * setra injects the following sections automatically BEFORE this prompt:
	 *   1. [SETRA-CORE RULES]     — immutable safety/coordination rules
	 *   2. [COMPANY CONTEXT]      — company name, description, team roster
	 *   3. [MEMBER ROLE]          — this member's slug, name, role, expertise
	 *   4. [systemPrompt]         — THIS FIELD (operator-defined)
	 *   5. [UNTRUSTED CONTEXT]    — memory injection (wrapped in untrusted fence)
	 *
	 * IMPORTANT: The static prefix (sections 1-3) is identical across all turns
	 * for this member. Anthropic's prompt cache will cache it after turn 1.
	 * This is the 9x token savings trick from setra. Do NOT put dynamic content
	 * in the system prompt — put it in the task notification (stdin payload).
	 */
	systemPrompt: string;

	/**
	 * Skill areas this member is expert in.
	 * Used by the CEO/lead to route tasks to the right member.
	 * Also shown in the UI member card.
	 */
	expertise: string[];

	/** Controls how much the agent can act without human approval. */
	permissionMode: PermissionMode;

	/** Fine-grained tool access control. */
	toolScope?: ToolScope;

	/**
	 * Maximum number of agentic turns per invocation.
	 * Convention: lead = 30, workers = 15, reviewers = 10.
	 * setra hard-codes these. setra makes them configurable.
	 */
	maxTurns: number;

	/**
	 * When true, this member gets its own git worktree (setra/company-{runId}-{slug}).
	 * Coding agents should set this true. Planner/PM agents typically do not.
	 *
	 * If false, the member operates in the plot's main worktree (read-only unless
	 * permission_mode = auto and the task explicitly grants write access).
	 */
	worktreeIsolation: boolean;

	/**
	 * Optional hard cost cap in USD for this member per company run.
	 * When exceeded, the member is suspended and the lead is notified.
	 * The run continues with remaining members.
	 *
	 * null means no cap (default).
	 */
	costBudgetUsd?: number | null;

	/**
	 * If true, this is a system-managed member that cannot be removed by the user
	 * through the UI (e.g., the built-in "human" observer).
	 */
	system?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.4  CHANNELS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Channel types.
 *
 *   "broadcast" — all members can post; all subscribed members receive
 *   "dm"        — direct message between human and one agent
 *   "announce"  — lead/CEO can post; others can read only (no replies)
 *
 * setra uses "channel" and "dm". setra adds "announce" for CEO → team
 * one-way broadcasts (useful for kicking off a new phase).
 */
export type ChannelType = "broadcast" | "dm" | "announce";

/**
 * A named communication channel within a company.
 *
 * setra's equivalent is `teamChannel`.
 * setra improvements:
 *   - `type`: explicit channel type (setra infers from slug prefix "dm-")
 *   - `autoRoute`: describe what topics belong here (used by lead for routing)
 *   - `retentionHours`: how long messages persist (default: 48h)
 */
export interface CompanyChannel {
	/** URL-safe identifier. Must be unique within the company. */
	slug: string;

	/** Display name. Shown in the UI sidebar and in message headers. */
	name: string;

	/** One-sentence description of what work belongs in this channel. */
	description: string;

	/** Channel type. Determines routing and UI rendering. */
	type: ChannelType;

	/**
	 * Member slugs subscribed to this channel.
	 * These members receive task notifications when tagged in this channel.
	 * "human" is always a valid member slug (represents the operator).
	 */
	members: string[];

	/**
	 * Optional list of slugs that are present but muted (they see messages
	 * but don't get woken up). Useful for "observer" agents like a PM who
	 * watches frontend work but shouldn't be spawned for every fe message.
	 *
	 * setra calls this "disabled". setra calls it "observers" for clarity.
	 */
	observers?: string[];

	/**
	 * Hint for the CEO/lead agent when routing tasks.
	 * Example: "frontend changes, CSS, React components, accessibility"
	 */
	autoRoute?: string;

	/**
	 * How long messages in this channel persist in the DB (hours).
	 * After expiry, messages are archived (not deleted) and excluded from
	 * the active context window. Default: 48 hours.
	 *
	 * null means persist forever (useful for #general, #decisions).
	 */
	retentionHours?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.5  APPROVAL WORKFLOW
// Human-in-the-loop gate that setra has but setra makes first-class.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An approval request raised by an agent, queued for the human to review.
 *
 * setra calls this `humanInterview` with kind="approval". setra separates it
 * into its own type because approvals are the primary human interaction vector
 * and deserve dedicated UI treatment (the diff viewer panel).
 *
 * An approval in setra is always associated with a git diff — either a
 * specific worktree diff or a proposed file change.
 */
export interface ApprovalRequest {
	/** Globally unique ID (nanoid). */
	id: string;

	/** Company run this request belongs to. */
	companyRunId: string;

	/** Member slug that raised this request. */
	fromMember: string;

	/** Channel where this request was raised (for threading context). */
	channel: string;

	/** Short title shown in the approval queue notification. */
	title: string;

	/**
	 * What the agent wants to do.
	 * Markdown supported. Should include: what changed, why, risk assessment.
	 */
	description: string;

	/**
	 * Type of approval.
	 *
	 *   "merge"    — approve merging the member's worktree branch into the plot
	 *   "deploy"   — approve triggering a deploy pipeline
	 *   "action"   — approve a specific external action (API call, email, etc.)
	 *   "info"     — no code change; agent just needs a human decision
	 *   "budget"   — agent hit its cost cap and requests a budget increase
	 */
	kind: "merge" | "deploy" | "action" | "info" | "budget";

	/**
	 * When kind = "merge": the worktree path to diff against the plot's main branch.
	 * When kind = "deploy": the pipeline ID.
	 * When kind = "action": a JSON description of the action.
	 * Otherwise null.
	 */
	payload?: string | null;

	/**
	 * The git diff to show in the diff viewer (unified diff format).
	 * Only set when kind = "merge". Generated by: git diff main...{member-branch}
	 */
	diff?: string | null;

	/**
	 * Current status of this request.
	 *
	 *   "pending"   — waiting for human
	 *   "approved"  — human approved; setra will execute
	 *   "rejected"  — human rejected; agent is notified and should revise
	 *   "expired"   — not answered within stale_threshold (default 1 hour)
	 *   "cancelled" — agent cancelled its own request
	 */
	status: "pending" | "approved" | "rejected" | "expired" | "cancelled";

	/**
	 * Whether the requesting agent is blocked until this is resolved.
	 * When true, the agent's turn queue is paused.
	 * When false, the agent continues working on other tasks.
	 */
	blocking: boolean;

	/** Human's response text (optional explanation for rejection). */
	humanResponse?: string | null;

	createdAt: string; // ISO 8601
	updatedAt: string;
	answeredAt?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.6  MESSAGE
// The core communication primitive between agents.
// ─────────────────────────────────────────────────────────────────────────────

/** Token and cost usage attached to a message (from the agent turn that generated it). */
export interface MessageUsage {
	/** Tokens sent in the prompt (including cached). */
	inputTokens: number;
	/** Tokens generated. */
	outputTokens: number;
	/** Tokens served from Anthropic's cache (subset of inputTokens). */
	cacheReadTokens: number;
	/** Tokens written to Anthropic's cache this turn (one-time cost). */
	cacheCreationTokens: number;
	/** Total tokens (input + output). Redundant but convenient. */
	totalTokens: number;
	/** Calculated cost in USD based on the member's model pricing. */
	costUsd: number;
}

/**
 * A single message in the company message bus.
 *
 * setra's equivalent is `channelMessage`.
 * setra improvements:
 *   - `usage`: attached token/cost data (setra has this but setra persists it to SQLite)
 *   - `kind`: structured message types for UI rendering differentiation
 *   - `approvalRequestId`: links status messages to their approval request
 *   - `metadata`: extensible bag for provider-specific fields
 */
export interface CompanyMessage {
	/** Globally unique ID (nanoid). */
	id: string;

	/** Company run this message belongs to. */
	companyRunId: string;

	/** Channel slug where this message was posted. */
	channel: string;

	/**
	 * Who sent this message.
	 * Can be a member slug ("ceo", "fe") or "human" (the operator).
	 */
	from: string;

	/**
	 * Message type. Controls UI rendering and routing behavior.
	 *
	 *   "text"        — plain agent communication (most messages)
	 *   "status"      — lightweight activity update (not a thread item)
	 *   "task"        — task creation/update announcement
	 *   "approval"    — approval request notification
	 *   "decision"    — outcome of an approval (approved/rejected)
	 *   "human"       — human-to-agent direct message
	 *   "error"       — agent hit an error or was rate-limited
	 *   "cost-alert"  — member hit budget threshold
	 */
	kind:
		| "text"
		| "status"
		| "task"
		| "approval"
		| "decision"
		| "human"
		| "error"
		| "cost-alert";

	/** The message body. Markdown supported. */
	content: string;

	/**
	 * Member slugs explicitly @-mentioned and expected to respond.
	 * setra auto-detects untagged @mentions and appends them (same as setra).
	 */
	tagged: string[];

	/**
	 * ID of the message this is a reply to.
	 * Used for threading in the UI. Agents should set this when responding
	 * to a specific message, not just broadcasting to the channel.
	 */
	replyTo?: string | null;

	/**
	 * Linked approval request ID (when kind = "approval" or "decision").
	 */
	approvalRequestId?: string | null;

	/**
	 * Token usage and cost for the agent turn that generated this message.
	 * null for human messages and system-generated messages.
	 */
	usage?: MessageUsage | null;

	/** Emoji reactions from agents/human. */
	reactions: MessageReaction[];

	createdAt: string; // ISO 8601
}

export interface MessageReaction {
	emoji: string;
	from: string; // member slug or "human"
}

// ─────────────────────────────────────────────────────────────────────────────
// A.7  COMPANY TASK
// Shared work items tracked by the team. CEO assigns, members claim/complete.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskStatus =
	| "open" // created, not yet claimed
	| "claimed" // member is working on it
	| "blocked" // waiting on approval or dependency
	| "done" // completed
	| "cancelled"; // dropped

export interface CompanyTask {
	id: string;
	companyRunId: string;
	channel: string;
	title: string;
	details?: string | null;
	owner?: string | null; // member slug
	createdBy: string; // member slug
	status: TaskStatus;
	taskType?:
		| "feature"
		| "bugfix"
		| "research"
		| "review"
		| "deploy"
		| "test"
		| null;
	/** Branch name for this task's worktree (if worktreeIsolation = true for owner). */
	worktreeBranch?: string | null;
	worktreePath?: string | null;
	/** Task IDs that must be done before this one can start. */
	dependsOn: string[];
	threadId?: string | null; // message ID that spawned this task
	createdAt: string;
	updatedAt: string;
	completedAt?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.8  COMPANY DEFINITION (the top-level type)
// What gets saved to DB and exported as company.json
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The company definition. This is the setra equivalent of setra's `Manifest`.
 *
 * Key improvements over setra:
 *   - Persisted in DB with `id` + `createdAt` (setra: JSON file only)
 *   - `leadSlug`: explicit (setra: "lead" field, same idea but less typed)
 *   - `members[].model`: per-member model selection
 *   - `totalCostBudgetUsd`: company-wide spending cap per run
 *   - `templateSlug`: which built-in template this was derived from
 *   - `plotId`: when a company is "instantiated" to run in a specific plot
 */
export interface Company {
	/** Stored in DB. Not in company.json (assigned at import). */
	id: string;

	/** Display name. Shown in the UI and in the company.json. */
	name: string;

	/** One-paragraph description of what this company does. */
	description: string;

	/**
	 * Slug of the lead agent (the orchestrator/CEO).
	 * This agent is always spawned first and receives the initial task.
	 * It should be the most capable model in the team.
	 */
	leadSlug: string;

	/** All team members (including the lead). */
	members: CompanyMember[];

	/** Communication channels for this company. Always includes "general". */
	channels: CompanyChannel[];

	/**
	 * Optional lifetime spending cap for the entire company (USD).
	 * When reached, all agents are suspended and the human is notified.
	 * Individual member budgets (CompanyMember.costBudgetUsd) are enforced first.
	 */
	totalCostBudgetUsd?: number | null;

	/**
	 * Daily spending cap (USD) — resets at midnight UTC.
	 * Prevents runaway costs from agents running overnight or in long loops.
	 * Alert is sent at 80% of this limit. Hard stop at 100%.
	 * Example: 5.0 = agents cannot spend more than $5/day total.
	 */
	dailyBudgetUsd?: number | null;

	/**
	 * Alert threshold (0–1) for daily budget. Default: 0.8 (80%).
	 * When daily spend crosses this fraction, a warning is shown and optionally
	 * sent via the connected Slack/email integration.
	 */
	dailyBudgetAlertPct?: number;

	/**
	 * Maximum tokens per single agent turn.
	 * Prevents a single runaway turn from burning through the budget.
	 * Default: 200_000 (roughly $3 at Sonnet pricing).
	 */
	maxTokensPerTurn?: number | null;

	/**
	 * Which built-in template this was derived from, if any.
	 * Shown in the UI for provenance. null for custom companies.
	 */
	templateSlug?: string | null;

	/**
	 * Default broker port for this company (default: 7890).
	 * setra supports multiple simultaneous company runs on different ports,
	 * unlike setra which hard-codes 7890. Port conflict is auto-resolved
	 * by incrementing from this base.
	 */
	brokerPort?: number;

	/**
	 * Schema version for company.json migration.
	 * Currently "1". Increment when breaking changes are made to this type.
	 */
	version: "1";

	/** Stored in DB only. */
	createdAt?: string;
	updatedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.9  COMPANY RUN
// A single execution of a company. Multiple runs per company are normal.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A company run is a single execution session.
 *
 * Each run is linked to a setra `plot` (the git worktree context) and
 * persisted in the `company_runs` table. The `runs` table (single-agent)
 * and `company_runs` table (multi-agent) are separate but both feed the ledger.
 *
 * The broker is spawned once per run and torn down when the run ends.
 */
export interface CompanyRun {
	id: string;
	companyId: string;
	plotId: string; // the setra plot this run operates within

	/** The initial task/goal given to the lead agent. */
	initialTask: string;

	status:
		| "starting"
		| "running"
		| "paused"
		| "completed"
		| "failed"
		| "cancelled";

	/** Aggregated cost for the entire run across all members. */
	totalCostUsd: number;

	/** Per-member cost breakdown (member slug → cost). */
	costByMember: Record<string, number>;

	/** Per-member token usage. */
	usageByMember: Record<string, MessageUsage>;

	/** Broker port this run is using. */
	brokerPort: number;

	/** Auth token for broker (random hex, per-run). */
	brokerToken?: string; // only in memory, not persisted

	createdAt: string;
	updatedAt: string;
	completedAt?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.10  AGENT ACTIVITY SNAPSHOT
// Real-time status for each agent, shown in the UI member cards.
// ─────────────────────────────────────────────────────────────────────────────

export type AgentStatus =
	| "idle"
	| "thinking"
	| "active"
	| "waiting"
	| "error"
	| "suspended";

export interface AgentActivitySnapshot {
	/** Member slug. */
	slug: string;

	/** Coarse status for the card badge color. */
	status: AgentStatus;

	/** Short human-readable activity description. */
	activity: string;

	/** Detailed sub-activity (shown on hover). */
	detail?: string;

	/** ISO timestamp of last update. */
	lastTime: string;

	/** Milliseconds since first event in current turn. */
	totalMs: number;

	/** Milliseconds to first LLM event (time-to-first-token). */
	firstEventMs: number;

	/** Milliseconds to first text token. */
	firstTextMs: number;

	/** Milliseconds to first tool call. */
	firstToolMs: number;

	/** Cost accumulated this run (USD). */
	costUsd: number;

	/** Current task being worked on. */
	currentTaskId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A.11  SSE EVENT TYPES (broker → Electron UI)
// ─────────────────────────────────────────────────────────────────────────────

/** All event types the broker sends over SSE to the Electron UI. */
export type BrokerSSEEvent =
	| { type: "message"; data: CompanyMessage }
	| { type: "activity"; data: AgentActivitySnapshot }
	| { type: "task"; data: CompanyTask }
	| { type: "approval_request"; data: ApprovalRequest }
	| { type: "approval_answered"; data: ApprovalRequest }
	| { type: "agent_stream"; data: { slug: string; line: string } } // raw PTY output
	| {
			type: "cost_update";
			data: {
				runId: string;
				member: string;
				costUsd: number;
				totalCostUsd: number;
			};
	  }
	| {
			type: "run_status";
			data: { runId: string; status: CompanyRun["status"] };
	  }
	| { type: "member_joined"; data: { slug: string; name: string } }
	| { type: "member_left"; data: { slug: string; reason: string } }
	| { type: "heartbeat"; data: { ts: string } };

// ─────────────────────────────────────────────────────────────────────────────
// A.12  BROKER HTTP API REQUEST/RESPONSE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PostMessageRequest {
	channel: string;
	from: string;
	content: string;
	tagged?: string[];
	replyTo?: string;
	kind?: CompanyMessage["kind"];
	usage?: MessageUsage;
}

export interface PostMessageResponse {
	id: string;
	channel: string;
	from: string;
	timestamp: string;
}

export interface GetMessagesRequest {
	channel: string;
	/** Return only messages after this message ID (cursor-based pagination). */
	sinceId?: string;
	/** Maximum number of messages to return. Default: 10, max: 100. */
	limit?: number;
	/**
	 * Scope filter (from setra's team_poll `scope` param):
	 *   "all"    — all messages in channel
	 *   "agent"  — messages tagged to this agent or sent by them
	 *   "inbox"  — only unread messages addressed to this agent
	 *   "outbox" — only messages sent by this agent
	 */
	scope?: "all" | "agent" | "inbox" | "outbox";
	mySlug?: string;
}

export interface GetMessagesResponse {
	messages: CompanyMessage[];
	/** Messages tagged to `mySlug` that haven't been acknowledged. */
	taggedCount: number;
	/** Cursor for next page (last message ID). */
	nextCursor?: string;
}

export interface PostApprovalRequest {
	fromMember: string;
	channel: string;
	title: string;
	description: string;
	kind: ApprovalRequest["kind"];
	payload?: string;
	diff?: string;
	blocking?: boolean;
}

export interface AnswerApprovalRequest {
	status: "approved" | "rejected";
	humanResponse?: string;
}
