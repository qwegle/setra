/**
 * issues.repo.ts — Repository for board_issues (issue management)
 */

import {
	getRawDb,
	boardIssues as issues,
	boardProjects as projects,
} from "@setra/db";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IssueRow {
	id: string;
	projectId: string;
	slug: string;
	title: string;
	status: string;
	branchName: string | null;
	prUrl: string | null;
	prState: string | null;
	commitShas: string | null;
	workspacePath: string | null;
	defaultBranch: string | null;
	repoUrl: string | null;
	lifecycleStage: string | null;
	companyId: string | null;
	parentIssueId: string | null;
	reviewStatus?: string | null;
	reviewRound?: number;
}

// ─── Issue CRUD ───────────────────────────────────────────────────────────────

export async function getProjectSlug(
	projectId: string,
): Promise<{ slug: string } | undefined> {
	const [row] = await db
		.select({ slug: projects.slug })
		.from(projects)
		.where(eq(projects.id, projectId));
	return row;
}

export async function getIssueCountForProject(
	projectId: string,
): Promise<number> {
	const countRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(issues)
		.where(eq(issues.projectId, projectId));
	return countRows[0]?.count ?? 0;
}

export async function createIssue(params: {
	projectId: string;
	slug: string;
	title: string;
	description: string | null;
	status: string;
	priority: string;
	parentIssueId?: string | null;
}) {
	const [row] = await db
		.insert(issues)
		.values({
			projectId: params.projectId,
			slug: params.slug,
			title: params.title,
			description: params.description,
			parentIssueId: params.parentIssueId ?? null,
			status: params.status as
				| "backlog"
				| "todo"
				| "in_progress"
				| "in_review"
				| "done"
				| "cancelled",
			priority: params.priority as
				| "none"
				| "urgent"
				| "high"
				| "medium"
				| "low",
		})
		.returning();
	return row;
}

export function getIssueById(id: string, companyId: string) {
	return getRawDb()
		.prepare(`
      SELECT
        id, project_id AS projectId, slug, title, description,
        status, priority, assigned_agent_id AS assignedAgentId,
        due_date AS dueDate,
        linked_plot_id AS linkedPlotId,
        estimated_cost_usd AS estimatedCostUsd, actual_cost_usd AS actualCostUsd,
        completed_at AS completedAt, created_at AS createdAt, updated_at AS updatedAt,
        labels, tags,
        branch_name AS branchName, pr_url AS prUrl, pr_state AS prState,
        commit_shas AS commitShas,
        COALESCE(lifecycle_stage, 'backlog') AS lifecycleStage,
        parent_issue_id AS parentIssueId,
        acceptance_criteria AS acceptanceCriteria,
        test_command AS testCommand,
        test_status AS testStatus,
        review_status AS reviewStatus,
        COALESCE(review_round, 0) AS reviewRound,
        (SELECT count(*) FROM board_issues child WHERE child.parent_issue_id = board_issues.id AND child.company_id = board_issues.company_id) AS subIssueCount,
        company_id AS companyId
      FROM board_issues WHERE id = ? AND company_id = ?
    `)
		.get(id, companyId) as Record<string, unknown> | undefined;
}

export function getIssueStatus(
	id: string,
	companyId: string,
): { status: string } | undefined {
	return getRawDb()
		.prepare("SELECT status FROM board_issues WHERE id = ? AND company_id = ?")
		.get(id, companyId) as { status: string } | undefined;
}

export function getSubIssues(
	issueId: string,
	companyId: string,
): Record<string, unknown>[] {
	return getRawDb()
		.prepare(`
      SELECT
        id, project_id AS projectId, slug, title, description,
        status, priority, assigned_agent_id AS assignedAgentId,
        due_date AS dueDate,
        linked_plot_id AS linkedPlotId,
        estimated_cost_usd AS estimatedCostUsd, actual_cost_usd AS actualCostUsd,
        completed_at AS completedAt, created_at AS createdAt, updated_at AS updatedAt,
        labels, tags,
        branch_name AS branchName, pr_url AS prUrl, pr_state AS prState,
        commit_shas AS commitShas,
        COALESCE(lifecycle_stage, 'backlog') AS lifecycleStage,
        parent_issue_id AS parentIssueId,
        acceptance_criteria AS acceptanceCriteria,
        test_command AS testCommand,
        test_status AS testStatus,
        review_status AS reviewStatus,
        COALESCE(review_round, 0) AS reviewRound,
        (SELECT count(*) FROM board_issues child WHERE child.parent_issue_id = board_issues.id AND child.company_id = board_issues.company_id) AS subIssueCount,
        company_id AS companyId
      FROM board_issues
      WHERE parent_issue_id = ? AND company_id = ?
      ORDER BY created_at ASC
    `)
		.all(issueId, companyId) as Record<string, unknown>[];
}

