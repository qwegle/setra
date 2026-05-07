/**
 * projects.repo.ts — Repository for board_projects (project management)
 */

import { getRawDb, boardProjects as projects } from "@setra/db";
import { db, rawSqlite } from "../db/client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectRow {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	createdAt: string;
	workspacePath: string | null;
	companyId: string | null;
	repoUrl: string | null;
	repoPath: string | null;
	defaultBranch: string | null;
	gitInitialized: number | null;
	color: string | null;
	requirements: string | null;
	planStatus: string | null;
	settingsJson: string | null;
	issueCount?: number;
	activeAgentCount?: number;
	totalCostUsd: number | null;
}

export interface ProjectBasic {
	id: string;
	name: string;
	companyId: string | null;
}

export interface SdlcStageCount {
	stage: string;
	c: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

function listProjectsWhere(where = "", params: unknown[] = []): ProjectRow[] {
	const sql = `SELECT
          id,
          name,
          slug,
          description,
          created_at AS createdAt,
          workspace_path AS workspacePath,
          company_id AS companyId,
          repo_url AS repoUrl,
          repo_path AS repoPath,
          default_branch AS defaultBranch,
          git_initialized AS gitInitialized,
          color,
          requirements,
          COALESCE(plan_status, 'none') AS planStatus,
          settings_json AS settingsJson,
          (SELECT count(*) FROM board_issues WHERE project_id = board_projects.id) AS issueCount,
          (SELECT count(distinct r.agent)
             FROM runs r
             JOIN board_issues i ON i.linked_plot_id = r.plot_id
            WHERE i.project_id = board_projects.id
              AND r.status IN ('running','pending')
              AND replace(r.updated_at,'T',' ') >= datetime('now','-1 hour')) AS activeAgentCount,
          total_cost_usd AS totalCostUsd
         FROM board_projects
         ${where}
        ORDER BY created_at`;
	return rawSqlite.prepare(sql).all(...params) as ProjectRow[];
}

export function listProjectsByCompany(companyId: string): ProjectRow[] {
	return listProjectsWhere("WHERE company_id = ?", [companyId]);
}

export async function listProjectsGlobal() {
	return listProjectsWhere();
}

export async function insertProject(params: {
	id: string;
	name: string;
	slug: string;
	description: string | null;
}) {
	const [row] = await db
		.insert(projects)
		.values({
			id: params.id,
			name: params.name,
			slug: params.slug,
			description: params.description,
		})
		.returning();
	return row;
}

export function updateProjectMeta(params: {
	id: string;
	companyId: string | null | undefined;
	workspacePath: string | null;
	repoUrl: string | null;
	defaultBranch: string;
	gitInitialized: number;
	color: string;
}): void {
	try {
		rawSqlite
			.prepare(
				`UPDATE board_projects
            SET company_id = ?, workspace_path = ?,
                repo_url = ?, repo_path = ?,
                default_branch = ?, git_initialized = ?,
                color = ?
          WHERE id = ?`,
			)
			.run(
				params.companyId,
				params.workspacePath,
				params.repoUrl,
				params.workspacePath,
				params.defaultBranch,
				params.gitInitialized,
				params.color,
				params.id,
			);
	} catch {
		// Older DBs may be missing some columns; degrade gracefully.
		try {
			rawSqlite
				.prepare(`UPDATE board_projects SET company_id = ? WHERE id = ?`)
				.run(params.companyId, params.id);
		} catch {
			/* ignore */
		}
	}
}

export function getProjectBasic(id: string): ProjectBasic | undefined {
	return rawSqlite
		.prepare(
			`SELECT id, name, company_id AS companyId FROM board_projects WHERE id = ?`,
		)
		.get(id) as ProjectBasic | undefined;
}

export function updateProjectFields(
	id: string,
	updates: Record<string, unknown>,
): void {
	const sets: string[] = [];
	const params: unknown[] = [];
	if (updates.name !== undefined) {
		sets.push("name = ?");
		params.push(updates.name);
	}
	if (updates.description !== undefined) {
		sets.push("description = ?");
		params.push(updates.description);
	}
	if (updates.color !== undefined) {
		sets.push("color = ?");
		params.push(updates.color);
	}
	if (updates.requirements !== undefined) {
		sets.push("requirements = ?");
		params.push(updates.requirements);
	}
	if (updates.planStatus !== undefined) {
		sets.push("plan_status = ?");
		params.push(updates.planStatus);
	}
	if (updates.settingsJson !== undefined) {
		sets.push("settings_json = ?");
		params.push(updates.settingsJson);
	}
	if (updates.workspacePath !== undefined) {
		sets.push("workspace_path = ?");
		params.push(updates.workspacePath);
	}
	if (updates.repoPath !== undefined) {
		sets.push("repo_path = ?");
		params.push(updates.repoPath);
	}
	if (updates.repoUrl !== undefined) {
		sets.push("repo_url = ?");
		params.push(updates.repoUrl);
	}
	if (updates.defaultBranch !== undefined) {
		sets.push("default_branch = ?");
		params.push(updates.defaultBranch);
	}
	if (updates.gitInitialized !== undefined) {
		sets.push("git_initialized = ?");
		params.push(updates.gitInitialized);
	}
	if (sets.length === 0) return;
	sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
	params.push(id);
	rawSqlite
		.prepare(`UPDATE board_projects SET ${sets.join(", ")} WHERE id = ?`)
		.run(...params);
}

export function getProjectFull(id: string): ProjectRow | undefined {
	return rawSqlite
		.prepare(
			`SELECT
          id, name, slug, description, created_at AS createdAt,
          workspace_path AS workspacePath, company_id AS companyId,
          repo_url AS repoUrl, repo_path AS repoPath,
          default_branch AS defaultBranch,
          git_initialized AS gitInitialized,
          color,
          requirements,
          COALESCE(plan_status, 'none') AS planStatus,
          settings_json AS settingsJson,
          total_cost_usd AS totalCostUsd
        FROM board_projects WHERE id = ?`,
		)
		.get(id) as ProjectRow | undefined;
}

export function getProjectIssues(
	projectId: string,
	companyId: string,
): unknown[] {
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
        (SELECT count(*) FROM board_issues child WHERE child.parent_issue_id = board_issues.id AND child.company_id = board_issues.company_id) AS subIssueCount
      FROM board_issues
      WHERE project_id = ?
        AND company_id = ?
      ORDER BY created_at ASC
    `)
		.all(projectId, companyId);
}

// ─── SDLC Stats ───────────────────────────────────────────────────────────────

export function getLifecycleStageCounts(projectId: string): SdlcStageCount[] {
	return rawSqlite
		.prepare(
			`SELECT COALESCE(lifecycle_stage,'backlog') AS stage, COUNT(*) AS c
         FROM board_issues
        WHERE project_id = ?
        GROUP BY 1`,
		)
		.all(projectId) as SdlcStageCount[];
}

export function getCycleTimeData(
	projectId: string,
): Array<{ started: string | null; finished: string | null }> {
	return rawSqlite
		.prepare(
			`SELECT
          (SELECT MIN(occurred_at) FROM issue_lifecycle_events e1
            WHERE e1.issue_id = i.id AND e1.to_stage = 'branched') AS started,
          (SELECT MAX(occurred_at) FROM issue_lifecycle_events e2
            WHERE e2.issue_id = i.id AND e2.to_stage = 'merged')   AS finished
        FROM board_issues i
        WHERE i.project_id = ?
          AND COALESCE(i.lifecycle_stage,'backlog') IN ('merged','deployed','verified')
        ORDER BY i.updated_at DESC
        LIMIT 25`,
		)
		.all(projectId) as Array<{
		started: string | null;
		finished: string | null;
	}>;
}

export function getActivityLast24h(projectId: string): number {
	const activity = rawSqlite
		.prepare(
			`SELECT COUNT(*) AS c
         FROM issue_lifecycle_events e
         JOIN board_issues i ON i.id = e.issue_id
        WHERE i.project_id = ?
          AND e.occurred_at >= datetime('now','-1 day')`,
		)
		.get(projectId) as { c: number } | undefined;
	return activity?.c ?? 0;
}

export function getActivitySparkline(projectId: string): number[] {
	const buckets = rawSqlite
		.prepare(
			`SELECT CAST((julianday('now') - julianday(e.occurred_at)) * 24 AS INTEGER) AS hAgo,
              COUNT(*) AS c
         FROM issue_lifecycle_events e
         JOIN board_issues i ON i.id = e.issue_id
        WHERE i.project_id = ?
          AND e.occurred_at >= datetime('now','-1 day')
        GROUP BY hAgo`,
		)
		.all(projectId) as Array<{ hAgo: number; c: number }>;
	return Array.from({ length: 24 }, (_, k) => {
		const idx = 23 - k; // oldest first
		return buckets.find((b) => b.hAgo === idx)?.c ?? 0;
	});
}
