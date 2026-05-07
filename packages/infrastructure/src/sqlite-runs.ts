import type { RunServiceRepository, ScopedRunRecord } from "@setra/application";
import { getRawDb } from "@setra/db";
import type { TenantScope } from "@setra/domain";

export class SqliteRunsRepository implements RunServiceRepository {
	async getRun(
		scope: TenantScope,
		runId: string,
	): Promise<ScopedRunRecord | null> {
		const row = getRawDb()
			.prepare(`
      SELECT
        r.id,
        r.agent AS agentId,
        r.status,
        COALESCE(a.company_id, i.company_id) AS companyId
      FROM runs r
      LEFT JOIN agent_roster a
        ON a.slug = r.agent AND a.company_id = ?
      LEFT JOIN board_issues i
        ON i.linked_plot_id = r.plot_id AND i.company_id = ?
      WHERE r.id = ?
        AND (a.company_id = ? OR i.company_id = ?)
      LIMIT 1
    `)
			.get(
				scope.companyId,
				scope.companyId,
				runId,
				scope.companyId,
				scope.companyId,
			) as
			| {
					id: string;
					agentId: string;
					status: ScopedRunRecord["status"];
					companyId: string | null;
			  }
			| undefined;
		return row ?? null;
	}

	async updateHeartbeat(
		_scope: TenantScope,
		runId: string,
		updatedAt: string,
	): Promise<void> {
		getRawDb()
			.prepare(`UPDATE runs SET updated_at = ? WHERE id = ?`)
			.run(updatedAt, runId);
	}

	async updateRunStatus(
		scope: TenantScope,
		runId: string,
		updates: Record<string, unknown>,
	): Promise<void> {
		const sets: string[] = [];
		const values: unknown[] = [];
		for (const [key, value] of Object.entries(updates)) {
			sets.push(`${key} = ?`);
			values.push(value);
		}
		if (sets.length === 0) return;
		values.push(runId);
		const db = getRawDb();
		db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(
			...values,
		);

		const nextStatus =
			typeof updates["status"] === "string" ? updates["status"] : null;
		if (!nextStatus) return;

		if (nextStatus === "pending" || nextStatus === "running") {
			db.prepare(`
        UPDATE agent_roster
           SET status = 'running',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE slug = (SELECT agent FROM runs WHERE id = ?)
           AND company_id = ?
           AND status IN ('idle', 'running')
      `).run(runId, scope.companyId);
			return;
		}

		if (!["completed", "failed", "cancelled"].includes(nextStatus)) return;
		db.prepare(`
      UPDATE agent_roster
         SET last_run_ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE slug = (SELECT agent FROM runs WHERE id = ?)
         AND company_id = ?
    `).run(runId, scope.companyId);
		const active = db
			.prepare(`
      SELECT COUNT(*) AS c
        FROM runs r
        LEFT JOIN agent_roster a ON a.slug = r.agent
        LEFT JOIN board_issues i ON i.linked_plot_id = r.plot_id
       WHERE r.agent = (SELECT agent FROM runs WHERE id = ?)
         AND r.id != ?
         AND r.status IN ('pending', 'running')
         AND (a.company_id = ? OR i.company_id = ?)
    `)
			.get(runId, runId, scope.companyId, scope.companyId) as
			| { c: number }
			| undefined;
		if ((active?.c ?? 0) > 0) return;

		db.prepare(`
      UPDATE agent_roster
         SET status = 'idle',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE slug = (SELECT agent FROM runs WHERE id = ?)
         AND company_id = ?
         AND status = 'running'
    `).run(runId, scope.companyId);
	}

	async getIssueWorkspace(
		scope: TenantScope,
		issueId: string,
	): Promise<{ projectId: string; workspacePath: string | null } | null> {
		const row = getRawDb()
			.prepare(`
      SELECT bp.id AS projectId, bp.workspace_path AS workspacePath
      FROM board_issues bi
      JOIN board_projects bp ON bp.id = bi.project_id
      WHERE bi.id = ? AND bi.company_id = ?
      LIMIT 1
    `)
			.get(issueId, scope.companyId) as
			| { projectId: string; workspacePath: string | null }
			| undefined;
		return row ?? null;
	}

	async ensureBoardProject(projectId: string, now: string): Promise<void> {
		getRawDb()
			.prepare(`
      INSERT OR IGNORE INTO projects (id, name, repo_path, created_at, updated_at)
      VALUES (?, 'Board Dispatch', '__board__', ?, ?)
    `)
			.run(projectId, now, now);
	}

	async ensureBoardPlot(input: {
		plotId: string;
		projectId: string;
		agentSlug: string;
		worktreePath: string | null;
		now: string;
	}): Promise<void> {
		getRawDb()
			.prepare(`
      INSERT OR IGNORE INTO plots
        (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'main', ?, ?, ?)
    `)
			.run(
				input.plotId,
				input.projectId,
				`Board — ${input.agentSlug}`,
				`board/${input.agentSlug}`,
				input.worktreePath,
				input.now,
				input.now,
			);
	}

	async updatePlotWorktree(
		plotId: string,
		worktreePath: string,
		now: string,
	): Promise<void> {
		getRawDb()
			.prepare(`
      UPDATE plots
         SET worktree_path = ?, updated_at = ?
       WHERE id = ? AND (worktree_path IS NULL OR worktree_path != ?)
    `)
			.run(worktreePath, now, plotId, worktreePath);
	}

	async createRun(input: {
		runId: string;
		plotId: string;
		agentSlug: string;
		model: string | null;
		agentArgs: string | null;
		now: string;
	}): Promise<void> {
		getRawDb()
			.prepare(`
      INSERT INTO runs
        (id, plot_id, agent, agent_version, agent_args, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `)
			.run(
				input.runId,
				input.plotId,
				input.agentSlug,
				input.model,
				input.agentArgs,
				input.now,
				input.now,
			);
	}

	async createTaskChunk(
		runId: string,
		task: string,
		now: string,
	): Promise<void> {
		getRawDb()
			.prepare(`
      INSERT INTO chunks (run_id, sequence, content, chunk_type, recorded_at)
      VALUES (?, 0, ?, 'input', ?)
    `)
			.run(runId, task, now);
	}

	async getRunFull(runId: string): Promise<unknown> {
		return getRawDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
	}
}