export function completeParentIssueIfDone(
	parentIssueId: string,
	companyId: string,
): { id: string; projectId: string } | undefined {
	const now = new Date().toISOString();
	return getRawDb()
		.prepare(`
      UPDATE board_issues
         SET status = 'done', completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE id = ?
         AND company_id = ?
         AND status != 'done'
         AND EXISTS (
           SELECT 1
             FROM board_issues child
            WHERE child.parent_issue_id = board_issues.id
              AND child.company_id = board_issues.company_id
         )
         AND NOT EXISTS (
           SELECT 1
             FROM board_issues child
            WHERE child.parent_issue_id = board_issues.id
              AND child.company_id = board_issues.company_id
              AND child.status != 'done'
         )
       RETURNING id, project_id AS projectId
    `)
		.get(now, now, parentIssueId, companyId) as
		| { id: string; projectId: string }
		| undefined;
}

export async function updateIssueDrizzleFields(
	id: string,
	companyId: string,
	updates: Record<string, unknown>,
) {
	// company_id is added via migration, not in Drizzle schema, so use raw SQL
	const setClauses: string[] = ["updated_at = ?"];
	const values: unknown[] = [new Date().toISOString()];
	for (const [key, value] of Object.entries(updates)) {
		// Convert camelCase keys to snake_case
		const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
		setClauses.push(`${snakeKey} = ?`);
		values.push(value);
	}
	values.push(id, companyId);
	const row = getRawDb()
		.prepare(
			`UPDATE board_issues SET ${setClauses.join(", ")} WHERE id = ? AND company_id = ? RETURNING *`,
		)
		.get(...values);
	return row;
}

// Whitelist of allowed columns for raw field updates to prevent SQL injection
const ALLOWED_RAW_FIELDS = new Set([
	"labels",
	"tags",
	"branch_name",
	"commit_shas",
	"pr_url",
	"pr_state",
]);

export function updateIssueRawField(
	id: string,
	companyId: string,
	field: string,
	value: unknown,
): void {
	if (!ALLOWED_RAW_FIELDS.has(field)) {
		throw new Error(`disallowed field: ${field}`);
	}
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE board_issues SET ${field} = ?, updated_at = ? WHERE id = ? AND company_id = ?`,
		)
		.run(value, now, id, companyId);
}

export function deleteIssue(
	id: string,
	companyId: string,
): { id: string; projectId: string } | undefined {
	// company_id is added via migration, not in Drizzle schema, so use raw SQL
	const row = getRawDb()
		.prepare(
			"DELETE FROM board_issues WHERE id = ? AND company_id = ? RETURNING id, project_id AS projectId",
		)
		.get(id, companyId) as { id: string; projectId: string } | undefined;
	return row;
}

// ─── Issue with project join ──────────────────────────────────────────────────

export function loadIssueWithProject(
	issueId: string,
	companyId: string,
): IssueRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT
            i.id           AS id,
            i.project_id   AS projectId,
            i.slug         AS slug,
            i.title        AS title,
            i.status       AS status,
            i.branch_name  AS branchName,
            i.pr_url       AS prUrl,
            i.pr_state     AS prState,
            i.commit_shas  AS commitShas,
            i.lifecycle_stage AS lifecycleStage,
            i.company_id   AS companyId,
            i.parent_issue_id AS parentIssueId,
            i.review_status AS reviewStatus,
            COALESCE(i.review_round, 0) AS reviewRound,
            p.workspace_path  AS workspacePath,
            p.default_branch  AS defaultBranch,
            p.repo_url        AS repoUrl
           FROM board_issues i
           LEFT JOIN board_projects p ON p.id = i.project_id
          WHERE i.id = ? AND i.company_id = ?`,
			)
			.get(issueId, companyId) as IssueRow | undefined) ?? null
	);
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export function getComments(issueId: string, companyId: string): unknown[] {
	return getRawDb()
		.prepare(`
      SELECT c.* FROM issue_comments c
        JOIN board_issues i ON i.id = c.issue_id
       WHERE c.issue_id = ? AND i.company_id = ?
       ORDER BY c.created_at ASC`)
		.all(issueId, companyId);
}

