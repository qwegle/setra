/**
 * setra.sh — Company Formation: SQLite Schema Extension
 *
 * This file defines the Drizzle ORM schema for all Company Formation tables.
 * It extends the existing setra core schema (runs, plots, ledger_entries).
 *
 * Drizzle + better-sqlite3 is setra's local DB stack (same as Superset).
 * All tables use snake_case column names (SQLite convention).
 *
 * New tables in this extension:
 *   companies         — the company definition (persisted manifest)
 *   company_members   — individual agent configs within a company
 *   company_channels  — channel definitions
 *   company_runs      — execution sessions for a company
 *   team_messages     — all messages posted during company runs
 *   team_tasks        — shared tasks tracked by the team
 *   approval_requests — human-in-the-loop approval queue
 *   agent_activity    — live agent status snapshots (ring buffer, last 1000)
 *
 * Relationship to existing tables:
 *   company_runs.plot_id   → plots.id
 *   company_runs.run_ids   → runs.id (one company run → many agent runs)
 *   team_messages entries feed the ledger via cost accumulation on company_runs
 */

import { sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
// COMPANIES
// The company manifest — persisted from company.json import or UI creation.
// ─────────────────────────────────────────────────────────────────────────────

export const companies = sqliteTable("companies", {
	id: text("id").primaryKey(), // nanoid
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	leadSlug: text("lead_slug").notNull(),

	/**
	 * Full company.json serialized as JSON text.
	 * This is the source of truth for members[], channels[], etc.
	 * Individual member/channel tables are denormalized views for query speed.
	 * On any update, both this column AND the denormalized tables are updated.
	 */
	manifestJson: text("manifest_json").notNull(),

	version: text("version").notNull().default("1"),
	templateSlug: text("template_slug"), // built-in template used
	brokerPortBase: integer("broker_port_base").default(7890),
	totalCostBudgetUsd: real("total_cost_budget_usd"),

	createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY_MEMBERS (denormalized from manifest_json for fast queries)
// ─────────────────────────────────────────────────────────────────────────────

export const companyMembers = sqliteTable(
	"company_members",
	{
		id: text("id").primaryKey(), // nanoid
		companyId: text("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		role: text("role").notNull().default(""),
		model: text("model").notNull(), // ModelId
		systemPrompt: text("system_prompt").notNull().default(""),
		expertiseJson: text("expertise_json").notNull().default("[]"), // JSON string[]
		permissionMode: text("permission_mode").notNull().default("auto"),
		toolScopeJson: text("tool_scope_json"), // JSON ToolScope | null
		maxTurns: integer("max_turns").notNull().default(15),
		worktreeIsolation: integer("worktree_isolation", { mode: "boolean" })
			.notNull()
			.default(false),
		costBudgetUsd: real("cost_budget_usd"),
		isSystem: integer("is_system", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(t) => ({
		companySlugIdx: uniqueIndex("company_members_company_id_slug").on(
			t.companyId,
			t.slug,
		),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY_CHANNELS (denormalized from manifest_json for fast queries)
// ─────────────────────────────────────────────────────────────────────────────

export const companyChannels = sqliteTable(
	"company_channels",
	{
		id: text("id").primaryKey(),
		companyId: text("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		type: text("type").notNull().default("broadcast"), // ChannelType
		membersJson: text("members_json").notNull().default("[]"), // JSON string[]
		observersJson: text("observers_json").notNull().default("[]"),
		autoRoute: text("auto_route"),
		retentionHours: integer("retention_hours"),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(t) => ({
		companyChannelIdx: uniqueIndex("company_channels_company_id_slug").on(
			t.companyId,
			t.slug,
		),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY_RUNS
// A single execution session. One company may have many runs over its lifetime.
// ─────────────────────────────────────────────────────────────────────────────

export const companyRuns = sqliteTable(
	"company_runs",
	{
		id: text("id").primaryKey(),
		companyId: text("company_id")
			.notNull()
			.references(() => companies.id),
		plotId: text("plot_id").notNull(), // → plots.id in core schema

		initialTask: text("initial_task").notNull(),
		status: text("status").notNull().default("starting"),
		// "starting" | "running" | "paused" | "completed" | "failed" | "cancelled"

		brokerPort: integer("broker_port").notNull().default(7890),

		/**
		 * Aggregated cost for the whole run. Updated in real-time as messages
		 * arrive with usage data. Used for ledger display.
		 */
		totalCostUsd: real("total_cost_usd").notNull().default(0),

		/**
		 * Per-member cost and usage stored as JSON.
		 * Updated after every agent turn via OTLP or direct cost accumulation.
		 *
		 * Schema: { [memberSlug]: { costUsd, inputTokens, outputTokens,
		 *                           cacheReadTokens, cacheCreationTokens,
		 *                           totalTokens, turnCount } }
		 */
		costByMemberJson: text("cost_by_member_json").notNull().default("{}"),
		usageByMemberJson: text("usage_by_member_json").notNull().default("{}"),

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
		completedAt: text("completed_at"),
	},
	(t) => ({
		companyRunsCompanyIdx: index("company_runs_company_id").on(t.companyId),
		companyRunsPlotIdx: index("company_runs_plot_id").on(t.plotId),
		companyRunsStatusIdx: index("company_runs_status").on(t.status),
	}),
);

/**
 * Junction table: company run → individual agent runs.
 * Each member's turns create individual entries in the core `runs` table.
 * This table maps them back to their parent company run.
 */
export const companyRunMembers = sqliteTable(
	"company_run_members",
	{
		id: text("id").primaryKey(),
		companyRunId: text("company_run_id")
			.notNull()
			.references(() => companyRuns.id, { onDelete: "cascade" }),
		memberSlug: text("member_slug").notNull(),
		runId: text("run_id"), // → runs.id in core schema (null until first turn)
		worktreePath: text("worktree_path"),
		worktreeBranch: text("worktree_branch"),
		status: text("status").notNull().default("idle"),
		// "idle" | "active" | "paused" | "done" | "suspended"
		turnCount: integer("turn_count").notNull().default(0),
		costUsd: real("cost_usd").notNull().default(0),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
	},
	(t) => ({
		companyRunMembersRunIdx: index("crm_company_run_id").on(t.companyRunId),
		companyRunMembersMemberIdx: index("crm_member_slug").on(t.memberSlug),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// TEAM_MESSAGES
// Every message posted during a company run. Persisted to SQLite.
// setra stores these in a JSON file. setra stores them in SQLite.
//
// This is the most important new table in the Company Formation extension.
// It enables:
//   - Full replay of any company run
//   - Cross-run analytics (which channels are most active?)
//   - Cost attribution (which messages cost the most?)
//   - Resume on broker restart (read from DB, not from in-memory JSON)
// ─────────────────────────────────────────────────────────────────────────────

export const teamMessages = sqliteTable(
	"team_messages",
	{
		id: text("id").primaryKey(), // nanoid, set by broker
		companyRunId: text("company_run_id")
			.notNull()
			.references(() => companyRuns.id),

		channel: text("channel").notNull(),
		fromMember: text("from_member").notNull(), // member slug or "human"
		kind: text("kind").notNull().default("text"),
		// "text" | "status" | "task" | "approval" | "decision" | "human" | "error" | "cost-alert"

		content: text("content").notNull(),
		taggedJson: text("tagged_json").notNull().default("[]"), // JSON string[]
		replyTo: text("reply_to"), // → team_messages.id
		approvalRequestId: text("approval_request_id"), // → approval_requests.id

		/**
		 * Token usage for the agent turn that produced this message.
		 * Stored flat (not as a nested JSON) for fast aggregation queries.
		 * NULL for human messages and system-generated messages.
		 */
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cacheReadTokens: integer("cache_read_tokens"),
		cacheCreationTokens: integer("cache_creation_tokens"),
		totalTokens: integer("total_tokens"),
		costUsd: real("cost_usd"),

		reactionsJson: text("reactions_json").notNull().default("[]"), // JSON MessageReaction[]

		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(t) => ({
		teamMsgRunIdx: index("team_messages_run_id").on(t.companyRunId),
		teamMsgChannelIdx: index("team_messages_channel").on(t.channel),
		teamMsgFromIdx: index("team_messages_from").on(t.fromMember),
		teamMsgReplyIdx: index("team_messages_reply_to").on(t.replyTo),
		teamMsgCreatedIdx: index("team_messages_created_at").on(t.createdAt),
		// Composite: efficient "give me messages in channel X since cursor Y"
		teamMsgCursorIdx: index("team_messages_channel_cursor").on(
			t.companyRunId,
			t.channel,
			t.createdAt,
		),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// TEAM_TASKS
// Shared task list tracked by the company broker.
// ─────────────────────────────────────────────────────────────────────────────

export const teamTasks = sqliteTable(
	"team_tasks",
	{
		id: text("id").primaryKey(),
		companyRunId: text("company_run_id")
			.notNull()
			.references(() => companyRuns.id),
		channel: text("channel").notNull(),
		title: text("title").notNull(),
		details: text("details"),
		owner: text("owner"), // member slug
		createdBy: text("created_by").notNull(), // member slug
		status: text("status").notNull().default("open"),
		taskType: text("task_type"),
		worktreeBranch: text("worktree_branch"),
		worktreePath: text("worktree_path"),
		dependsOnJson: text("depends_on_json").notNull().default("[]"), // JSON string[]
		threadId: text("thread_id"), // → team_messages.id
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
		completedAt: text("completed_at"),
	},
	(t) => ({
		teamTasksRunIdx: index("team_tasks_run_id").on(t.companyRunId),
		teamTasksOwnerIdx: index("team_tasks_owner").on(t.owner),
		teamTasksStatusIdx: index("team_tasks_status").on(t.status),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL_REQUESTS
// Human-in-the-loop approval queue. First-class in setra (setra buries this
// inside humanInterview records in the JSON broker state).
// ─────────────────────────────────────────────────────────────────────────────

export const approvalRequests = sqliteTable(
	"approval_requests",
	{
		id: text("id").primaryKey(),
		companyRunId: text("company_run_id")
			.notNull()
			.references(() => companyRuns.id),
		fromMember: text("from_member").notNull(),
		channel: text("channel").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull(),
		kind: text("kind").notNull(), // "merge" | "deploy" | "action" | "info" | "budget"
		payload: text("payload"), // JSON or text depending on kind
		diff: text("diff"), // unified diff for kind="merge"
		status: text("status").notNull().default("pending"),
		blocking: integer("blocking", { mode: "boolean" }).notNull().default(false),
		humanResponse: text("human_response"),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
		updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
		answeredAt: text("answered_at"),
	},
	(t) => ({
		approvalRunIdx: index("approval_requests_run_id").on(t.companyRunId),
		approvalStatusIdx: index("approval_requests_status").on(t.status),
		approvalMemberIdx: index("approval_requests_from_member").on(t.fromMember),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// AGENT_ACTIVITY
// Ring buffer of agent activity snapshots. Last 1000 entries per run.
// Used to power the activity graph in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export const agentActivity = sqliteTable(
	"agent_activity",
	{
		id: text("id").primaryKey(),
		companyRunId: text("company_run_id")
			.notNull()
			.references(() => companyRuns.id),
		memberSlug: text("member_slug").notNull(),
		status: text("status").notNull(), // AgentStatus
		activity: text("activity").notNull(),
		detail: text("detail"),
		costUsd: real("cost_usd").notNull().default(0),
		totalMs: integer("total_ms").notNull().default(0),
		firstEventMs: integer("first_event_ms").notNull().default(0),
		firstTextMs: integer("first_text_ms").notNull().default(0),
		firstToolMs: integer("first_tool_ms").notNull().default(0),
		createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
	},
	(t) => ({
		agentActivityRunIdx: index("agent_activity_run_id").on(t.companyRunId),
		agentActivityMemberIdx: index("agent_activity_member").on(t.memberSlug),
		agentActivityTimeIdx: index("agent_activity_created_at").on(t.createdAt),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER EXTENSION VIEW
// A SQL view that joins company_runs into the ledger.
// The core ledger_entries table records individual runs.
// This view adds company-level aggregation for the cost dashboard.
//
// Usage: SELECT * FROM company_ledger_summary WHERE company_id = ?
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw SQL for the company_ledger_summary view.
 * Create via: db.run(COMPANY_LEDGER_SUMMARY_VIEW_SQL)
 */
export const COMPANY_LEDGER_SUMMARY_VIEW_SQL = `
  CREATE VIEW IF NOT EXISTS company_ledger_summary AS
  SELECT
    cr.company_id,
    c.name                              AS company_name,
    COUNT(DISTINCT cr.id)               AS run_count,
    SUM(cr.total_cost_usd)              AS total_cost_usd,
    MIN(cr.created_at)                  AS first_run_at,
    MAX(cr.created_at)                  AS last_run_at,
    COUNT(DISTINCT cr.plot_id)          AS plots_used,
    -- per-run average
    AVG(cr.total_cost_usd)              AS avg_cost_per_run_usd,
    -- message count for activity level signal
    COUNT(tm.id)                        AS total_messages,
    -- approval stats
    COUNT(DISTINCT ar.id)               AS total_approvals,
    SUM(CASE WHEN ar.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
    SUM(CASE WHEN ar.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
  FROM companies c
  LEFT JOIN company_runs cr ON cr.company_id = c.id
  LEFT JOIN team_messages tm ON tm.company_run_id = cr.id
  LEFT JOIN approval_requests ar ON ar.company_run_id = cr.id
  GROUP BY cr.company_id, c.name;
`;

/**
 * SQL for the per-member cost aggregation view.
 * Usage: SELECT * FROM member_cost_summary WHERE company_run_id = ?
 */
export const MEMBER_COST_SUMMARY_VIEW_SQL = `
  CREATE VIEW IF NOT EXISTS member_cost_summary AS
  SELECT
    tm.company_run_id,
    tm.from_member                          AS member_slug,
    COUNT(*)                                AS message_count,
    COALESCE(SUM(tm.input_tokens), 0)       AS total_input_tokens,
    COALESCE(SUM(tm.output_tokens), 0)      AS total_output_tokens,
    COALESCE(SUM(tm.cache_read_tokens), 0)  AS total_cache_read_tokens,
    COALESCE(SUM(tm.cache_creation_tokens), 0) AS total_cache_creation_tokens,
    COALESCE(SUM(tm.total_tokens), 0)       AS total_tokens,
    COALESCE(SUM(tm.cost_usd), 0.0)         AS total_cost_usd
  FROM team_messages tm
  WHERE tm.from_member != 'human'
    AND tm.cost_usd IS NOT NULL
  GROUP BY tm.company_run_id, tm.from_member;
`;

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION HELPER
// Call this after running the core schema migrations.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw SQL statements to run as migration 043 (migration 043).
 * Ordered to respect foreign key dependencies.
 */
export const COMPANY_FORMATION_MIGRATION_SQL = [
	// Enable WAL mode and foreign keys if not already done in core migration
	`PRAGMA journal_mode = WAL;`,
	`PRAGMA foreign_keys = ON;`,

	// Tables (in dependency order)
	`CREATE TABLE IF NOT EXISTS companies (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    description          TEXT NOT NULL DEFAULT '',
    lead_slug            TEXT NOT NULL,
    manifest_json        TEXT NOT NULL,
    version              TEXT NOT NULL DEFAULT '1',
    template_slug        TEXT,
    broker_port_base     INTEGER DEFAULT 7890,
    total_cost_budget_usd REAL,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

	`CREATE TABLE IF NOT EXISTS company_members (
    id                  TEXT PRIMARY KEY,
    company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    slug                TEXT NOT NULL,
    name                TEXT NOT NULL,
    role                TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL,
    system_prompt       TEXT NOT NULL DEFAULT '',
    expertise_json      TEXT NOT NULL DEFAULT '[]',
    permission_mode     TEXT NOT NULL DEFAULT 'auto',
    tool_scope_json     TEXT,
    max_turns           INTEGER NOT NULL DEFAULT 15,
    worktree_isolation  INTEGER NOT NULL DEFAULT 0,
    cost_budget_usd     REAL,
    is_system           INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, slug)
  );`,

	`CREATE TABLE IF NOT EXISTS company_channels (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    type            TEXT NOT NULL DEFAULT 'broadcast',
    members_json    TEXT NOT NULL DEFAULT '[]',
    observers_json  TEXT NOT NULL DEFAULT '[]',
    auto_route      TEXT,
    retention_hours INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, slug)
  );`,

	`CREATE TABLE IF NOT EXISTS company_runs (
    id                    TEXT PRIMARY KEY,
    company_id            TEXT NOT NULL REFERENCES companies(id),
    plot_id               TEXT NOT NULL,
    initial_task          TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'starting',
    broker_port           INTEGER NOT NULL DEFAULT 7890,
    total_cost_usd        REAL NOT NULL DEFAULT 0,
    cost_by_member_json   TEXT NOT NULL DEFAULT '{}',
    usage_by_member_json  TEXT NOT NULL DEFAULT '{}',
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at          TEXT
  );`,

	`CREATE INDEX IF NOT EXISTS company_runs_company_id ON company_runs(company_id);`,
	`CREATE INDEX IF NOT EXISTS company_runs_plot_id    ON company_runs(plot_id);`,
	`CREATE INDEX IF NOT EXISTS company_runs_status     ON company_runs(status);`,

	`CREATE TABLE IF NOT EXISTS company_run_members (
    id               TEXT PRIMARY KEY,
    company_run_id   TEXT NOT NULL REFERENCES company_runs(id) ON DELETE CASCADE,
    member_slug      TEXT NOT NULL,
    run_id           TEXT,
    worktree_path    TEXT,
    worktree_branch  TEXT,
    status           TEXT NOT NULL DEFAULT 'idle',
    turn_count       INTEGER NOT NULL DEFAULT 0,
    cost_usd         REAL NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

	`CREATE INDEX IF NOT EXISTS crm_company_run_id ON company_run_members(company_run_id);`,
	`CREATE INDEX IF NOT EXISTS crm_member_slug    ON company_run_members(member_slug);`,

	`CREATE TABLE IF NOT EXISTS team_messages (
    id                    TEXT PRIMARY KEY,
    company_run_id        TEXT NOT NULL REFERENCES company_runs(id),
    channel               TEXT NOT NULL,
    from_member           TEXT NOT NULL,
    kind                  TEXT NOT NULL DEFAULT 'text',
    content               TEXT NOT NULL,
    tagged_json           TEXT NOT NULL DEFAULT '[]',
    reply_to              TEXT,
    approval_request_id   TEXT,
    input_tokens          INTEGER,
    output_tokens         INTEGER,
    cache_read_tokens     INTEGER,
    cache_creation_tokens INTEGER,
    total_tokens          INTEGER,
    cost_usd              REAL,
    reactions_json        TEXT NOT NULL DEFAULT '[]',
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

	`CREATE INDEX IF NOT EXISTS team_messages_run_id         ON team_messages(company_run_id);`,
	`CREATE INDEX IF NOT EXISTS team_messages_channel        ON team_messages(channel);`,
	`CREATE INDEX IF NOT EXISTS team_messages_from           ON team_messages(from_member);`,
	`CREATE INDEX IF NOT EXISTS team_messages_reply_to       ON team_messages(reply_to);`,
	`CREATE INDEX IF NOT EXISTS team_messages_created_at     ON team_messages(created_at);`,
	`CREATE INDEX IF NOT EXISTS team_messages_channel_cursor ON team_messages(company_run_id, channel, created_at);`,

	`CREATE TABLE IF NOT EXISTS team_tasks (
    id               TEXT PRIMARY KEY,
    company_run_id   TEXT NOT NULL REFERENCES company_runs(id),
    channel          TEXT NOT NULL,
    title            TEXT NOT NULL,
    details          TEXT,
    owner            TEXT,
    created_by       TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'open',
    task_type        TEXT,
    worktree_branch  TEXT,
    worktree_path    TEXT,
    depends_on_json  TEXT NOT NULL DEFAULT '[]',
    thread_id        TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT
  );`,

	`CREATE INDEX IF NOT EXISTS team_tasks_run_id    ON team_tasks(company_run_id);`,
	`CREATE INDEX IF NOT EXISTS team_tasks_owner     ON team_tasks(owner);`,
	`CREATE INDEX IF NOT EXISTS team_tasks_status    ON team_tasks(status);`,

	`CREATE TABLE IF NOT EXISTS approval_requests (
    id               TEXT PRIMARY KEY,
    company_run_id   TEXT NOT NULL REFERENCES company_runs(id),
    from_member      TEXT NOT NULL,
    channel          TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL,
    kind             TEXT NOT NULL,
    payload          TEXT,
    diff             TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    blocking         INTEGER NOT NULL DEFAULT 0,
    human_response   TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at      TEXT
  );`,

	`CREATE INDEX IF NOT EXISTS approval_requests_run_id      ON approval_requests(company_run_id);`,
	`CREATE INDEX IF NOT EXISTS approval_requests_status      ON approval_requests(status);`,
	`CREATE INDEX IF NOT EXISTS approval_requests_from_member ON approval_requests(from_member);`,

	`CREATE TABLE IF NOT EXISTS agent_activity (
    id               TEXT PRIMARY KEY,
    company_run_id   TEXT NOT NULL REFERENCES company_runs(id),
    member_slug      TEXT NOT NULL,
    status           TEXT NOT NULL,
    activity         TEXT NOT NULL,
    detail           TEXT,
    cost_usd         REAL NOT NULL DEFAULT 0,
    total_ms         INTEGER NOT NULL DEFAULT 0,
    first_event_ms   INTEGER NOT NULL DEFAULT 0,
    first_text_ms    INTEGER NOT NULL DEFAULT 0,
    first_tool_ms    INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

	`CREATE INDEX IF NOT EXISTS agent_activity_run_id     ON agent_activity(company_run_id);`,
	`CREATE INDEX IF NOT EXISTS agent_activity_member     ON agent_activity(member_slug);`,
	`CREATE INDEX IF NOT EXISTS agent_activity_created_at ON agent_activity(created_at);`,

	// Views
	COMPANY_LEDGER_SUMMARY_VIEW_SQL,
	MEMBER_COST_SUMMARY_VIEW_SQL,

	// Housekeeping trigger: auto-archive stale team_messages after retention period.
	// Runs on INSERT to team_messages; does a soft-delete by nulling content.
	`CREATE TRIGGER IF NOT EXISTS team_messages_retention_cleanup
   AFTER INSERT ON team_messages
   BEGIN
     UPDATE team_messages
     SET content = '[archived]'
     WHERE company_run_id = NEW.company_run_id
       AND channel = NEW.channel
       AND retention_hours_active = 1  -- placeholder; implement in app layer
       AND created_at < datetime('now', '-' || (
         SELECT COALESCE(retention_hours, 48) || ' hours'
         FROM company_channels
         WHERE company_id = (
           SELECT company_id FROM company_runs WHERE id = NEW.company_run_id
         ) AND slug = NEW.channel
         LIMIT 1
       ));
   END;`,
];
