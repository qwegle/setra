/**
 * setra.sh — Company Formation: MCP Tools
 *
 * These are the tools agents use to communicate with each other and with
 * the human operator during a company run.
 *
 * setra has 30+ MCP tools registered in teammcp/server.go.
 * setra trims this to 14 essential tools and adds 2 setra-specific ones.
 *
 * TOOL DECISION MATRIX
 * ────────────────────────────────────────────────────────────────────────────
 * setra Tool               setra?   Reason
 * ──────────────────────── ──────── ──────────────────────────────────────────
 * team_broadcast           ✅ keep  Core: post to channel                  [D.1]
 * team_poll                ✅ keep  Core: read messages (cursor-based)      [D.2]
 * team_inbox               ✅ keep  Efficient: only tagged/unread messages  [D.3]
 * team_outbox              ✅ keep  Audit: review what you said             [D.4]
 * team_status              ✅ keep  Lightweight activity signal             [D.5]
 * team_request             ✅ keep  Human approval/input requests           [D.6]
 * team_requests            ✅ keep  Check pending requests before acting    [D.7]
 * team_task                ✅ keep  Create/claim/complete tasks             [D.8]
 * team_tasks               ✅ keep  Read task list                          [D.9]
 * team_members             ✅ keep  Know who is on the team                [D.10]
 * team_channels            ✅ keep  Channel roster for routing             [D.11]
 * human_message            ✅ keep  Direct human-facing report             [D.12]
 * team_react               ✅ keep  Emoji reactions (low-token ack)        [D.13]
 * team_runtime_state       ✅ keep  Resume context after restart           [D.14]
 * ─────── setra additions ─────────────────────────────────────────────────────
 * team_request_approval    ✅ NEW   Submit diff for human review           [D.15]
 *                                   (setra: buried in team_request kind)
 * team_cost                ✅ NEW   Check own spending vs budget           [D.16]
 *                                   (setra's cost-awareness differentiator)
 * ─────── setra tools setra SKIPS ─────────────────────────────────────────────
 * team_plan                ❌ skip  CEO-only batch task creation. Use
 *                                   team_task with dependsOn instead.
 *                                   Reduces schema complexity.
 * team_bridge              ❌ skip  Cross-channel context copy. Adds
 *                                   confusion for users. Team has channels
 *                                   for this naturally.
 * team_channel             ❌ skip  Dynamic channel creation by agents.
 *                                   Channels are defined in company.json.
 *                                   Agents shouldn't restructure their org.
 * team_channel_member      ❌ skip  Same reason as team_channel.
 * team_member              ❌ skip  Same reason — roster is fixed per run.
 * team_dm_open             ❌ skip  Human opens DMs via UI, not agent cmd.
 * team_office_members      ❌ skip  Duplicates team_members for our model.
 * team_skill_run           ❌ skip  setra-specific skillbook pattern.
 *                                   setra uses plot-level setup scripts.
 * team_skill_create        ❌ skip  Same.
 * team_skill_patch         ❌ skip  Same.
 * team_task_status         ❌ skip  Summary view; agents can use team_tasks.
 * team_wiki_*              ❌ skip  Phase 2 — setra uses memory_search MCP.
 * team_memory_*            ❌ skip  Phase 2 — setra uses memory_search MCP.
 * notebook_*               ❌ skip  Phase 2.
 * run_lint                 ❌ skip  Wiki-specific; Phase 2.
 * team_action_*            ❌ skip  Composio integration; Phase 2 optional.
 * human_interview          ❌ skip  Merged into team_request (simpler UX).
 *
 * Total: 16 tools (vs setra's 30+). Smaller schema = faster model routing.
 * Per setra's own comments: 30+ tools = 125k tokens schema overhead.
 * 16 tools ≈ 15k tokens — matches setra's DM-mode optimization.
 */

// ─────────────────────────────────────────────────────────────────────────────
// MCP TOOL DEFINITIONS (zod schemas for the setra-team MCP server)
// Each tool maps to a broker HTTP endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";

// ─── D.1 team_broadcast ─────────────────────────────────────────────────────

