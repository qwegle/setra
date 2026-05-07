/**
 * Server-local Drizzle schema for tables managed by the control-plane server.
 * These tables live in the same setra.db file but are not part of @setra/db.
 */
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { rawSqlite } from "./client.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const uuidPk = () =>
	text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`);

const ts = {
	createdAt: text("created_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	updatedAt: text("updated_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};

const nowText = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ─── Agent Roster ─────────────────────────────────────────────────────────────

export const agentRoster = sqliteTable("agent_roster", {
	id: uuidPk(),
	companyId: text("company_id"),
	slug: text("slug").notNull().unique(),
	displayName: text("display_name").notNull(),
	modelId: text("model_id"),
	systemPrompt: text("system_prompt"),
	adapterType: text("adapter_type").notNull().default("claude"),
	command: text("command"),
	commandArgs: text("command_args"),
	httpUrl: text("http_url"),
	envVars: text("env_vars"),
	allowedPermissions: text("allowed_permissions"),
	skills: text("skills"),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	// Lifecycle status: 'awaiting_key' (no provider configured), 'idle' (ready
	// but no run in flight), 'running', 'paused' (budget hard-stop or admin pause).
	status: text("status").notNull().default("idle"),
	pausedReason: text("paused_reason"),
	// Operating mode: 'write' (full edit/exec), 'read_only', 'plan' (drafts only),
	// 'conversation' (chat, no tools). User-managed via Configuration tab.
	mode: text("mode").notNull().default("write"),
	autonomyLevel: text("autonomy_level").notNull().default("semi"),
	runMode: text("run_mode").notNull().default("on_demand"),
	continuousIntervalMs: integer("continuous_interval_ms").default(60_000),
	idlePrompt: text("idle_prompt"),
	lastRunEndedAt: text("last_run_ended_at"),
	...ts,
});

// ─── Companies ────────────────────────────────────────────────────────────────

export const companies = sqliteTable("companies", {
	id: uuidPk(),
	name: text("name").notNull(),
	issuePrefix: text("issue_prefix").notNull(),
	goal: text("goal"),
	type: text("type"),
	size: text("size"),
	isOfflineOnly: integer("is_offline_only", { mode: "boolean" })
		.notNull()
		.default(false),
	brandColor: text("brand_color"),
	logoUrl: text("logo_url"),
	...ts,
});

// ─── Approvals ────────────────────────────────────────────────────────────────

export const approvals = sqliteTable("approvals", {
	id: uuidPk(),
	companyId: text("company_id"),
	requestedByAgentId: text("requested_by_agent_id").notNull(),
	agentName: text("agent_name").notNull(),
	action: text("action").notNull(),
	description: text("description").notNull(),
	payload: text("payload"),
	issueId: text("issue_id"),
	issueTitle: text("issue_title"),
	status: text("status").notNull().default("pending"),
	resolvedAt: text("resolved_at"),
	...ts,
});

// ─── Goals ────────────────────────────────────────────────────────────────────

export const goals = sqliteTable("goals", {
	id: uuidPk(),
	companyId: text("company_id"),
	title: text("title").notNull(),
	description: text("description"),
	status: text("status").notNull().default("active"),
	parentGoalId: text("parent_goal_id"),
	...ts,
});

// ─── Routines ─────────────────────────────────────────────────────────────────

export const routines = sqliteTable("routines", {
	id: uuidPk(),
	companyId: text("company_id"),
	name: text("name").notNull(),
	description: text("description"),
	schedule: text("schedule"),
	agentId: text("agent_id"),
	prompt: text("prompt"),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	lastRunAt: text("last_run_at"),
	lastTriggeredAt: text("last_triggered_at"),
	nextRunAt: text("next_run_at"),
	...ts,
});

// ─── Routine Runs ─────────────────────────────────────────────────────────────

export const routineRuns = sqliteTable("routine_runs", {
	id: uuidPk(),
	routineId: text("routine_id").notNull(),
	status: text("status").notNull().default("pending"),
	startedAt: text("started_at").notNull(),
	completedAt: text("completed_at"),
	output: text("output"),
	createdAt: text("created_at").notNull().default(nowText),
});

// ─── Inbox Alerts ─────────────────────────────────────────────────────────────

export const inboxAlerts = sqliteTable("inbox_alerts", {
	id: uuidPk(),
	companyId: text("company_id"),
	type: text("type").notNull(),
	message: text("message").notNull(),
	severity: text("severity").notNull().default("info"),
	read: integer("read", { mode: "boolean" }).notNull().default(false),
	...ts,
});

// ─── LLM Settings (single row) ────────────────────────────────────────────────

export const llmSettings = sqliteTable("llm_settings", {
	id: text("id").primaryKey().default("default"),
	ollamaUrl: text("ollama_url").notNull().default("http://localhost:11434"),
	lmstudioUrl: text("lmstudio_url").notNull().default("http://localhost:1234"),
	defaultOfflineModel: text("default_offline_model")
		.notNull()
		.default("llama3.2"),
	maxConcurrentPulls: integer("max_concurrent_pulls").notNull().default(2),
	updatedAt: text("updated_at").notNull().default(nowText),
});

// ─── Company Settings (single row) ────────────────────────────────────────────

export const companySettings = sqliteTable("company_settings", {
	id: text("id").primaryKey().default("default"),
	name: text("name").notNull().default("My Company"),
	slug: text("slug").notNull().default("my-company"),
	domain: text("domain"),
	timezone: text("timezone").notNull().default("UTC"),
	defaultModel: text("default_model").notNull().default("claude-sonnet-4-6"),
	isOfflineOnly: integer("is_offline_only", { mode: "boolean" })
		.notNull()
		.default(false),
	brandColor: text("brand_color"),
	logoUrl: text("logo_url"),
	updatedAt: text("updated_at").notNull().default(nowText),
});

// ─── Company Members ──────────────────────────────────────────────────────────

export const companyMembers = sqliteTable("company_members", {
	id: uuidPk(),
	companyId: text("company_id"),
	name: text("name").notNull(),
	email: text("email").notNull(),
	role: text("role").notNull().default("member"),
	avatarUrl: text("avatar_url"),
	joinedAt: text("joined_at").notNull().default(nowText),
});

// ─── Company Invites ──────────────────────────────────────────────────────────

export const companyInvites = sqliteTable("company_invites", {
	id: uuidPk(),
	companyId: text("company_id"),
	email: text("email").notNull(),
	role: text("role").notNull().default("member"),
	status: text("status").notNull().default("pending"),
	sentAt: text("sent_at").notNull().default(nowText),
	expiresAt: text("expires_at").notNull(),
});

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const workspaces = sqliteTable("workspaces", {
	id: uuidPk(),
	companyId: text("company_id"),
	name: text("name").notNull(),
	type: text("type").notNull().default("local"),
	isDefault: integer("is_default", { mode: "boolean" })
		.notNull()
		.default(false),
	config: text("config").notNull().default("{}"),
	...ts,
});

// ─── Adapter Configs ──────────────────────────────────────────────────────────

export const adapterConfigs = sqliteTable("adapter_configs", {
	id: text("id").primaryKey(),
	companyId: text("company_id"),
	name: text("name").notNull(),
	type: text("type").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
	config: text("config").notNull().default("{}"),
	isConfigured: integer("is_configured", { mode: "boolean" })
		.notNull()
		.default(false),
	updatedAt: text("updated_at").notNull().default(nowText),
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins = sqliteTable("plugins", {
	id: text("id").primaryKey(),
	companyId: text("company_id"),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	version: text("version").notNull().default("1.0.0"),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
	isInstalled: integer("is_installed", { mode: "boolean" })
		.notNull()
		.default(false),
	config: text("config"),
	updatedAt: text("updated_at").notNull().default(nowText),
});

// ─── Feature Flags ────────────────────────────────────────────────────────────

export const featureFlags = sqliteTable("feature_flags", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
	isExperimental: integer("is_experimental", { mode: "boolean" })
		.notNull()
		.default(false),
	updatedAt: text("updated_at").notNull().default(nowText),
});

// ─── Skills ───────────────────────────────────────────────────────────────────

export const skills = sqliteTable("skills", {
	id: uuidPk(),
	companyId: text("company_id"),
	name: text("name").notNull(),
	slug: text("slug").notNull(),
	description: text("description"),
	category: text("category"),
	trigger: text("trigger"),
	prompt: text("prompt"),
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	usageCount: integer("usage_count").notNull().default(0),
	lastUsedAt: text("last_used_at"),
	...ts,
});

// ─── Artifacts ────────────────────────────────────────────────────────────────

export const artifacts = sqliteTable("artifacts", {
	id: uuidPk(),
	companyId: text("company_id"),
	issueId: text("issue_id"),
	agentSlug: text("agent_slug"),
	name: text("name").notNull(),
	mimeType: text("mime_type"),
	content: text("content"),
	...ts,
});

// ─── Wiki Entries ─────────────────────────────────────────────────────────────

export const wikiEntries = sqliteTable("wiki_entries", {
	id: uuidPk(),
	companyId: text("company_id"),
	title: text("title").notNull(),
	slug: text("slug").notNull(),
	category: text("category"),
	tags: text("tags"),
	authorSlug: text("author_slug"),
	content: text("content").notNull().default(""),
	...ts,
});

// ─── Review Items ─────────────────────────────────────────────────────────────

export const reviewItems = sqliteTable("review_items", {
	id: uuidPk(),
	companyId: text("company_id"),
	type: text("type"),
	entityType: text("entity_type"),
	entityId: text("entity_id"),
	title: text("title"),
	description: text("description"),
	requestedBy: text("requested_by"),
	targetIssueSlug: text("target_issue_slug"),
	estimatedCostUsd: real("estimated_cost_usd"),
	diff: text("diff"),
	riskLevel: text("risk_level").notNull().default("medium"),
	status: text("status").notNull().default("pending"),
	comment: text("comment"),
	resolvedAt: text("resolved_at"),
	...ts,
});

// ─── ensureTables ─────────────────────────────────────────────────────────────
// Creates all server-local tables using CREATE TABLE IF NOT EXISTS.
// Safe to call on every startup.

export function ensureTables(): void {
	rawSqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_roster (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      model_id TEXT,
      system_prompt TEXT,
      adapter_type TEXT NOT NULL DEFAULT 'claude',
      command TEXT,
      command_args TEXT,
      http_url TEXT,
      env_vars TEXT,
      allowed_permissions TEXT,
      skills TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'idle',
      paused_reason TEXT,
      mode TEXT NOT NULL DEFAULT 'write',
      autonomy_level TEXT NOT NULL DEFAULT 'semi',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      issue_prefix TEXT NOT NULL,
      goal TEXT,
      type TEXT,
      size TEXT,
      is_offline_only INTEGER NOT NULL DEFAULT 0,
      brand_color TEXT,
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Hierarchical org roster: each row is a "hire" of an agent_template into the company.
    -- Joined with agent_roster on display_name to expose runtime status in the org tree.
    CREATE TABLE IF NOT EXISTS company_roster (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      company_id TEXT,
      template_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      reports_to TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      hired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      requested_by_agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      payload TEXT,
      issue_id TEXT,
      issue_title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      company_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      parent_goal_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      company_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      schedule TEXT,
      agent_id TEXT,
      prompt TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_triggered_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS routine_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      routine_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      output TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS inbox_alerts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS llm_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      ollama_url TEXT NOT NULL DEFAULT 'http://localhost:11434',
      lmstudio_url TEXT NOT NULL DEFAULT 'http://localhost:1234',
      default_offline_model TEXT NOT NULL DEFAULT 'llama3.2',
      max_concurrent_pulls INTEGER NOT NULL DEFAULT 2,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS company_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      name TEXT NOT NULL DEFAULT 'My Company',
      slug TEXT NOT NULL DEFAULT 'my-company',
      domain TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      is_offline_only INTEGER NOT NULL DEFAULT 0,
      brand_color TEXT,
      logo_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS company_members (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      avatar_url TEXT,
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS company_invites (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'local',
      is_default INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS adapter_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      is_configured INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      enabled INTEGER NOT NULL DEFAULT 0,
      is_installed INTEGER NOT NULL DEFAULT 0,
      config TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      is_experimental INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      category TEXT,
      trigger TEXT,
      prompt TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      issue_id TEXT,
      agent_slug TEXT,
      name TEXT NOT NULL,
      mime_type TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS wiki_entries (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      category TEXT,
      tags TEXT,
      author_slug TEXT,
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      company_id TEXT,
      type TEXT,
      entity_type TEXT,
      entity_id TEXT,
      title TEXT,
      description TEXT,
      requested_by TEXT,
      target_issue_slug TEXT,
      estimated_cost_usd REAL,
      diff TEXT,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'pending',
      comment TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      approach TEXT,
      subtasks TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      feedback TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plans_company_status ON plans(company_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plans_issue ON plans(issue_id, created_at DESC);
  `);

	// ── Idempotent migrations for existing DBs ───────────────────────────────
	// Older installs may not have agent_roster.status / paused_reason columns
	// yet. Add them defensively. SQLite only supports ADD COLUMN, no IF NOT
	// EXISTS for columns, so swallow the duplicate-column error.
	for (const stmt of [
		`ALTER TABLE agent_roster ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'`,
		`ALTER TABLE agent_roster ADD COLUMN paused_reason TEXT`,
		`ALTER TABLE agent_roster ADD COLUMN company_id TEXT`,
		`ALTER TABLE agent_roster ADD COLUMN mode TEXT NOT NULL DEFAULT 'write'`,
		`ALTER TABLE agent_roster ADD COLUMN autonomy_level TEXT NOT NULL DEFAULT 'semi'`,
		`ALTER TABLE agent_roster ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'on_demand'`,
		`ALTER TABLE agent_roster ADD COLUMN continuous_interval_ms INTEGER DEFAULT 60000`,
		`ALTER TABLE agent_roster ADD COLUMN idle_prompt TEXT`,
		`ALTER TABLE agent_roster ADD COLUMN last_run_ended_at TEXT`,
		// Roster merge: agent_roster is now the canonical org-tree row. parent_agent_id
		// is a self-FK that replaces company_roster.reports_to. template_id replaces
		// the JOIN to company_roster for template metadata. Backfill follows below.
		`ALTER TABLE agent_roster ADD COLUMN parent_agent_id TEXT`,
		`ALTER TABLE agent_roster ADD COLUMN template_id TEXT`,
		`ALTER TABLE goals ADD COLUMN company_id TEXT`,
		`ALTER TABLE company_roster ADD COLUMN company_id TEXT`,
		`ALTER TABLE approvals ADD COLUMN company_id TEXT`,
		`ALTER TABLE routines ADD COLUMN company_id TEXT`,
		`ALTER TABLE routines ADD COLUMN agent_id TEXT`,
		`ALTER TABLE routines ADD COLUMN prompt TEXT`,
		`ALTER TABLE routines ADD COLUMN last_triggered_at TEXT`,
		`ALTER TABLE routines ADD COLUMN next_run_at TEXT`,
		`ALTER TABLE routines ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`,
		`ALTER TABLE inbox_alerts ADD COLUMN company_id TEXT`,
		`ALTER TABLE company_members ADD COLUMN company_id TEXT`,
		`ALTER TABLE company_invites ADD COLUMN company_id TEXT`,
		`ALTER TABLE workspaces ADD COLUMN company_id TEXT`,
		`ALTER TABLE adapter_configs ADD COLUMN company_id TEXT`,
		`ALTER TABLE plugins ADD COLUMN company_id TEXT`,
		`ALTER TABLE skills ADD COLUMN company_id TEXT`,
		`ALTER TABLE artifacts ADD COLUMN company_id TEXT`,
		`ALTER TABLE wiki_entries ADD COLUMN company_id TEXT`,
		`ALTER TABLE review_items ADD COLUMN company_id TEXT`,
		`ALTER TABLE review_items ADD COLUMN entity_type TEXT`,
		`ALTER TABLE review_items ADD COLUMN entity_id TEXT`,
		`ALTER TABLE review_items ADD COLUMN description TEXT`,
		`ALTER TABLE review_items ADD COLUMN requested_by TEXT`,
		`ALTER TABLE review_items ADD COLUMN target_issue_slug TEXT`,
		`ALTER TABLE review_items ADD COLUMN estimated_cost_usd REAL`,
		`ALTER TABLE review_items ADD COLUMN diff TEXT`,
		`ALTER TABLE review_items ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'medium'`,
		`ALTER TABLE integrations ADD COLUMN company_id TEXT`,
		`ALTER TABLE grounds ADD COLUMN company_id TEXT`,
		`ALTER TABLE grounds ADD COLUMN project_id TEXT`,
		`ALTER TABLE grounds ADD COLUMN secret_ref TEXT`,
		`ALTER TABLE grounds ADD COLUMN docker_image TEXT`,
		`ALTER TABLE grounds ADD COLUMN docker_network TEXT`,
		`ALTER TABLE team_messages ADD COLUMN company_id TEXT`,
		`ALTER TABLE board_projects ADD COLUMN company_id TEXT`,
		`ALTER TABLE board_projects ADD COLUMN workspace_path TEXT`,
		`ALTER TABLE board_projects ADD COLUMN repo_url TEXT`,
		`ALTER TABLE board_projects ADD COLUMN repo_path TEXT`,
		`ALTER TABLE board_projects ADD COLUMN default_branch TEXT DEFAULT 'main'`,
		`ALTER TABLE board_projects ADD COLUMN git_initialized INTEGER DEFAULT 0`,
		`ALTER TABLE board_projects ADD COLUMN color TEXT DEFAULT '#6366f1'`,
		`ALTER TABLE board_projects ADD COLUMN requirements TEXT DEFAULT ''`,
		`ALTER TABLE board_projects ADD COLUMN plan_status TEXT DEFAULT 'none'`,
		`ALTER TABLE board_projects ADD COLUMN settings_json TEXT DEFAULT '{}'`,
		`ALTER TABLE board_budget_limits ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default'`,
		`ALTER TABLE clone_profile ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default'`,
		`ALTER TABLE clone_observations ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default'`,
		`ALTER TABLE board_issues ADD COLUMN company_id TEXT`,
		`ALTER TABLE board_issues ADD COLUMN linked_plot_id TEXT`,
		`ALTER TABLE board_issues ADD COLUMN due_date TEXT`,
		`ALTER TABLE board_issues ADD COLUMN labels TEXT`,
		`ALTER TABLE board_issues ADD COLUMN tags TEXT`,
		`ALTER TABLE board_issues ADD COLUMN completed_at TEXT`,
		`ALTER TABLE board_issues ADD COLUMN branch_name TEXT`,
		`ALTER TABLE board_issues ADD COLUMN pr_url TEXT`,
		`ALTER TABLE board_issues ADD COLUMN pr_state TEXT`,
		`ALTER TABLE board_issues ADD COLUMN commit_shas TEXT`,
		`ALTER TABLE board_issues ADD COLUMN lifecycle_stage TEXT DEFAULT 'backlog'`,
		`ALTER TABLE board_issues ADD COLUMN parent_issue_id TEXT REFERENCES board_issues(id) ON DELETE SET NULL`,
		`ALTER TABLE board_issues ADD COLUMN review_status TEXT`,
		`ALTER TABLE board_issues ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE board_issues ADD COLUMN acceptance_criteria TEXT DEFAULT ''`,
		`ALTER TABLE board_issues ADD COLUMN test_command TEXT DEFAULT ''`,
		`ALTER TABLE board_issues ADD COLUMN test_status TEXT DEFAULT 'none'`,
		`ALTER TABLE team_messages ADD COLUMN message_kind TEXT`,
		`ALTER TABLE team_messages ADD COLUMN pinned INTEGER DEFAULT 0`,
		`ALTER TABLE activity_log ADD COLUMN company_id TEXT`,
		`ALTER TABLE activity_log ADD COLUMN entity_type TEXT`,
		`ALTER TABLE activity_log ADD COLUMN entity_id TEXT`,
		`ALTER TABLE activity_log ADD COLUMN reason TEXT`,
		`ALTER TABLE activity_log ADD COLUMN parent_id TEXT`,
		`ALTER TABLE activity_log ADD COLUMN prev_hash TEXT`,
		`ALTER TABLE runs ADD COLUMN source_type TEXT`,
		`ALTER TABLE runs ADD COLUMN source_id TEXT`,
	]) {
		try {
			rawSqlite.exec(stmt);
		} catch {
			/* duplicate column — already migrated */
		}
	}

	try {
		rawSqlite.exec(`ALTER TABLE companies ADD COLUMN logo_url TEXT DEFAULT ''`);
	} catch {}

	try {
		rawSqlite.exec(
			`UPDATE routines SET is_active = COALESCE(is_active, enabled, 1) WHERE is_active IS NULL`,
		);
	} catch {
		/* routines table may not exist on minimal installs */
	}
	try {
		rawSqlite.exec(
			`UPDATE routines SET last_triggered_at = COALESCE(last_triggered_at, last_run_at) WHERE last_triggered_at IS NULL`,
		);
	} catch {
		/* routines table may not exist on minimal installs */
	}

	// Agent credibility scores table (autonomous loop).
	rawSqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_scores (
      agent_slug   TEXT PRIMARY KEY,
      successes    INTEGER NOT NULL DEFAULT 0,
      failures     INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      approach TEXT,
      subtasks TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      feedback TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_plans_company_status ON plans(company_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plans_issue ON plans(issue_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT,
      company_id    TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'owner',
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      payload      TEXT NOT NULL,
      priority     INTEGER NOT NULL DEFAULT 3,
      created_at   INTEGER NOT NULL,
      available_at INTEGER NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      status       TEXT NOT NULL DEFAULT 'waiting',
      result       TEXT,
      error        TEXT,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_priority
      ON jobs(status, priority, available_at, created_at);
  `);

	// Tables that ship in the OSS @setra/db migration 0006 but may be missing
	// on installs that ran on the trimmed-down public migration set.
	rawSqlite.exec(`
    CREATE TABLE IF NOT EXISTS issue_comments (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      issue_id   TEXT NOT NULL,
      author     TEXT NOT NULL DEFAULT 'human',
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id);

    CREATE TABLE IF NOT EXISTS activity_log (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT,
      issue_id   TEXT,
      actor      TEXT NOT NULL,
      event      TEXT NOT NULL,
      payload    TEXT,
      reason     TEXT,
      parent_id  TEXT,
      prev_hash  TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_issue   ON activity_log(issue_id);

    CREATE TABLE IF NOT EXISTS issue_lifecycle_events (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      issue_id    TEXT NOT NULL,
      company_id  TEXT,
      from_stage  TEXT,
      to_stage    TEXT NOT NULL,
      actor_type  TEXT NOT NULL DEFAULT 'system',
      actor_id    TEXT,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_issue_lifecycle_issue
      ON issue_lifecycle_events(issue_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_issue_lifecycle_company
      ON issue_lifecycle_events(company_id);

    CREATE TABLE IF NOT EXISTS team_channels (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      company_id TEXT,
      project_id TEXT,
      slug       TEXT NOT NULL,
      name       TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_team_channels_company  ON team_channels(company_id);
    CREATE INDEX IF NOT EXISTS idx_team_channels_project  ON team_channels(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_team_channels_slug
      ON team_channels(company_id, slug);
  `);

	// Idempotent ADD COLUMN for team_channels — older DBs may pre-date the
	// project_id column. SQLite doesn't support IF NOT EXISTS on ADD COLUMN,
	// so swallow duplicate-column errors.
	try {
		rawSqlite.exec(
			`CREATE INDEX IF NOT EXISTS idx_board_issues_parent_issue ON board_issues(parent_issue_id)`,
		);
	} catch {
		/* board_issues may not exist on minimal installs */
	}
	try {
		rawSqlite.exec(
			`CREATE INDEX IF NOT EXISTS idx_board_issues_review_status ON board_issues(review_status, review_round)`,
		);
	} catch {
		/* board_issues may not exist on minimal installs */
	}

	for (const stmt of [
		`ALTER TABLE team_channels ADD COLUMN project_id TEXT`,
		`ALTER TABLE team_channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'general'`,
	]) {
		try {
			rawSqlite.exec(stmt);
		} catch {
			/* already migrated */
		}
	}

	// ── Agent Event Bus & Gossip Layer ──────────────────────────────────────────
	rawSqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_events (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL,
      event_type   TEXT NOT NULL,
      source_agent TEXT NOT NULL,
      target_agent TEXT,
      issue_id     TEXT,
      run_id       TEXT,
      payload      TEXT DEFAULT '{}',
      processed_by TEXT DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_company  ON agent_events(company_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_source   ON agent_events(source_agent);
    CREATE INDEX IF NOT EXISTS idx_agent_events_target   ON agent_events(target_agent);
    CREATE INDEX IF NOT EXISTS idx_agent_events_created  ON agent_events(created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_event_acks (
      event_id   TEXT NOT NULL,
      agent_slug TEXT NOT NULL,
      acked_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (event_id, agent_slug)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_event_acks_slug ON agent_event_acks(agent_slug);

    CREATE TABLE IF NOT EXISTS agent_insights (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL,
      source_agent TEXT NOT NULL,
      content      TEXT NOT NULL,
      context      TEXT NOT NULL DEFAULT '',
      tags         TEXT NOT NULL DEFAULT '[]',
      credibility  REAL NOT NULL DEFAULT 0.5,
      use_count    INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_insights_company ON agent_insights(company_id);
    CREATE INDEX IF NOT EXISTS idx_agent_insights_source  ON agent_insights(source_agent);
  `);

	// Backfill: assign NULL company_id rows to the first existing company so
	// legacy data doesn't leak across companies after the isolation refactor.
	const SCOPED_TABLES = [
		"goals",
		"board_projects",
		"board_issues",
		"agent_roster",
		"company_roster",
		"routines",
		"approvals",
		"workspaces",
		"skills",
		"artifacts",
		"wiki_entries",
		"review_items",
		"integrations",
		"team_messages",
		"inbox_alerts",
		"company_members",
		"company_invites",
		"adapter_configs",
		"plugins",
		"activity_log",
		"team_channels",
		"issue_lifecycle_events",
		"agent_events",
		"agent_insights",
	];
	try {
		const firstCompany = rawSqlite
			.prepare(`SELECT id FROM companies ORDER BY created_at ASC LIMIT 1`)
			.get() as { id: string } | undefined;
		if (firstCompany?.id) {
			for (const t of SCOPED_TABLES) {
				try {
					rawSqlite.exec(
						`UPDATE ${t} SET company_id = '${firstCompany.id}' WHERE company_id IS NULL`,
					);
				} catch {
					/* table may not exist on minimal installs */
				}
			}
		}
	} catch {
		/* companies table missing on a brand-new DB — nothing to backfill */
	}

	// Indexes on company_id — every scoped table is filtered by company_id on
	// virtually every query path. Without these the planner falls back to full
	// table scans as the dataset grows.
	for (const t of SCOPED_TABLES) {
		try {
			rawSqlite.exec(
				`CREATE INDEX IF NOT EXISTS idx_${t}_company ON ${t}(company_id)`,
			);
		} catch {
			/* table may not exist on minimal installs */
		}
	}

	// ── Roster merge backfill (#2) ───────────────────────────────────────────
	// company_roster is deprecated; agent_roster is now canonical for the org
	// tree. Backfill template_id and parent_agent_id from any existing
	// company_roster rows so legacy installs see their org structure preserved.
	// Match on display_name + company_id (the only stable bridge that exists
	// before this migration). Idempotent: only fills NULL columns.
	try {
		rawSqlite.exec(`
      UPDATE agent_roster
      SET template_id = (
        SELECT cr.template_id FROM company_roster cr
        WHERE cr.display_name = agent_roster.display_name
          AND coalesce(cr.company_id, '') = coalesce(agent_roster.company_id, '')
        LIMIT 1
      )
      WHERE template_id IS NULL;
    `);
		rawSqlite.exec(`
      UPDATE agent_roster
      SET parent_agent_id = (
        SELECT ar2.id
        FROM company_roster cr_self
        JOIN company_roster cr_parent ON cr_parent.id = cr_self.reports_to
        JOIN agent_roster ar2
          ON ar2.display_name = cr_parent.display_name
         AND coalesce(ar2.company_id, '') = coalesce(cr_parent.company_id, '')
        WHERE cr_self.display_name = agent_roster.display_name
          AND coalesce(cr_self.company_id, '') = coalesce(agent_roster.company_id, '')
          AND cr_self.reports_to IS NOT NULL
        LIMIT 1
      )
      WHERE parent_agent_id IS NULL;
    `);
	} catch {
		/* tables may not exist on minimal installs */
	}

	try {
		rawSqlite.exec(
			`CREATE INDEX IF NOT EXISTS idx_agent_roster_parent ON agent_roster(parent_agent_id)`,
		);
	} catch {
		/* ignore */
	}
}
