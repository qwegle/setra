import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────────────────────────────────────
// Shared column helpers
// ─────────────────────────────────────────────────────────────────────────────

const timestamps = {
	createdAt: text("created_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	updatedAt: text("updated_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

const uuidPk = () =>
	text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`);

// ─────────────────────────────────────────────────────────────────────────────
// GROUNDS — SSH remote machines setra connects to
// ─────────────────────────────────────────────────────────────────────────────

export const grounds = sqliteTable("grounds", {
	id: uuidPk(),
	name: text("name").notNull(),
	host: text("host").notNull(),
	port: integer("port").notNull().default(22),
	username: text("username").notNull(),
	// 'key' | 'password' | 'agent'
	authType: text("auth_type", { enum: ["key", "password", "agent"] }).notNull(),
	// path to private key file — never store the key itself
	keyPath: text("key_path"),
	// company secret name for password / PEM / token material
	secretRef: text("secret_ref"),
	tmuxPrefix: text("tmux_prefix").notNull().default("setra"),
	status: text("status", {
		enum: ["unknown", "connected", "disconnected", "error"],
	})
		.notNull()
		.default("unknown"),
	lastPingAt: text("last_ping_at"),
	notes: text("notes"),
	// ── Ground fields ───────────────────────────────────────────────────────────
	// 'local' | 'ssh' | 'docker' | 'database'
	groundType: text("ground_type").notNull().default("local"),
	dockerImage: text("docker_image"),
	dockerNetwork: text("docker_network"),
	companyId: text("company_id"),
	projectId: text("project_id"),
	// ── DB ground fields (groundType = 'database') ──────────────────────────────
	// 'postgres' | 'mysql' | 'mssql' | 'mongodb'
	dbDriver: text("db_driver"),
	dbHost: text("db_host"),
	dbPort: integer("db_port"),
	dbName: text("db_name"),
	dbUser: text("db_user"),
	// env var NAME only — password is NEVER stored
	dbPasswordEnv: text("db_password_env"),
	// 1 = require SSL (default), 0 = disable
	dbSsl: integer("db_ssl").notNull().default(1),
	// 1 = allow writes, 0 = read-only (default)
	dbAllowWrite: integer("db_allow_write").notNull().default(0),
	// alternative: full DSN stored in this env var
	dbConnectionStringEnv: text("db_connection_string_env"),
	// JSON schema cache, refreshed on connect
	dbSchemaCache: text("db_schema_cache"),
	dbLastConnectedAt: text("db_last_connected_at"),
	...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOLS — registered MCP servers
// ─────────────────────────────────────────────────────────────────────────────

export const tools = sqliteTable("tools", {
	id: uuidPk(),
	name: text("name").notNull().unique(),
	description: text("description"),
	// 'stdio' | 'http' | 'sse'
	transport: text("transport", { enum: ["stdio", "http", "sse"] }).notNull(),
	// stdio: e.g. "npx @modelcontextprotocol/server-filesystem"
	command: text("command"),
	// JSON array of string args
	args: text("args"),
	// http/sse endpoint
	url: text("url"),
	// JSON object { "KEY": "value" }
	envVars: text("env_vars"),
	// 1 = setra-core, cannot be removed by user
	isBuiltin: integer("is_builtin", { mode: "boolean" })
		.notNull()
		.default(false),
	// 1 = auto-enabled for every new plot
	isGlobal: integer("is_global", { mode: "boolean" }).notNull().default(false),
	healthStatus: text("health_status", {
		enum: ["unknown", "healthy", "error"],
	})
		.notNull()
		.default("unknown"),
	lastHealthCheck: text("last_health_check"),
	...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTS — a git repository
// ─────────────────────────────────────────────────────────────────────────────

export const projects = sqliteTable("projects", {
	id: uuidPk(),
	name: text("name").notNull(),
	// absolute path to git repo root — unique per machine
	repoPath: text("repo_path").notNull().unique(),
	remoteUrl: text("remote_url"),
	defaultBranch: text("default_branch").notNull().default("main"),
	totalCostUsd: real("total_cost_usd").notNull().default(0),
	totalRuns: integer("total_runs").notNull().default(0),
	lastActiveAt: text("last_active_at"),
	...timestamps,
	// SaaS Phase 2: ADD organizationId TEXT NOT NULL REFERENCES organizations(id)
});

// ─────────────────────────────────────────────────────────────────────────────
// PLOTS — isolated git worktrees (one per task)
// ─────────────────────────────────────────────────────────────────────────────

export const plots = sqliteTable(
	"plots",
	{
		id: uuidPk(),
		name: text("name").notNull(),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		// absolute path to the git worktree (null before creation)
		worktreePath: text("worktree_path"),
		// branch name: setra/plot-{id}
		branch: text("branch").notNull(),
		baseBranch: text("base_branch").notNull().default("main"),
		groundId: text("ground_id").references(() => grounds.id, {
			onDelete: "set null",
		}),
		status: text("status", {
			enum: ["idle", "running", "paused", "archived", "error"],
		})
			.notNull()
			.default("idle"),
		// JSON: { name, systemPrompt, model, tools, contextInject }
		agentTemplate: text("agent_template"),
		description: text("description"),
		autoCheckpoint: integer("auto_checkpoint", { mode: "boolean" })
			.notNull()
			.default(true),
		checkpointIntervalS: integer("checkpoint_interval_s")
			.notNull()
			.default(300),
		totalCostUsd: real("total_cost_usd").notNull().default(0),
		lastActiveAt: text("last_active_at"),
		// Team Mode: only one agent can claim a plot at a time (pessimistic lock)
		claimedBySessionId: text("claimed_by_session_id"),
		...timestamps,
		// SaaS Phase 2: ADD createdBy TEXT REFERENCES users(id)
	},
	(table) => [
		index("idx_plots_project_id").on(table.projectId),
		index("idx_plots_status").on(table.status),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// PLOT ↔ TOOL join table
// ─────────────────────────────────────────────────────────────────────────────

export const plotTools = sqliteTable(
	"plot_tools",
	{
		plotId: text("plot_id")
			.notNull()
			.references(() => plots.id, { onDelete: "cascade" }),
		toolId: text("tool_id")
			.notNull()
			.references(() => tools.id, { onDelete: "cascade" }),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		// JSON: plot-specific env overrides for this tool
		envOverrides: text("env_overrides"),
	},
	(table) => [primaryKey({ columns: [table.plotId, table.toolId] })],
);

// ─────────────────────────────────────────────────────────────────────────────
// RUNS — a single agent invocation
// ─────────────────────────────────────────────────────────────────────────────

export const runs = sqliteTable(
	"runs",
	{
		id: uuidPk(),
		plotId: text("plot_id")
			.notNull()
			.references(() => plots.id, { onDelete: "cascade" }),
		// 'claude' | 'codex' | 'gemini' | 'ollama' | 'custom'
		agent: text("agent").notNull(),
		agentVersion: text("agent_version"),
		// full path to agent binary
		agentBinary: text("agent_binary"),
		// JSON array of args passed to the binary
		agentArgs: text("agent_args"),
		branchName: text("branch_name"),
		status: text("status", {
			enum: ["pending", "running", "completed", "failed", "cancelled"],
		})
			.notNull()
			.default("pending"),
		// OS PID of the PTY process (or SSH channel ID for remote)
		ptyPid: integer("pty_pid"),
		// tmux session name: setra-{plot-id}
		tmuxSession: text("tmux_session"),
		groundId: text("ground_id").references(() => grounds.id, {
			onDelete: "set null",
		}),
		// Token tracking — all five fields as per blueprint (setra pattern)
		promptTokens: integer("prompt_tokens").notNull().default(0),
		completionTokens: integer("completion_tokens").notNull().default(0),
		// CRITICAL: track cache tokens separately to prove caching is working
		cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
		cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
		costUsd: real("cost_usd").notNull().default(0),
		// 'high' = parsed from agent output, 'low' = estimated, 'none' = parse failed
		costConfidence: text("cost_confidence", {
			enum: ["high", "low", "none"],
		})
			.notNull()
			.default("none"),
		outcome: text("outcome", { enum: ["success", "partial", "failed"] }),
		errorMessage: text("error_message"),
		exitCode: integer("exit_code"),
		startedAt: text("started_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		endedAt: text("ended_at"),
		updatedAt: text("updated_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		// SaaS Phase 2: ADD triggeredBy TEXT REFERENCES users(id)
	},
	(table) => [
		index("idx_runs_plot_id").on(table.plotId),
		index("idx_runs_status").on(table.status),
		index("idx_runs_started_at").on(table.startedAt),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// CHUNKS — terminal output (ring-buffer semantics, 50k chunk limit)
// Named 'chunks' not 'session_chunks' — shorter and the run gives context
// ─────────────────────────────────────────────────────────────────────────────

export const chunks = sqliteTable(
	"chunks",
	{
		// integer autoincrement for fast range queries
		id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
		runId: text("run_id")
			.notNull()
			.references(() => runs.id, { onDelete: "cascade" }),
		// monotonic per-run sequence for cursor-based replay (setra pattern)
		sequence: integer("sequence").notNull(),
		// raw terminal bytes — ANSI escape codes included for xterm.js
		content: text("content").notNull(),
		chunkType: text("chunk_type", {
			enum: ["output", "input", "system", "cost_update"],
		})
			.notNull()
			.default("output"),
		recordedAt: text("recorded_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(table) => [
		uniqueIndex("uniq_chunks_run_seq").on(table.runId, table.sequence),
		index("idx_chunks_run_sequence").on(table.runId, table.sequence),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// MARKS — git checkpoints setra creates automatically
// ─────────────────────────────────────────────────────────────────────────────

export const marks = sqliteTable(
	"marks",
	{
		id: uuidPk(),
		runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
		plotId: text("plot_id")
			.notNull()
			.references(() => plots.id, { onDelete: "cascade" }),
		commitHash: text("commit_hash").notNull(),
		branch: text("branch").notNull(),
		message: text("message"),
		// 'auto' = checkpoint timer, 'manual' = user-triggered, 'pre_path' = before deploy
		markType: text("mark_type", {
			enum: ["auto", "manual", "pre_path", "post_path", "session_end"],
		})
			.notNull()
			.default("auto"),
		filesChanged: integer("files_changed").notNull().default(0),
		insertions: integer("insertions").notNull().default(0),
		deletions: integer("deletions").notNull().default(0),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(table) => [
		index("idx_marks_plot_id").on(table.plotId),
		index("idx_marks_run_id").on(table.runId),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// PATHS — deploy pipeline definitions
// ─────────────────────────────────────────────────────────────────────────────

export const paths = sqliteTable("paths", {
	id: uuidPk(),
	plotId: text("plot_id")
		.notNull()
		.references(() => plots.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	trigger: text("trigger", {
		enum: ["manual", "on_run_complete", "on_mark", "scheduled"],
	}).notNull(),
	// JSON: Array<{ name: string; type: string; command: string; env: Record<string,string>; timeoutS: number; onFailure: 'stop' | 'continue' }>
	stages: text("stages").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// PATH RUNS — deploy pipeline execution history
// ─────────────────────────────────────────────────────────────────────────────

export const pathRuns = sqliteTable("path_runs", {
	id: uuidPk(),
	pathId: text("path_id")
		.notNull()
		.references(() => paths.id, { onDelete: "cascade" }),
	runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
	status: text("status", {
		enum: ["pending", "running", "success", "failed", "cancelled"],
	})
		.notNull()
		.default("pending"),
	currentStage: text("current_stage"),
	// raw logs from each stage
	log: text("log"),
	triggeredBy: text("triggered_by", { enum: ["auto", "manual"] })
		.notNull()
		.default("auto"),
	startedAt: text("started_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	endedAt: text("ended_at"),
	durationMs: integer("duration_ms"),
});

// ─────────────────────────────────────────────────────────────────────────────
// TRACES — vector memory entries (agents leave traces)
// ─────────────────────────────────────────────────────────────────────────────

export const traces = sqliteTable(
	"traces",
	{
		id: uuidPk(),
		runId: text("run_id").references(() => runs.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		content: text("content").notNull(),
		// SHA-256 of content, for deduplication before embedding
		contentHash: text("content_hash").notNull(),
		sourceType: text("source_type", {
			enum: [
				"run_output",
				"file_diff",
				"user_note",
				"mark_diff",
				"synthetic",
				"handoff",
			],
		})
			.notNull()
			.default("run_output"),
		// sqlite-vec rowid or Qdrant point ID
		vectorId: text("vector_id"),
		// 1 = auto-generated codebase analysis trace
		isSynthetic: integer("is_synthetic", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(table) => [
		uniqueIndex("uniq_traces_hash_project").on(
			table.contentHash,
			table.projectId,
		),
		index("idx_traces_project").on(table.projectId),
		index("idx_traces_run").on(table.runId),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// APP SETTINGS — typed key-value config (singleton-style per key)
// ─────────────────────────────────────────────────────────────────────────────

export const appSettings = sqliteTable("app_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	updatedAt: text("updated_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

// ─────────────────────────────────────────────────────────────────────────────
// TEAM MESSAGES — company/team coordination (async, broker pattern)
// ─────────────────────────────────────────────────────────────────────────────

export const teamMessages = sqliteTable(
	"team_messages",
	{
		id: uuidPk(),
		// channel: 'general', 'eng', 'qa', or a specific plot-id
		channel: text("channel").notNull(),
		// sender: agent name or 'user'
		fromAgent: text("from_agent").notNull(),
		toAgent: text("to_agent"),
		content: text("content").notNull(),
		messageType: text("message_type", {
			enum: ["task", "reply", "status", "handoff", "approval_request"],
		})
			.notNull()
			.default("task"),
		// cursor-based message reading (setra Kafka-offset pattern)
		sequence: integer("sequence").notNull(),
		// null = not yet read by target agent
		readAt: text("read_at"),
		plotId: text("plot_id").references(() => plots.id, { onDelete: "cascade" }),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(table) => [
		index("idx_team_messages_channel").on(table.channel),
		index("idx_team_messages_sequence").on(table.sequence),
	],
);

// ─────────────────────────────────────────────────────────────────────────────
// AGENT TEMPLATES — reusable agent run configurations
// ─────────────────────────────────────────────────────────────────────────────

export const agentTemplates = sqliteTable("agent_templates", {
	id: uuidPk(),
	name: text("name").notNull().unique(),
	description: text("description"),
	// 'claude' | 'codex' | 'gemini' | 'ollama' | 'custom'
	agent: text("agent").notNull(),
	model: text("model"),
	systemPrompt: text("system_prompt"),
	// JSON array of tool names to enable
	tools: text("tools"),
	// JSON: { packageJson: boolean, readme: boolean, gitLog: number }
	contextInject: text("context_inject"),
	// 'low' | 'medium' | 'high' — for user guidance
	estimatedCostTier: text("estimated_cost_tier", {
		enum: ["low", "medium", "high"],
	}).default("medium"),
	// 1 = shipped with setra, 0 = user-created or community import
	isBuiltin: integer("is_builtin", { mode: "boolean" })
		.notNull()
		.default(false),
	...timestamps,
});

// ─────────────────────────────────────────────────────────────────────────────
// Type exports — inferred from schema (Drizzle pattern)
// ─────────────────────────────────────────────────────────────────────────────

export type Ground = typeof grounds.$inferSelect;
export type NewGround = typeof grounds.$inferInsert;

export type Tool = typeof tools.$inferSelect;
export type NewTool = typeof tools.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Plot = typeof plots.$inferSelect;
export type NewPlot = typeof plots.$inferInsert;

export type PlotTool = typeof plotTools.$inferSelect;
export type NewPlotTool = typeof plotTools.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;

export type Mark = typeof marks.$inferSelect;
export type NewMark = typeof marks.$inferInsert;

export type Path = typeof paths.$inferSelect;
export type NewPath = typeof paths.$inferInsert;

export type PathRun = typeof pathRuns.$inferSelect;
export type NewPathRun = typeof pathRuns.$inferInsert;

export type Trace = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;

export type TeamMessage = typeof teamMessages.$inferSelect;
export type NewTeamMessage = typeof teamMessages.$inferInsert;

export type AgentTemplate = typeof agentTemplates.$inferSelect;
export type NewAgentTemplate = typeof agentTemplates.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// AGENT SCORES — Bayesian credibility tracking per agent slug
// ─────────────────────────────────────────────────────────────────────────────

export const agentScores = sqliteTable("agent_scores", {
	agentSlug: text("agent_slug").primaryKey(),
	successes: integer("successes").default(0).notNull(),
	failures: integer("failures").default(0).notNull(),
	lastUpdated: text("last_updated").default(
		sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
	),
});

export type AgentScore = typeof agentScores.$inferSelect;
export type NewAgentScore = typeof agentScores.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// AGENT EVENTS — publish/subscribe event bus for agent communication
// ─────────────────────────────────────────────────────────────────────────────

export const agentEvents = sqliteTable(
	"agent_events",
	{
		id: text("id").primaryKey(),
		companyId: text("company_id").notNull(),
		eventType: text("event_type").notNull(),
		sourceAgent: text("source_agent").notNull(),
		targetAgent: text("target_agent"),
		issueId: text("issue_id"),
		runId: text("run_id"),
		payload: text("payload").default("{}"),
		// comma-separated slugs that have acked
		processedBy: text("processed_by").default(""),
		createdAt: text("created_at")
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
			.notNull(),
	},
	(table) => [
		index("idx_agent_events_company").on(table.companyId),
		index("idx_agent_events_source").on(table.sourceAgent),
		index("idx_agent_events_target").on(table.targetAgent),
		index("idx_agent_events_created").on(table.createdAt),
	],
);

export const agentEventAcks = sqliteTable(
	"agent_event_acks",
	{
		eventId: text("event_id").notNull(),
		agentSlug: text("agent_slug").notNull(),
		ackedAt: text("acked_at")
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.eventId, table.agentSlug] }),
		index("idx_agent_event_acks_slug").on(table.agentSlug),
	],
);

export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;
export type AgentEventAck = typeof agentEventAcks.$inferSelect;

export * from "./enterprise.js";
