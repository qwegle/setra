import type { IssueServiceRepository } from "@setra/application";
import { getRawDb } from "@setra/db";
import type {
	IssueLifecycleActor,
	IssueLifecycleStage,
	IssuePriority,
	IssueStatus,
	TenantScope,
} from "@setra/domain";

const ISSUE_FIELD_MAP: Record<string, string> = {
	title: "title",
	description: "description",
	status: "status",
	priority: "priority",
	assignedAgentId: "assigned_agent_id",
	dueDate: "due_date",
	acceptanceCriteria: "acceptance_criteria",
	testCommand: "test_command",
	testStatus: "test_status",
};

export class SqliteIssuesRepository implements IssueServiceRepository {
	async getScopedProject(
		scope: TenantScope,
		projectId: string,
	): Promise<{ id: string; slug: string } | null> {
		const row = getRawDb()
			.prepare(`
      SELECT id, slug
        FROM board_projects
       WHERE id = ? AND company_id = ?
       LIMIT 1
    `)
			.get(projectId, scope.companyId) as
			| { id: string; slug: string }
			| undefined;
		return row ?? null;
	}

	async getScopedParentIssue(
		scope: TenantScope,
		issueId: string,
	): Promise<{ id: string; projectId: string } | null> {
		const row = getRawDb()
			.prepare(`
      SELECT id, project_id AS projectId
        FROM board_issues
       WHERE id = ? AND company_id = ?
       LIMIT 1
    `)
			.get(issueId, scope.companyId) as
			| { id: string; projectId: string }
			| undefined;
		return row ?? null;
	}

	async countIssuesForProject(
		scope: TenantScope,
		projectId: string,
	): Promise<number> {
		const row = getRawDb()
			.prepare(`
      SELECT count(*) AS count
        FROM board_issues
       WHERE project_id = ? AND company_id = ?
    `)
			.get(projectId, scope.companyId) as { count: number } | undefined;
		return row?.count ?? 0;
	}

	async createIssue(
		scope: TenantScope,
		input: {
			projectId: string;
			slug: string;
			title: string;
			description: string | null;
			status: IssueStatus;
			priority: IssuePriority;
			lifecycleStage: IssueLifecycleStage;
			parentIssueId: string | null;
			acceptanceCriteria: string;
			testCommand: string;
			testStatus: "none" | "pending" | "running" | "passed" | "failed";
		},
	) {
		const row = getRawDb()
			.prepare(`
      INSERT INTO board_issues (
        project_id, company_id, slug, title, description, status, priority, lifecycle_stage, parent_issue_id,
        acceptance_criteria, test_command, test_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING
        id,
        project_id AS projectId,
        company_id AS companyId,
        slug,
        title,
        description,
        status,
        priority,
        COALESCE(lifecycle_stage, 'backlog') AS lifecycleStage,
        parent_issue_id AS parentIssueId,
        acceptance_criteria AS acceptanceCriteria,
        test_command AS testCommand,
        test_status AS testStatus,
        0 AS subIssueCount
    `)
			.get(
				input.projectId,
				scope.companyId,
				input.slug,
				input.title,
				input.description,
				input.status,
				input.priority,
				input.lifecycleStage,
				input.parentIssueId,
				input.acceptanceCriteria,
				input.testCommand,
				input.testStatus,
			) as
			| {
					id: string;
					projectId: string;
					companyId: string | null;
					slug: string;
					title: string;
					description: string | null;
					status: IssueStatus;
					priority: IssuePriority;
					lifecycleStage: IssueLifecycleStage;
					parentIssueId: string | null;
					acceptanceCriteria: string;
					testCommand: string;
					testStatus: "none" | "pending" | "running" | "passed" | "failed";
					subIssueCount: number;
			  }
			| undefined;
		return row ?? null;
	}