export const TeamBroadcastInput = z.object({
	content: z.string().describe("Message to post. Markdown supported."),
	channel: z
		.string()
		.optional()
		.describe("Channel slug. Defaults to 'general'."),
	my_slug: z
		.string()
		.optional()
		.describe("Your agent slug. Read from SETRA_AGENT_SLUG env by default."),
	tagged: z
		.array(z.string())
		.optional()
		.describe("Agent slugs to @mention. They will be woken up."),
	reply_to: z
		.string()
		.optional()
		.describe("Message ID to reply to (for threading)."),
	new_topic: z
		.boolean()
		.optional()
		.describe("Set true only to explicitly start a new top-level thread."),
});
export type TeamBroadcastInput = z.infer<typeof TeamBroadcastInput>;

/** POST /messages */
export const TEAM_BROADCAST_TOOL = {
	name: "team_broadcast",
	description:
		"Post a message to the team channel. Use `tagged` to wake up specific agents. Use `reply_to` to thread a response.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: TeamBroadcastInput,
};

// ─── D.2 team_poll ──────────────────────────────────────────────────────────

export const TeamPollInput = z.object({
	channel: z
		.string()
		.optional()
		.describe("Channel slug. Defaults to 'general'."),
	my_slug: z.string().optional(),
	since_id: z
		.string()
		.optional()
		.describe(
			"Only return messages after this message ID. Use the last id you received.",
		),
	limit: z.number().int().min(1).max(100).optional().default(10),
	scope: z
		.enum(["all", "agent", "inbox", "outbox"])
		.optional()
		.default("agent")
		.describe(
			"'all' for full transcript, 'inbox' for unread/tagged only (recommended), 'outbox' for your sent messages.",
		),
});
export type TeamPollInput = z.infer<typeof TeamPollInput>;

/** GET /messages */
export const TEAM_POLL_TOOL = {
	name: "team_poll",
	description:
		"Read recent channel messages. Only call this when your pushed context is missing information you genuinely need. Use scope='inbox' for efficiency — it returns only messages tagged to you.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamPollInput,
};

// ─── D.3 team_inbox ─────────────────────────────────────────────────────────

export const TeamInboxInput = z.object({
	my_slug: z.string().optional(),
	channel: z.string().optional(),
});
export type TeamInboxInput = z.infer<typeof TeamInboxInput>;

/** GET /messages?scope=inbox */
export const TEAM_INBOX_TOOL = {
	name: "team_inbox",
	description:
		"Read only the messages in your inbox: human asks, lead guidance, tags to you, and replies in your threads. Far more efficient than team_poll with scope=all.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamInboxInput,
};

// ─── D.4 team_outbox ────────────────────────────────────────────────────────

export const TeamOutboxInput = z.object({
	my_slug: z.string().optional(),
	channel: z.string().optional(),
	limit: z.number().int().min(1).max(50).optional().default(10),
});

export const TEAM_OUTBOX_TOOL = {
	name: "team_outbox",
	description:
		"Read the messages you authored. Use to review what you already told the team and avoid repeating yourself.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamOutboxInput,
};

// ─── D.5 team_status ────────────────────────────────────────────────────────

export const TeamStatusInput = z.object({
	status: z
		.string()
		.describe(
			"Short status like 'implementing search index' or 'reviewing PR diff'.",
		),
	channel: z.string().optional(),
	my_slug: z.string().optional(),
});
export type TeamStatusInput = z.infer<typeof TeamStatusInput>;

/** POST /activity */
export const TEAM_STATUS_TOOL = {
	name: "team_status",
	description:
		"Share a short status update. Rendered as lightweight activity in the UI member card. Does NOT wake up other agents. Use this instead of team_broadcast for progress updates.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: TeamStatusInput,
};

// ─── D.6 team_request ───────────────────────────────────────────────────────

