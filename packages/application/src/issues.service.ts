import type {
	DomainEvent,
	EventBus,
	IssueLifecycleActor,
	IssueLifecycleStage,
	IssuePriority,
	IssueStatus,
	TenantScope,
} from "@setra/domain";
import {
	canTransitionIssueLifecycleStage,
	mapIssueLifecycleStageToStatus,
} from "@setra/domain";

export interface IssueSummary {
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

export interface IssueServiceRepository {
	getScopedProject(
		scope: TenantScope,
		projectId: string,
	): Promise<{ id: string; slug: string } | null>;
	getScopedParentIssue(
		scope: TenantScope,
		issueId: string,
	): Promise<{ id: string; projectId: string } | null>;
	countIssuesForProject(scope: TenantScope, projectId: string): Promise<number>;
	createIssue(
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
	): Promise<IssueSummary | null>;
	getIssueById(
		scope: TenantScope,
		issueId: string,
	): Promise<Record<string, unknown> | null>;
	getIssueStatus(
		scope: TenantScope,
		issueId: string,
	): Promise<{ status: string } | null>;
	updateIssueFields(
		scope: TenantScope,
		issueId: string,
		updates: Record<string, unknown>,
	): Promise<void>;
	updateIssueRawField(
		scope: TenantScope,
		issueId: string,
		field: "labels" | "tags",
		value: unknown,
	): Promise<void>;
	addActivityLog(
		scope: TenantScope,
		issueId: string,
		actor: string,
		event: string,
		payload?: string,
	): Promise<void>;
	getLifecycle(
		scope: TenantScope,
		issueId: string,
	): Promise<{ projectId: string; currentStage: IssueLifecycleStage } | null>;
	applyLifecycleTransition(
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
	): Promise<void>;
}

export class IssuesService {
	constructor(
		private readonly repository: IssueServiceRepository,
		private readonly eventBus: EventBus<DomainEvent>,
	) {}

	async createIssue(
		scope: TenantScope,
		input: {
			projectId: string;
			title: string;
			description?: string;
			status?: IssueStatus;
			priority?: IssuePriority;
			parentIssueId?: string;
			acceptanceCriteria?: string;
			testCommand?: string;
			testStatus?: "none" | "pending" | "running" | "passed" | "failed";
		},
	): Promise<{
		issue: IssueSummary | null;
		reason?: "project_not_found" | "parent_issue_not_found" | "insert_failed";
	}> {
		const project = await this.repository.getScopedProject(
			scope,
			input.projectId,
		);
		if (!project) return { issue: null, reason: "project_not_found" };

		let parentIssueId: string | null = null;
		if (input.parentIssueId) {
			const parent = await this.repository.getScopedParentIssue(
				scope,
				input.parentIssueId,
			);
			if (!parent || parent.projectId !== project.id) {
				return { issue: null, reason: "parent_issue_not_found" };
			}
			parentIssueId = parent.id;
		}

		const prefix = project.slug.toUpperCase().slice(0, 4);
		let slug: string;
		let row: Awaited<ReturnType<typeof this.repository.createIssue>> | null =
			null;
		for (let attempt = 0; attempt < 3; attempt++) {
			const num =
				(await this.repository.countIssuesForProject(scope, project.id)) +
				1 +
				attempt;
			slug = `${prefix}-${num}`;
			try {
				row = await this.repository.createIssue(scope, {
					projectId: project.id,
					slug,
					title: input.title,
					description: input.description ?? null,
					status: input.status ?? "backlog",
					priority: input.priority ?? "none",
					lifecycleStage: "backlog",
					parentIssueId,
					acceptanceCriteria: input.acceptanceCriteria?.trim() ?? "",
					testCommand: input.testCommand?.trim() ?? "",
					testStatus:
						input.testStatus ??
						(input.testCommand?.trim() ? "pending" : "none"),
				});
				if (row) break;
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				if (msg.includes("UNIQUE constraint") && attempt < 2) continue;
				throw err;
			}
		}
		if (!row) return { issue: null, reason: "insert_failed" };

		this.eventBus.publish({
			type: "issue.updated",
			companyId: scope.companyId,
			issueId: row.id,
			projectId: row.projectId,
			event: "created",
		});
		return { issue: row };
	}

