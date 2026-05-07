import type {
	DomainEvent,
	EventBus,
	RunStatus,
	TenantScope,
} from "@setra/domain";
import { canTransitionRunStatus, isTerminalRunStatus } from "@setra/domain";

export interface ScopedRunRecord {
	id: string;
	agentId: string;
	companyId: string | null;
	status: RunStatus;
}

export interface RunServiceRepository {
	getRun(scope: TenantScope, runId: string): Promise<ScopedRunRecord | null>;
	updateHeartbeat(
		scope: TenantScope,
		runId: string,
		updatedAt: string,
	): Promise<void>;
	updateRunStatus(
		scope: TenantScope,
		runId: string,
		updates: Record<string, unknown>,
	): Promise<void>;
	getIssueWorkspace(
		scope: TenantScope,
		issueId: string,
	): Promise<{ projectId: string; workspacePath: string | null } | null>;
	ensureBoardProject(projectId: string, now: string): Promise<void>;
	ensureBoardPlot(input: {
		plotId: string;
		projectId: string;
		agentSlug: string;
		worktreePath: string | null;
		now: string;
	}): Promise<void>;
	updatePlotWorktree(
		plotId: string,
		worktreePath: string,
		now: string,
	): Promise<void>;
	createRun(input: {
		runId: string;
		plotId: string;
		agentSlug: string;
		model: string | null;
		agentArgs: string | null;
		now: string;
	}): Promise<void>;
	createTaskChunk(runId: string, task: string, now: string): Promise<void>;
	getRunFull(runId: string): Promise<unknown>;
}

export class RunsService {
	constructor(
		private readonly repository: RunServiceRepository,
		private readonly eventBus: EventBus<DomainEvent>,
	) {}

	async heartbeat(
		scope: TenantScope,
		runId: string,
	): Promise<{ run: ScopedRunRecord; updatedAt: string } | null> {
		const run = await this.repository.getRun(scope, runId);
		if (!run) return null;

		const updatedAt = new Date().toISOString();
		await this.repository.updateHeartbeat(scope, runId, updatedAt);
		this.eventBus.publish({
			type: "run.updated",
			companyId: run.companyId ?? scope.companyId,
			runId,
			agentId: run.agentId,
			event: "heartbeat",
		});
		return { run, updatedAt };
	}

	async updateStatus(
		scope: TenantScope,
		runId: string,
		input: {
			status: RunStatus;
			exitCode?: number;
			errorMessage?: string;
			costUsd?: number;
			promptTokens?: number;
			completionTokens?: number;
			cacheReadTokens?: number;
		},
	): Promise<{ run: ScopedRunRecord; isTerminal: boolean } | null> {
		const run = await this.repository.getRun(scope, runId);
		if (!run) return null;
		if (!canTransitionRunStatus(run.status, input.status)) {
			throw new Error(
				`invalid run transition ${run.status} → ${input.status} for run ${runId}`,
			);
		}

		const updatedAt = new Date().toISOString();
		const isTerminal = isTerminalRunStatus(input.status);
		const updates: Record<string, unknown> = {
			status: input.status,
			updated_at: updatedAt,
		};
		if (isTerminal) updates.ended_at = updatedAt;
		if (input.exitCode !== undefined) updates.exit_code = input.exitCode;
		if (input.errorMessage !== undefined)
			updates.error_message = input.errorMessage;
		if (input.costUsd !== undefined) updates.cost_usd = input.costUsd;
		if (input.promptTokens !== undefined)
			updates.prompt_tokens = input.promptTokens;
		if (input.completionTokens !== undefined)
			updates.completion_tokens = input.completionTokens;
		if (input.cacheReadTokens !== undefined)
			updates.cache_read_tokens = input.cacheReadTokens;

		await this.repository.updateRunStatus(scope, runId, updates);

		this.eventBus.publish(
			isTerminal
				? {
						type: "run.completed",
						companyId: run.companyId ?? scope.companyId,
						runId,
						agentId: run.agentId,
						status: input.status as Extract<
							RunStatus,
							"completed" | "failed" | "cancelled"
						>,
					}
				: {
						type: "run.updated",
						companyId: run.companyId ?? scope.companyId,
						runId,
						agentId: run.agentId,
						status: input.status,
						event: "status_changed",
					},
		);

		return { run: { ...run, status: input.status }, isTerminal };
	}

	async createPendingRun(
		scope: TenantScope,
		input: {
			agentSlug: string;
			plotSeed: string;
			model: string | null;
			agentArgs: string[] | null;
			issueId?: string;
			task?: string;
			worktreePath: string | null;
			projectScopeKey: string;
		},
	): Promise<{ runId: string; run: unknown }> {
		const now = new Date().toISOString();
		const BOARD_PROJECT_ID = "00000000000000000000000000000001";
		const boardPlotId = input.projectScopeKey
			? `${input.plotSeed}-${input.projectScopeKey}`.slice(0, 32)
			: input.plotSeed.slice(0, 32);

		await this.repository.ensureBoardProject(BOARD_PROJECT_ID, now);
		await this.repository.ensureBoardPlot({
			plotId: boardPlotId,
			projectId: BOARD_PROJECT_ID,
			agentSlug: input.agentSlug,
			worktreePath: input.worktreePath,
			now,
		});
		if (input.worktreePath) {
			await this.repository.updatePlotWorktree(
				boardPlotId,
				input.worktreePath,
				now,
			);
		}

		const runId = crypto.randomUUID();
		await this.repository.createRun({
			runId,
			plotId: boardPlotId,
			agentSlug: input.agentSlug,
			model: input.model,
			agentArgs: input.agentArgs ? JSON.stringify(input.agentArgs) : null,
			now,
		});
		if (input.task) {
			await this.repository.createTaskChunk(runId, input.task, now);
		}

		this.eventBus.publish({
			type: "run.updated",
			companyId: scope.companyId,
			runId,
			agentId: input.agentSlug,
			issueId: input.issueId ?? null,
			status: "pending",
			event: "created",
		});

		return { runId, run: await this.repository.getRunFull(runId) };
	}

	getScopedIssueWorkspace(
		scope: TenantScope,
		issueId: string,
	): Promise<{ projectId: string; workspacePath: string | null } | null> {
		return this.repository.getIssueWorkspace(scope, issueId);
	}
}