export const TeamRequestInput = z.object({
	kind: z
		.enum(["choice", "confirm", "freeform", "approval", "secret"])
		.describe(
			"Type of request. 'approval' pauses your work until answered. 'choice' presents options. 'freeform' asks for typed input.",
		),
	question: z
		.string()
		.describe(
			"The specific question or approval the human needs to respond to.",
		),
	title: z
		.string()
		.optional()
		.describe("Short request title shown in the notification badge."),
	context: z
		.string()
		.optional()
		.describe("One sentence explaining why this decision is needed now."),
	channel: z.string().optional(),
	my_slug: z.string().optional(),
	options: z
		.array(
			z.object({
				id: z
					.string()
					.describe("Stable short ID like 'yes' or 'approve-staging'."),
				label: z.string().describe("User-facing option label."),
				description: z
					.string()
					.optional()
					.describe("One sentence explanation of this option's tradeoff."),
				requires_text: z.boolean().optional(),
				text_hint: z.string().optional(),
			}),
		)
		.optional(),
	recommended_option_id: z.string().optional(),
	blocking: z
		.boolean()
		.optional()
		.describe(
			"If true, your agent turn will pause until the human responds. Only set this when you truly cannot proceed.",
		),
	reply_to: z.string().optional(),
});
export type TeamRequestInput = z.infer<typeof TeamRequestInput>;

/** POST /approvals (for kind=approval) or POST /messages (for others) */
export const TEAM_REQUEST_TOOL = {
	name: "team_request",
	description:
		"Create a structured request for the human: confirmation, choice, approval, or free-form answer. For merge approvals (submitting code for review), use team_request_approval instead — it includes the diff viewer.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: TeamRequestInput,
};

// ─── D.7 team_requests ──────────────────────────────────────────────────────

export const TeamRequestsInput = z.object({
	channel: z.string().optional(),
	include_resolved: z.boolean().optional().default(false),
	my_slug: z.string().optional(),
});

export const TEAM_REQUESTS_TOOL = {
	name: "team_requests",
	description:
		"List the current pending requests so you know whether the human already owes the team a decision. Check this before creating a new request for the same question.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamRequestsInput,
};

// ─── D.8 team_task ──────────────────────────────────────────────────────────

export const TeamTaskInput = z.object({
	action: z
		.enum(["create", "claim", "assign", "complete", "block", "release"])
		.describe("What to do with the task."),
	id: z.string().optional().describe("Task ID for non-create actions."),
	title: z.string().optional().describe("Task title when action=create."),
	details: z.string().optional().describe("Detailed description or update."),
	owner: z
		.string()
		.optional()
		.describe("Agent slug to assign to (for assign action)."),
	channel: z.string().optional(),
	my_slug: z.string().optional(),
	task_type: z
		.enum(["feature", "bugfix", "research", "review", "deploy", "test"])
		.optional(),
	depends_on: z
		.array(z.string())
		.optional()
		.describe("Task IDs this task must wait for."),
	thread_id: z
		.string()
		.optional()
		.describe("Message ID that spawned this task, for context threading."),
});
export type TeamTaskInput = z.infer<typeof TeamTaskInput>;

/** POST /tasks */
export const TEAM_TASK_TOOL = {
	name: "team_task",
	description:
		"Create, claim, assign, complete, block, or release a shared task. Always claim a task before starting work so other agents don't duplicate effort. Complete it when done so the team knows.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: TeamTaskInput,
};

// ─── D.9 team_tasks ─────────────────────────────────────────────────────────

export const TeamTasksInput = z.object({
	channel: z.string().optional(),
	my_slug: z.string().optional(),
	include_done: z.boolean().optional().default(false),
});

export const TEAM_TASKS_TOOL = {
	name: "team_tasks",
	description:
		"List the current shared tasks and who owns them. Check this at the start of your turn to see what's already claimed so you don't duplicate work.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamTasksInput,
};

// ─── D.10 team_members ──────────────────────────────────────────────────────

export const TeamMembersInput = z.object({
	channel: z.string().optional(),
	my_slug: z.string().optional(),
});

export const TEAM_MEMBERS_TOOL = {
	name: "team_members",
	description:
		"List active team members with their current status and latest activity. Use this to know who is available before tagging them in a message.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamMembersInput,
};

// ─── D.11 team_channels ─────────────────────────────────────────────────────

export const TeamChannelsInput = z.object({});