	async updateIssue(
		scope: TenantScope,
		issueId: string,
		input: {
			title?: string;
			description?: string | null;
			status?: IssueStatus;
			priority?: IssuePriority;
			assignedAgentId?: string | null;
			dueDate?: string | null;
			labels?: string;
			tags?: string;
			acceptanceCriteria?: string;
			testCommand?: string;
			testStatus?: "none" | "pending" | "running" | "passed" | "failed";
		},
	): Promise<Record<string, unknown> | null> {
		const { labels, tags, ...issueFields } = input;
		const oldStatus = input.status
			? await this.repository.getIssueStatus(scope, issueId)
			: null;

		if (Object.keys(issueFields).length > 0) {
			await this.repository.updateIssueFields(scope, issueId, issueFields);
		}
		if (labels !== undefined) {
			await this.repository.updateIssueRawField(
				scope,
				issueId,
				"labels",
				labels,
			);
		}
		if (tags !== undefined) {
			await this.repository.updateIssueRawField(scope, issueId, "tags", tags);
		}
		if (input.status && oldStatus && oldStatus.status !== input.status) {
			await this.repository.addActivityLog(
				scope,
				issueId,
				"human",
				"status_changed",
				JSON.stringify({ from: oldStatus.status, to: input.status }),
			);
		}

		const updated = await this.repository.getIssueById(scope, issueId);
		if (!updated) return null;

		this.eventBus.publish({
			type: "issue.updated",
			companyId: scope.companyId,
			issueId,
			event: "updated",
		});
		return updated;
	}

	async transitionLifecycle(
		scope: TenantScope,
		issueId: string,
		input: {
			to: IssueLifecycleStage;
			actorType: IssueLifecycleActor;
			actorId?: string | null;
			force?: boolean;
		},
	): Promise<{
		issueId: string;
		projectId: string;
		companyId: string;
		fromStage: IssueLifecycleStage;
		toStage: IssueLifecycleStage;
		noop: boolean;
	} | null> {
		const lifecycle = await this.repository.getLifecycle(scope, issueId);
		if (!lifecycle) return null;

		const fromStage = lifecycle.currentStage;
		if (fromStage === input.to && input.to !== "committed") {
			return {
				issueId,
				projectId: lifecycle.projectId,
				companyId: scope.companyId,
				fromStage,
				toStage: input.to,
				noop: true,
			};
		}

		if (
			!input.force &&
			!canTransitionIssueLifecycleStage(fromStage, input.to)
		) {
			throw new Error(
				`invalid lifecycle transition ${fromStage} → ${input.to} for issue ${issueId}`,
			);
		}

		const toStage = input.to;
		await this.repository.applyLifecycleTransition(scope, {
			issueId,
			projectId: lifecycle.projectId,
			fromStage,
			toStage,
			actorType: input.actorType,
			actorId: input.actorId ?? null,
			status: mapIssueLifecycleStageToStatus(toStage),
			occurredAt: new Date().toISOString(),
		});

		this.eventBus.publish({
			type: "issue.lifecycle.transitioned",
			companyId: scope.companyId,
			issueId,
			projectId: lifecycle.projectId,
			fromStage,
			toStage,
			actorType: input.actorType,
			actorId: input.actorId ?? null,
			noop: false,
		});
		this.eventBus.publish({
			type: "issue.updated",
			companyId: scope.companyId,
			issueId,
			projectId: lifecycle.projectId,
			event: "lifecycle",
			lifecycleStage: toStage,
		});

		return {
			issueId,
			projectId: lifecycle.projectId,
			companyId: scope.companyId,
			fromStage,
			toStage,
			noop: false,
		};
	}
}