export function addComment(
	issueId: string,
	companyId: string,
	body: string,
	author: string,
): unknown {
	// Verify issue belongs to company before inserting
	const issue = getRawDb()
		.prepare("SELECT id FROM board_issues WHERE id = ? AND company_id = ?")
		.get(issueId, companyId);
	if (!issue) return null;

	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			"INSERT INTO issue_comments (id, issue_id, author, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
		.run(id, issueId, author, body, now, now);
	return getRawDb()
		.prepare("SELECT * FROM issue_comments WHERE id = ?")
		.get(id);
}

export function deleteComment(
	issueId: string,
	companyId: string,
	commentId: string,
): void {
	getRawDb()
		.prepare(`
      DELETE FROM issue_comments
       WHERE id = ? AND issue_id = ?
         AND issue_id IN (SELECT id FROM board_issues WHERE company_id = ?)`)
		.run(commentId, issueId, companyId);
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export function getActivity(issueId: string, companyId: string): unknown[] {
	return getRawDb()
		.prepare(`
      SELECT a.* FROM activity_log a
        JOIN board_issues i ON i.id = a.issue_id
       WHERE a.issue_id = ? AND i.company_id = ?
       ORDER BY a.created_at ASC`)
		.all(issueId, companyId);
}

export function addActivityLog(
	issueId: string,
	companyId: string,
	actor: string,
	event: string,
	payload?: string,
): void {
	const now = new Date().toISOString();
	if (payload) {
		getRawDb()
			.prepare(
				"INSERT INTO activity_log (id, issue_id, company_id, actor, event, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(crypto.randomUUID(), issueId, companyId, actor, event, payload, now);
	} else {
		getRawDb()
			.prepare(
				"INSERT INTO activity_log (id, issue_id, company_id, actor, event, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(crypto.randomUUID(), issueId, companyId, actor, event, now);
	}
}

// ─── Lifecycle Events ─────────────────────────────────────────────────────────

export function getLifecycleEvents(
	issueId: string,
	companyId: string,
): unknown[] {
	return getRawDb()
		.prepare(
			`SELECT e.id, e.from_stage AS fromStage, e.to_stage AS toStage,
              e.actor_type AS actorType, e.actor_id AS actorId,
              e.occurred_at AS occurredAt
         FROM issue_lifecycle_events e
         JOIN board_issues i ON i.id = e.issue_id
        WHERE e.issue_id = ? AND i.company_id = ?
        ORDER BY e.occurred_at ASC`,
		)
		.all(issueId, companyId);
}

// ─── Git plumbing updates ─────────────────────────────────────────────────────

export function updateBranchName(
	issueId: string,
	companyId: string,
	branchName: string,
): void {
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE board_issues SET branch_name = ?, updated_at = ? WHERE id = ? AND company_id = ?`,
		)
		.run(branchName, now, issueId, companyId);
}

export function updateCommitShas(
	issueId: string,
	companyId: string,
	commitShasJson: string,
): void {
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE board_issues SET commit_shas = ?, updated_at = ? WHERE id = ? AND company_id = ?`,
		)
		.run(commitShasJson, now, issueId, companyId);
}

export function updatePrOpened(
	issueId: string,
	companyId: string,
	prUrl: string,
): void {
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE board_issues
          SET pr_url = ?, pr_state = 'open', status = 'in_review', updated_at = ?
        WHERE id = ? AND company_id = ?`,
		)
		.run(prUrl, now, issueId, companyId);
}

export function updatePrMerged(issueId: string, companyId: string): void {
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE board_issues
          SET pr_state = 'merged', status = 'done', completed_at = ?, updated_at = ?
        WHERE id = ? AND company_id = ?`,
		)
		.run(now, now, issueId, companyId);
}

export function updateIssueGitLinks(
	issueId: string,
	companyId: string,
	fields: {
		prUrl: string | null;
		prState: "open" | "merged" | "closed" | null;
		commitShas: string | null;
	},
): void {
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE board_issues
         SET pr_url = ?, pr_state = ?, commit_shas = ?, updated_at = ?
       WHERE id = ? AND company_id = ?`,
		)
		.run(
			fields.prUrl,
			fields.prState,
			fields.commitShas,
			now,
			issueId,
			companyId,
		);
}
