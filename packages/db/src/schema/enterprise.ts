/**
 * enterprise.ts — Setra enterprise-specific tables
 *
 * These tables extend the base schema with board management, skills,
 * wiki, artifacts, clone agent, review queue, and org management.
 * Added to the enterprise version (not OSS) as they require auth + billing context.
 */

import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const ts = {
	createdAt: text("created_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	updatedAt: text("updated_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
};
const uuidPk = () =>
	text("id").primaryKey().default(sql`(lower(hex(randomblob(16))))`);

// ─── Board Projects ───────────────────────────────────────────────────────────

export const boardProjects = sqliteTable(
	"board_projects",
	{
		id: uuidPk(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description"),
		repoProjectId: text("repo_project_id"), // foreign key to git projects table
		totalCostUsd: real("total_cost_usd").notNull().default(0),
		requirements: text("requirements").notNull().default(""),
		planStatus: text("plan_status").notNull().default("none"),
		settingsJson: text("settings_json").notNull().default("{}"),
		...ts,
	},
	(t) => ({
		slugIdx: uniqueIndex("idx_board_projects_slug").on(t.slug),
	}),
);

export const boardIssues = sqliteTable(
	"board_issues",
	{
		id: uuidPk(),
		projectId: text("project_id")
			.notNull()
			.references(() => boardProjects.id, { onDelete: "cascade" }),
		slug: text("slug").notNull(), // e.g. SET-42
		title: text("title").notNull(),
		description: text("description"),
		status: text("status", {
			enum: [
				"backlog",
				"todo",
				"in_progress",
				"in_review",
				"done",
				"cancelled",
			],
		})
			.notNull()
			.default("backlog"),
		priority: text("priority", {
			enum: ["none", "urgent", "high", "medium", "low"],
		})
			.notNull()
			.default("none"),
		parentIssueId: text("parent_issue_id").references(
			(): AnySQLiteColumn => boardIssues.id,
			{ onDelete: "set null" },
		),
		assignedAgentId: text("assigned_agent_id"),
		acceptanceCriteria: text("acceptance_criteria").notNull().default(""),
		testCommand: text("test_command").notNull().default(""),
		testStatus: text("test_status", {
			enum: ["none", "pending", "running", "passed", "failed"],
		})
			.notNull()
			.default("none"),
		estimatedCostUsd: real("estimated_cost_usd"),
		actualCostUsd: real("actual_cost_usd").notNull().default(0),
		...ts,
	},
	(t) => ({
		projectIdx: index("idx_board_issues_project").on(t.projectId),
		statusIdx: index("idx_board_issues_status").on(t.status),
		parentIssueIdx: index("idx_board_issues_parent_issue").on(t.parentIssueId),
		slugIdx: uniqueIndex("idx_board_issues_slug").on(t.slug),
	}),
);

export const boardBudgetLimits = sqliteTable("board_budget_limits", {
	id: uuidPk(),
	companyId: text("company_id").notNull().default("default"),
	projectId: text("project_id").references(() => boardProjects.id, {
		onDelete: "cascade",
	}),
	agentSlug: text("agent_slug"),
	limitUsd: real("limit_usd").notNull(),
	periodDays: integer("period_days").notNull().default(30),
	alertPercent: integer("alert_percent").notNull().default(80),
	...ts,
});

export const users = sqliteTable(
	"users",
	{
		id: uuidPk(),
		email: text("email").notNull(),
		passwordHash: text("password_hash").notNull(),
		name: text("name"),
		companyId: text("company_id").notNull(),
		role: text("role", { enum: ["owner", "admin", "member"] })
			.notNull()
			.default("owner"),
		...ts,
	},
	(t) => ({
		emailIdx: uniqueIndex("idx_users_email").on(t.email),
		companyIdx: index("idx_users_company_id").on(t.companyId),
	}),
);

// ─── Skills ───────────────────────────────────────────────────────────────────

export const skills = sqliteTable(
	"skills",
	{
		id: uuidPk(),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		description: text("description").notNull(),
		category: text("category", {
			enum: ["code", "web", "security", "data", "custom"],
		})
			.notNull()
			.default("custom"),
		trigger: text("trigger").notNull(), // comma-separated keywords
		prompt: text("prompt").notNull(), // injected into agent context when triggered
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		usageCount: integer("usage_count").notNull().default(0),
		lastUsedAt: text("last_used_at"),
		...ts,
	},
	(t) => ({
		slugIdx: uniqueIndex("idx_skills_slug").on(t.slug),
		activeIdx: index("idx_skills_active").on(t.isActive),
	}),
);

// ─── Wiki ─────────────────────────────────────────────────────────────────────

export const wikiEntries = sqliteTable(
	"wiki_entries",
	{
		id: uuidPk(),
		title: text("title").notNull(),
		slug: text("slug").notNull(),
		content: text("content").notNull().default(""),
		category: text("category").notNull().default("General"),
		tags: text("tags_json").notNull().default("[]"), // JSON string array
		authorSlug: text("author_slug").notNull().default("user"),
		...ts,
	},
	(t) => ({
		slugIdx: uniqueIndex("idx_wiki_slug").on(t.slug),
		categoryIdx: index("idx_wiki_category").on(t.category),
	}),
);

// ─── Artifacts ────────────────────────────────────────────────────────────────

export const artifacts = sqliteTable(
	"artifacts",
	{
		id: uuidPk(),
		name: text("name").notNull(),
		type: text("type", {
			enum: ["code", "document", "image", "archive", "data"],
		})
			.notNull()
			.default("data"),
		mimeType: text("mime_type").notNull().default("application/octet-stream"),
		sizeBytes: integer("size_bytes").notNull().default(0),
		issueId: text("issue_id"),
		issueSlug: text("issue_slug"),
		agentSlug: text("agent_slug").notNull(),
		description: text("description").notNull().default(""),
		content: text("content"), // null for binary; store small text artifacts inline
		storagePath: text("storage_path"), // path on disk for large files
		...ts,
	},
	(t) => ({
		issueIdx: index("idx_artifacts_issue").on(t.issueId),
		agentIdx: index("idx_artifacts_agent").on(t.agentSlug),
		typeIdx: index("idx_artifacts_type").on(t.type),
	}),
);

// ─── Review Queue ─────────────────────────────────────────────────────────────

export const reviewItems = sqliteTable(
	"review_items",
	{
		id: uuidPk(),
		companyId: text("company_id"),
		type: text("type", {
			enum: [
				"task_start",
				"pr_merge",
				"agent_hire",
				"budget_override",
				"approval",
				"code_review",
				"security_sign_off",
			],
		}),
		entityType: text("entity_type"),
		entityId: text("entity_id"),
		title: text("title").notNull(),
		description: text("description").notNull(),
		requestedBy: text("requested_by").notNull(), // agent slug
		targetIssueSlug: text("target_issue_slug"),
		estimatedCostUsd: real("estimated_cost_usd"),
		diff: text("diff"),
		riskLevel: text("risk_level", {
			enum: ["low", "medium", "high"],
		})
			.notNull()
			.default("medium"),
		status: text("status", {
			enum: ["pending", "approved", "rejected"],
		})
			.notNull()
			.default("pending"),
		comment: text("comment"),
		resolvedAt: text("resolved_at"),
		...ts,
	},
	(t) => ({
		statusIdx: index("idx_review_status").on(t.status),
		typeIdx: index("idx_review_type").on(t.type),
	}),
);

// ─── Organization / Team ─────────────────────────────────────────────────────

export const orgMembers = sqliteTable(
	"org_members",
	{
		id: uuidPk(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		role: text("role", {
			enum: ["owner", "admin", "member", "viewer"],
		})
			.notNull()
			.default("member"),
		joinedAt: text("joined_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
		...ts,
	},
	(t) => ({
		emailIdx: uniqueIndex("idx_org_members_email").on(t.email),
	}),
);

// ─── Clone Agent ──────────────────────────────────────────────────────────────

export const cloneProfile = sqliteTable("clone_profile", {
	id: uuidPk(),
	companyId: text("company_id").notNull().default("default"),
	name: text("name").notNull().default("My Clone"),
	mode: text("mode", { enum: ["training", "locked"] })
		.notNull()
		.default("training"),
	model: text("model_json"),
	brief: text("brief"),
	trainedAt: text("trained_at"),
	lockedAt: text("locked_at"),
	...ts,
});

export const cloneObservations = sqliteTable(
	"clone_observations",
	{
		id: uuidPk(),
		companyId: text("company_id").notNull().default("default"),
		cloneId: text("clone_id")
			.notNull()
			.references(() => cloneProfile.id, { onDelete: "cascade" }),
		source: text("source", {
			enum: [
				"issue_title",
				"issue_description",
				"comment",
				"chat_message",
				"task_description",
				"agent_feedback",
				"qa_answer",
				"vision_note",
			],
		}).notNull(),
		content: text("content").notNull(),
		embedding: text("embedding_json"),
		weight: real("weight").notNull().default(1.0),
		processed: integer("processed", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(t) => ({
		cloneIdx: index("idx_ent_obs_clone").on(t.cloneId),
		processedIdx: index("idx_ent_obs_processed").on(t.processed),
	}),
);

export const cloneQaSessions = sqliteTable("clone_qa_sessions", {
	id: uuidPk(),
	cloneId: text("clone_id")
		.notNull()
		.references(() => cloneProfile.id, { onDelete: "cascade" }),
	question: text("question").notNull(),
	aspect: text("aspect").notNull(),
	answer: text("answer"),
	answeredAt: text("answered_at"),
	createdAt: text("created_at")
		.notNull()
		.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