export const TEAM_CHANNELS_TOOL = {
	name: "team_channels",
	description:
		"List available channels, their descriptions, and their memberships. Use this to choose the right channel for your message.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamChannelsInput,
};

// ─── D.12 human_message ─────────────────────────────────────────────────────

export const HumanMessageInput = z.object({
	content: z
		.string()
		.describe(
			"What to tell the human: completion update, recommendation, decision framing, or next action. Markdown supported.",
		),
	title: z
		.string()
		.optional()
		.describe("Short headline like 'Frontend complete — ready for review'."),
	kind: z
		.enum(["report", "decision", "action"])
		.optional()
		.default("report")
		.describe(
			"'report' = informational. 'decision' = needs human to choose. 'action' = human should do something.",
		),
	channel: z.string().optional(),
	my_slug: z.string().optional(),
	reply_to: z.string().optional(),
});
export type HumanMessageInput = z.infer<typeof HumanMessageInput>;

/** POST /messages with kind="human" */
export const HUMAN_MESSAGE_TOOL = {
	name: "human_message",
	description:
		"Send a direct human-facing note when you need to report completion, recommend a decision, or tell the human what to do next. This surfaces in the human's notification feed with higher visibility than a channel broadcast.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: HumanMessageInput,
};

// ─── D.13 team_react ────────────────────────────────────────────────────────

export const TeamReactInput = z.object({
	message_id: z.string().describe("ID of the message to react to."),
	emoji: z
		.string()
		.describe(
			"Emoji reaction (e.g. ✅ for done, 👀 for reviewing, 🔄 for in-progress).",
		),
	my_slug: z.string().optional(),
});

export const TEAM_REACT_TOOL = {
	name: "team_react",
	description:
		"React to a message with an emoji. Use this as a low-token acknowledgment instead of a full broadcast reply. ✅ = done, 👀 = reviewing, 🔄 = in-progress, ❓ = needs clarification.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: TeamReactInput,
};

// ─── D.14 team_runtime_state ────────────────────────────────────────────────

export const TeamRuntimeStateInput = z.object({
	channel: z.string().optional(),
	my_slug: z.string().optional(),
	message_limit: z
		.number()
		.int()
		.min(1)
		.max(40)
		.optional()
		.default(12)
		.describe("How many recent messages to include in the recovery summary."),
});

export const TEAM_RUNTIME_STATE_TOOL = {
	name: "team_runtime_state",
	description:
		"Return the canonical runtime snapshot: tasks, pending human requests, recent messages, and recovery summary. Call this at the start of your turn if your pushed context is incomplete or if the session was just resumed.",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamRuntimeStateInput,
};

// ─── D.15 team_request_approval (setra-specific) ────────────────────────────
//
// setra: merge approvals are buried in team_request with kind="approval".
//        The approval has no diff — the human has to go find the branch.
//
// setra: first-class approval with:
//   - Automatic git diff generation (agent provides branch name)
//   - Diff displayed in the Electron diff viewer panel
//   - Clear approve/reject/revise buttons in the UI
//   - Commit as mark after approval (immutable checkpoint)

export const TeamRequestApprovalInput = z.object({
	title: z
		.string()
		.describe("Short title: what are you requesting to merge/deploy?"),
	description: z
		.string()
		.describe("What changed, why, and any risk notes. Markdown supported."),
	kind: z
		.enum(["merge", "deploy", "action", "info", "budget"])
		.describe(
			"'merge' = code review with diff viewer. 'deploy' = trigger pipeline. 'action' = external side effect. 'info' = just needs human decision.",
		),
	channel: z.string().optional(),
	my_slug: z.string().optional(),
	blocking: z
		.boolean()
		.optional()
		.default(true)
		.describe(
			"If true (default), your agent pauses until the human responds. Set false only if you have independent work to continue.",
		),
	/**
	 * Only for kind="merge". Provide the branch name; setra will generate
	 * the diff automatically from: git diff main...{branch_name}
	 * The human sees this diff in the diff viewer before approving.
	 */
	branch_name: z
		.string()
		.optional()
		.describe(
			"Your worktree branch name (for kind='merge'). setra generates the diff automatically.",
		),
	/**
	 * For kind="deploy": the pipeline ID to trigger on approval.
	 * For kind="action": a JSON description of the external action.
	 */
	payload: z
		.string()
		.optional()
		.describe(
			"Pipeline ID (deploy), action description (action), or budget increase amount (budget).",
		),
});
export type TeamRequestApprovalInput = z.infer<typeof TeamRequestApprovalInput>;