	async getIssueById(
		scope: TenantScope,
		issueId: string,
	): Promise<Record<string, unknown> | null> {
		const row = getRawDb()
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
      WHERE id = ? AND company_id = ?
      LIMIT 1
    `)
			.get(issueId, scope.companyId) as Record<string, unknown> | undefined;
		return row ?? null;
	}

	async getIssueStatus(
		scope: TenantScope,
		issueId: string,
	): Promise<{ status: string } | null> {
		const row = getRawDb()
			.prepare(`
      SELECT status
      FROM board_issues
      WHERE id = ? AND company_id = ?
      LIMIT 1
    `)
			.get(issueId, scope.companyId) as { status: string } | undefined;
		return row ?? null;
	}

	async updateIssueFields(
		scope: TenantScope,
		issueId: string,
		updates: Record<string, unknown>,
	): Promise<void> {
		const sets: string[] = ["updated_at = ?"];
		const values: unknown[] = [new Date().toISOString()];
		for (const [key, value] of Object.entries(updates)) {
			const column = ISSUE_FIELD_MAP[key];
			if (!column) continue;
			sets.push(`${column} = ?`);
			values.push(value);
		}
		values.push(issueId, scope.companyId);
		getRawDb()
			.prepare(`
      UPDATE board_issues
         SET ${sets.join(", ")}
       WHERE id = ? AND company_id = ?
    `)
			.run(...values);
	}

	async updateIssueRawField(
		scope: TenantScope,
		issueId: string,
		field: "labels" | "tags",
		value: unknown,
	): Promise<void> {
		getRawDb()
			.prepare(`
      UPDATE board_issues
         SET ${field} = ?, updated_at = ?
       WHERE id = ? AND company_id = ?
    `)
			.run(value, new Date().toISOString(), issueId, scope.companyId);
	}

	async addActivityLog(
		scope: TenantScope,
		issueId: string,
		actor: string,
		event: string,
		payload?: string,
	): Promise<void> {
		const now = new Date().toISOString();
		if (payload !== undefined) {
			getRawDb()
				.prepare(`
        INSERT INTO activity_log (id, issue_id, company_id, actor, event, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
				.run(
					crypto.randomUUID(),
					issueId,
					scope.companyId,
					actor,
					event,
					payload,
					now,
				);
			return;
		}
		getRawDb()
			.prepare(`
      INSERT INTO activity_log (id, issue_id, company_id, actor, event, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
			.run(crypto.randomUUID(), issueId, scope.companyId, actor, event, now);
	}

	async getLifecycle(
		scope: TenantScope,
		issueId: string,
	): Promise<{ projectId: string; currentStage: IssueLifecycleStage } | null> {
		const row = getRawDb()
			.prepare(`
      SELECT project_id AS projectId, COALESCE(lifecycle_stage, 'backlog') AS currentStage
        FROM board_issues
       WHERE id = ? AND company_id = ?
       LIMIT 1
    `)
			.get(issueId, scope.companyId) as
			| { projectId: string; currentStage: IssueLifecycleStage }
			| undefined;
		return row ?? null;
	}

	async applyLifecycleTransition(
		scope: TenantScope,
		input: {
			issueId: string;
			projectId: string;
			fromStage: IssueLifecycleStage;
			toStage: IssueLifecycleStage;
			actorType: IssueLifecycleActor;
			actorId?: string | null;
			status: IssueStatus;
			occurredAt: string;
		},
	): Promise<void> {
		const raw = getRawDb();
		const tx = raw.transaction(() => {
			raw
				.prepare(`
        UPDATE board_issues
           SET lifecycle_stage = ?, status = ?, updated_at = ?
         WHERE id = ? AND company_id = ?
      `)
				.run(
					input.toStage,
					input.status,
					input.occurredAt,
					input.issueId,
					scope.companyId,
				);

			raw
				.prepare(`
        INSERT INTO issue_lifecycle_events
          (id, issue_id, company_id, from_stage, to_stage, actor_type, actor_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
				.run(
					crypto.randomUUID(),
					input.issueId,
					scope.companyId,
					input.fromStage,
					input.toStage,
					input.actorType,
					input.actorId ?? null,
					input.occurredAt,
				);
		});
		tx();
	}
}