/** POST /approvals */
export const TEAM_REQUEST_APPROVAL_TOOL = {
	name: "team_request_approval",
	description:
		"Submit work for human review before it's merged or deployed. For code changes: provide your branch_name and setra will show the diff in the diff viewer. The human can approve, reject, or request revisions. This is the ONLY way to merge code into the main branch — agents cannot self-merge.",
	annotations: { destructiveHint: false, openWorldHint: false },
	inputSchema: TeamRequestApprovalInput,
};

// ─── D.16 team_cost (setra-specific) ────────────────────────────────────────
//
// setra: no cost visibility for agents. They don't know how much they've spent.
//
// setra: agents can check their own cost vs budget.
//   - Prevents agents from unknowingly exceeding budgets
//   - Allows agents to self-throttle (switch to lighter models, reduce scope)
//   - Shows in the UI member card

export const TeamCostInput = z.object({
	my_slug: z.string().optional(),
});
export type TeamCostInput = z.infer<typeof TeamCostInput>;

/** GET /activity (reads from agent_activity table) */
export const TEAM_COST_TOOL = {
	name: "team_cost",
	description:
		"Check your current spending vs budget for this run. Returns: cost_usd (your total so far), budget_usd (your limit if set), remaining_usd, team_total_usd, and whether you're approaching the limit. Check this if you're about to do something expensive (long file reads, many tool calls in a loop).",
	annotations: { readOnlyHint: true, openWorldHint: false },
	inputSchema: TeamCostInput,
};

// ─────────────────────────────────────────────────────────────────────────────
// TOOL REGISTRY
// Role-based tool registration for the setra-team MCP server.
// Following setra's pattern: give each role only the tools it needs.
// ─────────────────────────────────────────────────────────────────────────────

/** All 16 tools every agent in a company run gets. */
export const ALL_COMPANY_TOOLS = [
	TEAM_BROADCAST_TOOL,
	TEAM_POLL_TOOL,
	TEAM_INBOX_TOOL,
	TEAM_OUTBOX_TOOL,
	TEAM_STATUS_TOOL,
	TEAM_REQUEST_TOOL,
	TEAM_REQUESTS_TOOL,
	TEAM_TASK_TOOL,
	TEAM_TASKS_TOOL,
	TEAM_MEMBERS_TOOL,
	TEAM_CHANNELS_TOOL,
	HUMAN_MESSAGE_TOOL,
	TEAM_REACT_TOOL,
	TEAM_RUNTIME_STATE_TOOL,
	TEAM_REQUEST_APPROVAL_TOOL,
	TEAM_COST_TOOL,
] as const;

/**
 * Minimal tool set for non-coding agents (PM, planner, reviewer roles).
 * Excludes tools that require code/git knowledge.
 * Schema size: ~6k tokens vs 16k for the full set.
 */
export const MINIMAL_COMPANY_TOOLS = [
	TEAM_BROADCAST_TOOL,
	TEAM_INBOX_TOOL,
	TEAM_STATUS_TOOL,
	TEAM_REQUEST_TOOL,
	TEAM_TASK_TOOL,
	TEAM_TASKS_TOOL,
	TEAM_MEMBERS_TOOL,
	HUMAN_MESSAGE_TOOL,
	TEAM_REACT_TOOL,
	TEAM_COST_TOOL,
] as const;

/**
 * Lead/CEO-only additions on top of ALL_COMPANY_TOOLS.
 * The lead gets runtime state access for orchestration decisions.
 */
export const LEAD_ONLY_TOOLS = [TEAM_RUNTIME_STATE_TOOL] as const;

/**
 * Select the appropriate tool set for a member based on their role.
 *
 * Rule:
 *   - Members with worktreeIsolation=true (coding agents) get ALL_COMPANY_TOOLS
 *   - Members with worktreeIsolation=false (planners) get MINIMAL_COMPANY_TOOLS
 *   - The lead always gets ALL_COMPANY_TOOLS + LEAD_ONLY_TOOLS
 *   - If the member has a custom allowList in their toolScope, that takes precedence
 */
export function selectToolsForMember(params: {
	isLead: boolean;
	worktreeIsolation: boolean;
	customAllowList?: string[];
}): readonly (typeof ALL_COMPANY_TOOLS)[number][] {
	const { isLead, worktreeIsolation, customAllowList } = params;

	// Custom allow lists take precedence over role-based defaults. This is the
	// hook that lets blueprints (or per-run overrides) shrink the tool surface
	// for a single agent — mirrors WUPHF's per-agent MCP scoping which keeps
	// the prompt tool schema small enough to stay cache-aligned and prevents
	// privilege escalation by role boundary. Unknown tool names are filtered
	// out so a typo cannot smuggle in undeclared tools.
	if (customAllowList && customAllowList.length > 0) {
		const allow = new Set(customAllowList);
		const filtered = ALL_COMPANY_TOOLS.filter((t) => allow.has(t.name));
		if (filtered.length > 0) return filtered;
		// Empty intersection: fall through to role-based default rather than
		// hand the agent a zero-tool MCP surface (which would lock it up).
	}

	if (isLead) {
		// Lead gets all tools. LEAD_ONLY_TOOLS already included in ALL_COMPANY_TOOLS
		// because team_runtime_state is in the full set.
		return ALL_COMPANY_TOOLS;
	}

	if (worktreeIsolation) {
		return ALL_COMPANY_TOOLS;
	}

	return MINIMAL_COMPANY_TOOLS;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENV VARS INJECTED INTO EACH AGENT PROCESS
// Every agent subprocess gets these. Mirrors setra's env injection pattern
// from headless_claude.go buildHeadlessClaudeEnv.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentEnv {
	/** Broker URL. Always http://127.0.0.1:{port}. */
	SETRA_BROKER_URL: string;
	/** Shared secret for broker auth. */
	SETRA_BROKER_TOKEN: string;
	/** This agent's slug. Used as default my_slug for all MCP tools. */
	SETRA_AGENT_SLUG: string;
	/** The company run ID. Used for DB scoping. */
	SETRA_COMPANY_RUN_ID: string;
	/** The plot ID this run operates within. */
	SETRA_PLOT_ID: string;
	/** The company name (for context). */
	SETRA_COMPANY_NAME: string;
	/** The lead agent's slug (so workers know who the orchestrator is). */
	SETRA_LEAD_SLUG: string;
	/** Default channel for this agent. */
	SETRA_DEFAULT_CHANNEL: string;
	/**
	 * Enable Anthropic prompt caching.
	 * Set on every agent process — this is the 9x token savings trick from setra.
	 * DO NOT remove this. It is not a flag; it's an env var.
	 */
	ANTHROPIC_PROMPT_CACHING: "1";
	/**
	 * Model override for this agent (maps to --model flag in claude CLI).
	 * Set from CompanyMember.model.
	 */
	SETRA_AGENT_MODEL: string;
}

export function buildAgentEnv(params: {
	brokerPort: number;
	brokerToken: string;
	agentSlug: string;
	companyRunId: string;
	plotId: string;
	companyName: string;
	leadSlug: string;
	defaultChannel: string;
	model: string;
}): AgentEnv {
	return {
		SETRA_BROKER_URL: `http://127.0.0.1:${params.brokerPort}`,
		SETRA_BROKER_TOKEN: params.brokerToken,
		SETRA_AGENT_SLUG: params.agentSlug,
		SETRA_COMPANY_RUN_ID: params.companyRunId,
		SETRA_PLOT_ID: params.plotId,
		SETRA_COMPANY_NAME: params.companyName,
		SETRA_LEAD_SLUG: params.leadSlug,
		SETRA_DEFAULT_CHANNEL: params.defaultChannel,
		ANTHROPIC_PROMPT_CACHING: "1",
		SETRA_AGENT_MODEL: params.model,
	};
}
