/**
 * dispatcher.ts — auto-discovery loop that turns ready issues into runs.
 *
 * Every DEFAULT_INTERVAL_MS we sweep each company:
 *   1. find issues in 'backlog' or 'todo' (status='ready') without a recent run,
 *   2. find an idle developer-role agent in that company,
 *   3. concurrency cap from company_settings.max_parallel_runs (default 7),
 *   4. create a `runs` row and hand it to the server-side orchestrator.
 *      The Electron app, when connected, will continue to pick up runs
 *      whose adapter it supports locally.
 *
 * Disable per-company by setting `auto_dispatch_enabled = false` in the
 * settings file. The loop is idempotent — calling startDispatcher() again
 * stops any existing timer and starts a fresh one.
 */

import crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import * as approvalsRepo from "../repositories/approvals.repo.js";
import { isOfflineForCompany } from "../repositories/runtime.repo.js";
import { emit } from "../sse/handler.js";
import { isCloudAdapter, normalizeAdapterId } from "./adapter-policy.js";
import { triggerIdleConversation } from "./agent-idle-converse.js";
import { companyRequiresApproval } from "./approval-gates.js";
import { autonomousDispatchCycle } from "./autonomous-loop.js";
import { getAllSettings, getCompanySettings } from "./company-settings.js";
import { cronMatches, nextCronOccurrence } from "./cron.js";
import { registerDispatcherTickHandler } from "./dispatcher-scheduler.js";
import { buildIssueBranchName } from "./issue-branch.js";
import { createLogger } from "./logger.js";
import type { Plan, PlanSubtask } from "./plan-engine.js";
import { getProjectSettings } from "./project-settings.js";
import { jobQueue } from "./queue.js";
import { resolveAutoAdapter } from "./resolve-auto-adapter.js";
import { triggerRoutineRun } from "./routines-scheduler.js";
import { spawnServerRun } from "./server-runner.js";
import { rebuildSprintBoard } from "./sprint-board.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MAX_PARALLEL = 7;
const DEFAULT_CONTINUOUS_INTERVAL_MS = 60_000;
const MAX_CONTINUOUS_BACKOFF_MS = 15 * 60_000;
const RECENT_RUN_WINDOW_MS = 5 * 60_000;
const STALE_RUN_TIMEOUT_MS = 10 * 60_000; // 10 minutes
const VERIFICATION_DIGEST_INTERVAL_MS = 12 * 60 * 60_000;

// PTY-only adapters: must run via the Electron PTY bridge.
// NOTE: `codex` was historically here, but with `codex login` (OAuth) the
// non-interactive `codex exec` invocation works server-side too. Source of
// truth lives in `adapter-policy.ts#getAdapterExecutionMode`.
const PTY_ONLY_ADAPTERS = new Set(["claude", "gemini", "amp", "opencode"]);

const DEVELOPER_SLUG_HINTS = [
	"dev",
	"developer",
	"engineer",
	"engineering",
	"fe",
	"be",
	"frontend",
	"backend",
	"fullstack",
	"full-stack",
	"coder",
	"ai-engineer",
	"ceo",
	"cto",
	"agent",
];

interface IssueRow {
	id: string;
	slug: string;
	title: string;
	status: string;
	project_id: string;
	company_id: string | null;
	workspace_path: string | null;
	assigned_agent_id: string | null;
}

interface ProjectDispatchPolicy {
	maxParallelRuns: number;
	budgetCapUsd: number;
	remainingBudgetUsd: number;
}

interface AgentRow {
	id: string;
	slug: string;
	display_name: string;
	adapter_type: string | null;
	model_id: string | null;
	is_active: number;
	status: string;
	company_id: string | null;
}

interface ContinuousAgentRow extends AgentRow {
	run_mode: string;
	continuous_interval_ms: number | null;
	idle_prompt: string | null;
	last_run_ended_at: string | null;
}

interface MonitoringProjectScope {
	project_id: string;
	workspace_path: string | null;
	name: string;
}

let _timer: ReturnType<typeof setTimeout> | null = null;
let _running = false;
let _ticking = false;
const lastDigestAt = new Map<string, number>();
const log = createLogger("dispatcher");

export interface DispatchResult {
	dispatched: number;
	skippedNoAgent: number;
	skippedAtCap: number;
	perCompany: Record<
		string,
		{ dispatched: number; activeRuns: number; cap: number }
	>;
}

function isDeveloperSlug(slug: string): boolean {
	const s = slug.toLowerCase();
	return DEVELOPER_SLUG_HINTS.some((h) => s === h || s.includes(h));
}

function activeRunsForCompany(companyId: string): number {
	const raw = getRawDb();
	const row = raw
		.prepare(
			`SELECT COUNT(*) AS c
         FROM runs r
         JOIN agent_roster a ON a.slug = r.agent
        WHERE r.status IN ('pending','running')
          AND a.company_id = ?`,
		)
		.get(companyId) as { c: number } | undefined;
	return row?.c ?? 0;
}

function activeRunsForProject(projectId: string): number {
	const row = getRawDb()
		.prepare(
			`SELECT COUNT(*) AS c
			   FROM runs r
			   JOIN board_issues i ON i.linked_plot_id = r.plot_id
			  WHERE i.project_id = ?
			    AND r.status IN ('pending','running')`,
		)
		.get(projectId) as { c: number } | undefined;
	return row?.c ?? 0;
}

function readyIssuesForCompany(companyId: string, limit: number): IssueRow[] {
	const raw = getRawDb();
	const windowArg = `-${Math.round(RECENT_RUN_WINDOW_MS / 1000)} seconds`;
	const selectReadyIssues = (status: "todo" | "backlog") =>
		raw
			.prepare(
				`SELECT
            i.id,
            i.slug,
            i.title,
            i.status,
            i.project_id,
            i.company_id,
            i.assigned_agent_id,
            COALESCE(NULLIF(trim(p.workspace_path), ''), NULLIF(trim(p.repo_path), '')) AS workspace_path
           FROM board_issues i
           LEFT JOIN board_projects p ON p.id = i.project_id
           WHERE i.company_id = ?
             AND i.status = ?
             AND COALESCE(NULLIF(trim(p.workspace_path), ''), NULLIF(trim(p.repo_path), '')) IS NOT NULL
             AND NOT EXISTS (
              SELECT 1 FROM runs r
             WHERE r.plot_id = i.linked_plot_id
               AND i.linked_plot_id IS NOT NULL
               AND r.status IN ('pending', 'running')
               AND r.started_at >= datetime('now', ?)
           )
         ORDER BY CASE lower(COALESCE(i.priority, 'medium'))
            WHEN 'critical' THEN 0
            WHEN 'urgent' THEN 0
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            ELSE 4
          END ASC,
          i.created_at ASC
         LIMIT ?`,
			)
			.all(companyId, status, windowArg, limit) as IssueRow[];
	const todoIssues = selectReadyIssues("todo");
	return todoIssues.length > 0 ? todoIssues : selectReadyIssues("backlog");
}

const SUPPORTED_ADAPTERS = new Set([
	"anthropic-api",
	"openai-api",
	"gemini-api",
	"openrouter",
	"groq",
	"ollama",
	// PTY-only adapters — executed by the Electron desktop PTY bridge.
	// Treat as "supported" so idleDeveloperAgents() does NOT overwrite them
	// with a resolved API adapter (which would break CEO/codex agents).
	"claude",
	"codex",
	"amp",
	"opencode",
	"gemini",
]);

function idleDeveloperAgents(companyId: string): AgentRow[] {
	const raw = getRawDb();
	const offline = isOfflineForCompany(companyId);
	const rows = raw
		.prepare(
			`SELECT id, slug, display_name, adapter_type, model_id, is_active, status, company_id
         FROM agent_roster
         WHERE company_id = ?
           AND is_active = 1
           AND status = 'idle'
         ORDER BY created_at ASC`,
		)
		.all(companyId) as AgentRow[];
	const normalizedRows = rows.map((a): AgentRow => {
		const adapter = normalizeAdapterId(a.adapter_type);
		if (SUPPORTED_ADAPTERS.has(adapter)) return a;

		const repaired = resolveAutoAdapter("auto", a.model_id, companyId);
		if (repaired.adapter === null) {
			raw
				.prepare(
					`UPDATE agent_roster
            SET status = 'awaiting_key',
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ? AND status = 'idle'`,
				)
				.run(a.id);
			return a;
		}

		raw
			.prepare(
				`UPDATE agent_roster
          SET adapter_type = ?,
              model_id = COALESCE(?, model_id),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
			)
			.run(repaired.adapter, repaired.model, a.id);
		return {
			...a,
			adapter_type: repaired.adapter,
			model_id: repaired.model ?? a.model_id,
		};
	});

	const compatible = normalizedRows.filter(
		(a) =>
			SUPPORTED_ADAPTERS.has(normalizeAdapterId(a.adapter_type)) &&
			!(offline && isCloudAdapter(a.adapter_type)),
	);
	const developers = compatible.filter((a) => isDeveloperSlug(a.slug));
	// If no explicit "developer-like" agents exist (e.g. only CEO/Assistant),
	// fall back to any compatible idle agent so work still progresses.
	return developers.length > 0 ? developers : compatible;
}

interface AgentLoadRow extends AgentRow {
	active_runs: number;
}

function listDispatchableAgents(companyId: string): AgentLoadRow[] {
	const raw = getRawDb();
	const offline = isOfflineForCompany(companyId);
	const agents = raw
		.prepare(
			`SELECT a.id, a.slug, a.display_name, a.adapter_type, a.model_id, a.is_active, a.status, a.company_id,
			        COALESCE((
			          SELECT COUNT(*)
			            FROM runs r
			           WHERE r.agent = a.slug
			             AND r.status IN ('pending','running')
			        ), 0) AS active_runs
			   FROM agent_roster a
			  WHERE a.company_id = ?
			    AND a.is_active = 1
			  ORDER BY active_runs ASC, a.created_at ASC`,
		)
		.all(companyId) as AgentLoadRow[];
	return agents.filter(
		(agent) =>
			SUPPORTED_ADAPTERS.has(normalizeAdapterId(agent.adapter_type)) &&
			!(offline && isCloudAdapter(agent.adapter_type)),
	);
}

function isCtoSlug(slug: string): boolean {
	const normalized = slug.toLowerCase();
	return normalized === "cto" || normalized.includes("cto");
}

function isCeoSlug(slug: string): boolean {
	const normalized = slug.toLowerCase();
	return normalized === "ceo" || normalized.includes("ceo");
}

function scoreAgentForSubtask(
	agent: AgentLoadRow,
	subtask: PlanSubtask,
): number {
	const text = `${subtask.title} ${subtask.description}`.toLowerCase();
	const skills = `${agent.slug} ${agent.display_name}`.toLowerCase();
	let score = agent.active_runs * 10;
	if (subtask.assignTo === "cto" && isCtoSlug(agent.slug)) score -= 50;
	if (subtask.assignTo === "dev" && isDeveloperSlug(agent.slug)) score -= 40;
	if (subtask.assignTo === "auto") {
		if (
			/(architecture|security|scale|review|performance)/.test(text) &&
			isCtoSlug(agent.slug)
		)
			score -= 45;
		if (
			/(ui|api|fix|implement|build|test|bug)/.test(text) &&
			isDeveloperSlug(agent.slug)
		)
			score -= 30;
	}
	if (skills.includes("security") && text.includes("security")) score -= 10;
	if (skills.includes("frontend") && /(ui|frontend)/.test(text)) score -= 8;
	if (skills.includes("backend") && /(api|backend|database)/.test(text))
		score -= 8;
	if (isCeoSlug(agent.slug)) score += 100;
	return score;
}

export function findBestAgent(
	assignTo: PlanSubtask["assignTo"],
	companyId: string,
	subtask?: PlanSubtask,
): AgentRow | null {
	const agents = listDispatchableAgents(companyId);
	if (agents.length === 0) return null;
	if (assignTo === "cto") {
		return agents.find((agent) => isCtoSlug(agent.slug)) ?? null;
	}
	if (assignTo === "dev") {
		return (
			agents
				.filter(
					(agent) =>
						isDeveloperSlug(agent.slug) &&
						!isCeoSlug(agent.slug) &&
						!isCtoSlug(agent.slug),
				)
				.sort((left, right) => left.active_runs - right.active_runs)[0] ?? null
		);
	}
	const ranked = [...agents].sort(
		(left, right) =>
			scoreAgentForSubtask(
				left,
				subtask ?? {
					id: "auto",
					title: "auto",
					description: "auto",
					assignTo,
					priority: 0,
					dependsOn: [],
					status: "pending",
				},
			) -
			scoreAgentForSubtask(
				right,
				subtask ?? {
					id: "auto",
					title: "auto",
					description: "auto",
					assignTo,
					priority: 0,
					dependsOn: [],
					status: "pending",
				},
			),
	);
	return ranked[0] ?? null;
}

function loadIssueForDispatch(issueId: string): IssueRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT i.id, i.slug, i.title, i.status, i.project_id, i.company_id, p.workspace_path, i.assigned_agent_id
				   FROM board_issues i
				   LEFT JOIN board_projects p ON p.id = i.project_id
				  WHERE i.id = ?`,
			)
			.get(issueId) as IssueRow | undefined) ?? null
	);
}

export function topologicalSort(subtasks: PlanSubtask[]): PlanSubtask[][] {
	const byId = new Map(subtasks.map((subtask) => [subtask.id, subtask]));
	const remaining = new Set(subtasks.map((subtask) => subtask.id));
	const completed = new Set(
		subtasks
			.filter((subtask) => subtask.status === "done")
			.map((subtask) => subtask.id),
	);
	const levels: PlanSubtask[][] = [];
	while (remaining.size > 0) {
		const level = [...remaining]
			.map((id) => byId.get(id))
			.filter((subtask): subtask is PlanSubtask => Boolean(subtask))
			.filter((subtask) =>
				subtask.dependsOn.every(
					(dependency) => completed.has(dependency) || !byId.has(dependency),
				),
			);
		if (level.length === 0) {
			levels.push(
				[...remaining]
					.map((id) => byId.get(id))
					.filter((subtask): subtask is PlanSubtask => Boolean(subtask)),
			);
			break;
		}
		levels.push(level);
		for (const subtask of level) {
			remaining.delete(subtask.id);
			if (subtask.status === "done") completed.add(subtask.id);
		}
	}
	return levels;
}

function getCompanyMaxParallel(companyId: string): number {
	const s = getCompanySettings(companyId);
	const v = s["max_parallel_runs"];
	if (typeof v === "number" && v > 0) return v;
	return DEFAULT_MAX_PARALLEL;
}

function getProjectDispatchPolicy(
	projectId: string,
	companyId: string,
): ProjectDispatchPolicy {
	const settings = getProjectSettings(projectId);
	const projectRow = getRawDb()
		.prepare(
			`SELECT total_cost_usd AS totalCostUsd
			   FROM board_projects
			  WHERE id = ? AND company_id = ?
			  LIMIT 1`,
		)
		.get(projectId, companyId) as { totalCostUsd: number | null } | undefined;
	const budgetCapUsd = Math.max(0, settings.budgetCapUsd);
	const spentUsd = projectRow?.totalCostUsd ?? 0;
	return {
		maxParallelRuns: Math.max(1, settings.maxParallelRuns),
		budgetCapUsd,
		remainingBudgetUsd:
			budgetCapUsd > 0
				? Math.max(0, budgetCapUsd - spentUsd)
				: Number.POSITIVE_INFINITY,
	};
}

function isAutoDispatchEnabled(companyId: string): boolean {
	const s = getCompanySettings(companyId);
	const v = s["auto_dispatch_enabled"];
	if (typeof v === "boolean") return v;
	return true;
}

function ensureBoardSentinel(): string {
	const raw = getRawDb();
	const BOARD_PROJECT_ID = "00000000000000000000000000000001";
	const now = new Date().toISOString();
	raw
		.prepare(
			`INSERT OR IGNORE INTO board_projects (id, name, repo_path, created_at, updated_at)
     VALUES (?, 'Board Dispatch', '__board__', ?, ?)`,
		)
		.run(BOARD_PROJECT_ID, now, now);
	return BOARD_PROJECT_ID;
}

function getMonitoringProjectScope(
	companyId: string,
): MonitoringProjectScope | null {
	const raw = getRawDb();
	return (
		(raw
			.prepare(
				`SELECT id AS project_id,
				        COALESCE(NULLIF(trim(workspace_path), ''), NULLIF(trim(repo_path), '')) AS workspace_path,
				        name
				   FROM board_projects
				  WHERE company_id = ?
				    AND COALESCE(NULLIF(trim(workspace_path), ''), NULLIF(trim(repo_path), '')) IS NOT NULL
				  ORDER BY updated_at DESC, created_at ASC
				  LIMIT 1`,
			)
			.get(companyId) as MonitoringProjectScope | undefined) ?? null
	);
}

function getContinuousFailureStreak(agentSlug: string): number {
	const rows = getRawDb()
		.prepare(
			`SELECT status
			   FROM runs
			  WHERE agent = ?
			    AND json_extract(agent_args, '$.kind') = 'continuous_monitoring'
			    AND status IN ('completed', 'failed', 'cancelled')
			  ORDER BY COALESCE(ended_at, updated_at) DESC
			  LIMIT 8`,
		)
		.all(agentSlug) as Array<{ status: string }>;
	let streak = 0;
	for (const row of rows) {
		if (row.status !== "failed") break;
		streak++;
	}
	return streak;
}

function getEffectiveContinuousIntervalMs(agent: ContinuousAgentRow): number {
	const baseInterval =
		typeof agent.continuous_interval_ms === "number" &&
		agent.continuous_interval_ms > 0
			? agent.continuous_interval_ms
			: DEFAULT_CONTINUOUS_INTERVAL_MS;
	const streak = getContinuousFailureStreak(agent.slug);
	return Math.min(baseInterval * 2 ** streak, MAX_CONTINUOUS_BACKOFF_MS);
}

function listEligibleContinuousAgents(companyId: string): ContinuousAgentRow[] {
	const raw = getRawDb();
	const rows = raw
		.prepare(
			`SELECT id, slug, display_name, adapter_type, model_id, is_active, status, company_id,
			        run_mode, continuous_interval_ms, idle_prompt, last_run_ended_at
			   FROM agent_roster
			  WHERE company_id = ?
			    AND run_mode = 'continuous'
			    AND status = 'idle'
			    AND is_active = 1
			  ORDER BY created_at ASC`,
		)
		.all(companyId) as ContinuousAgentRow[];
	const nowMs = Date.now();
	return rows.filter((agent) => {
		if (!SUPPORTED_ADAPTERS.has(normalizeAdapterId(agent.adapter_type)))
			return false;
		const lastEndedMs = agent.last_run_ended_at
			? Date.parse(agent.last_run_ended_at)
			: Number.NaN;
		if (Number.isNaN(lastEndedMs)) return true;
		return nowMs - lastEndedMs > getEffectiveContinuousIntervalMs(agent);
	});
}

async function checkScheduledRoutines(companyId: string): Promise<void> {
	const rows = getRawDb()
		.prepare(
			`SELECT id, schedule
			   FROM routines
			  WHERE company_id = ?
			    AND is_active = 1
			    AND agent_id IS NOT NULL
			    AND schedule IS NOT NULL
			    AND trim(schedule) != ''
			    AND (last_triggered_at IS NULL OR datetime(last_triggered_at) < datetime('now', '-50 seconds'))`,
		)
		.all(companyId) as Array<{ id: string; schedule: string }>;

	for (const routine of rows) {
		if (!cronMatches(routine.schedule)) continue;
		await triggerRoutineRun(routine.id, companyId);
		const nextRunAt =
			nextCronOccurrence(routine.schedule)?.toISOString() ?? null;
		getRawDb()
			.prepare(`UPDATE routines SET next_run_at = ? WHERE id = ?`)
			.run(nextRunAt, routine.id);
	}
}

async function createMonitoringRun(
	agent: ContinuousAgentRow,
	companyId: string,
): Promise<{ runId: string; task: string } | null> {
	const raw = getRawDb();
	const now = new Date().toISOString();
	const scope = getMonitoringProjectScope(companyId);
	const projectId = scope?.project_id ?? ensureBoardSentinel();
	const plotId = `cm${agent.id.replace(/-/g, "").slice(0, 30)}`;
	const branchName = `continuous/${agent.slug}`.slice(0, 255);
	const prompt =
		agent.idle_prompt?.trim() ||
		`You are ${agent.display_name}. Check the project for any issues, bugs, or improvements you can work on. If you find something, create an issue and start working on it. If nothing needs attention, report "All clear."`;

	raw
		.prepare(
			`INSERT OR IGNORE INTO plots
			 (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'main', ?, ?, ?)`,
		)
		.run(
			plotId,
			projectId,
			`Continuous Monitor — ${agent.display_name}`,
			branchName,
			scope?.workspace_path ?? null,
			now,
			now,
		);

	raw
		.prepare(
			`UPDATE plots SET updated_at = ?, worktree_path = COALESCE(?, worktree_path) WHERE id = ?`,
		)
		.run(now, scope?.workspace_path ?? null, plotId);

	const runId = crypto.randomUUID();
	raw
		.prepare(
			`INSERT INTO runs
			 (id, plot_id, agent, branch_name, agent_args, status, started_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
		)
		.run(
			runId,
			plotId,
			agent.slug,
			branchName,
			JSON.stringify({
				kind: "continuous_monitoring",
				runMode: agent.run_mode,
				idlePrompt: agent.idle_prompt ?? null,
				projectId: scope?.project_id ?? null,
			}),
			now,
			now,
		);
	raw
		.prepare(
			`INSERT INTO chunks (run_id, sequence, content, chunk_type, recorded_at)
			 VALUES (?, 0, ?, 'input', ?)`,
		)
		.run(runId, prompt, now);
	raw
		.prepare(
			`UPDATE agent_roster
			    SET status = 'running', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			  WHERE id = ? AND status = 'idle'`,
		)
		.run(agent.id);

	emit("run:updated", {
		runId,
		agentId: agent.slug,
		status: "pending",
		issueId: null,
	});
	log.info("continuous monitoring run queued", {
		runId,
		agentSlug: agent.slug,
		projectId: scope?.project_id ?? null,
	});
	return { runId, task: prompt };
}

async function ensureTaskStartApproval(
	issue: IssueRow,
	agent: AgentRow,
): Promise<boolean> {
	if (!issue.company_id) return true;
	if (!companyRequiresApproval(issue.company_id, "task_start")) return true;

	const latest = await approvalsRepo.getLatestEntityApproval(
		issue.id,
		issue.company_id,
		"approval",
		"issue",
	);
	if (latest?.status === "approved") return true;
	if (latest) return false;

	const created = await approvalsRepo.createApproval({
		companyId: issue.company_id,
		type: "approval",
		entityType: "issue",
		entityId: issue.id,
		title: `Start ${issue.slug}`,
		description: `Agent ${agent.slug} wants to work on: ${issue.title}`,
		requestedBy: agent.slug,
		targetIssueSlug: issue.slug,
		riskLevel: "medium",
	});
	if (created) {
		emit("review_requested", {
			id: created.id,
			type: created.type,
			companyId: issue.company_id,
			entityId: issue.id,
		});
	}
	return false;
}

export async function createRun(
	agent: AgentRow,
	issue: IssueRow,
): Promise<{ runId: string; plotId: string } | null> {
	const raw = getRawDb();
	const now = new Date().toISOString();

	if (!(await ensureTaskStartApproval(issue, agent))) return null;

	// Atomic claim: only one dispatcher instance may transition the issue from
	// backlog/todo to in_progress and create a run.
	const claim = raw
		.prepare(
			`UPDATE board_issues
         SET status = 'in_progress',
             updated_at = ?
       WHERE id = ?
         AND company_id = ?
         AND status IN ('backlog','todo')`,
		)
		.run(now, issue.id, issue.company_id);
	if (claim.changes === 0) return null;

	const boardProjectId = ensureBoardSentinel();
	const boardPlotId = `bi${issue.id.replace(/-/g, "").slice(0, 30)}`;
	const branchName = buildIssueBranchName(issue.id, issue.title);

	raw
		.prepare(
			`INSERT OR IGNORE INTO plots
        (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'main', ?, ?, ?)`,
		)
		.run(
			boardPlotId,
			boardProjectId,
			`Dispatch — ${issue.slug}`,
			branchName,
			null,
			now,
			now,
		);

	const runId = crypto.randomUUID();
	raw
		.prepare(
			`INSERT INTO runs
        (id, plot_id, agent, branch_name, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
		)
		.run(runId, boardPlotId, agent.slug, branchName, now, now);

	// Link the issue to the plot so the existing dashboards pick it up.
	raw
		.prepare(
			`UPDATE board_issues
         SET linked_plot_id = ?,
             assigned_agent_id = COALESCE(assigned_agent_id, ?),
             branch_name = NULL,
             updated_at = ?
       WHERE id = ?
         AND company_id = ?`,
		)
		.run(boardPlotId, agent.id, now, issue.id, issue.company_id);

	// Mark the agent as running so the next tick doesn't grab it again.
	raw
		.prepare(
			`UPDATE agent_roster
         SET status = 'running', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
		)
		.run(agent.id);
	log.info("agent assigned run", {
		agentSlug: agent.slug,
		issueSlug: issue.slug,
		branchName,
	});

	emit("run:updated", {
		runId,
		agentId: agent.slug,
		status: "pending",
		issueId: issue.id,
	});
	return { runId, plotId: boardPlotId };
}

function queueRunExecution(input: {
	agent: AgentRow;
	runId: string;
	companyId: string;
	issueId?: string | null;
	task?: string | null;
}): void {
	if (PTY_ONLY_ADAPTERS.has(input.agent.adapter_type ?? "")) {
		log.info("queued desktop PTY run", {
			runId: input.runId,
			agentSlug: input.agent.slug,
			adapterType: input.agent.adapter_type,
		});
		return;
	}
	void spawnServerRun({
		runId: input.runId,
		agentSlug: input.agent.slug,
		issueId: input.issueId ?? null,
		companyId: input.companyId,
		task: input.task ?? null,
	}).catch((err) => {
		log.warn("spawnServerRun failed", {
			runId: input.runId,
			error: err instanceof Error ? err.message : String(err),
		});
	});
}

export async function dispatchPlan(plan: Plan): Promise<void> {
	if (!plan.companyId || plan.status !== "executing") return;
	const refreshedLevels = topologicalSort(
		plan.subtasks.map((subtask) => {
			if (!subtask.issueId) return subtask;
			const issue = loadIssueForDispatch(subtask.issueId);
			if (!issue) return subtask;
			return {
				...subtask,
				status:
					issue.status === "done"
						? "done"
						: issue.status === "in_progress" || issue.status === "in_review"
							? "in_progress"
							: "pending",
			};
		}),
	);
	const nextLevel = refreshedLevels.find((level) =>
		level.some((subtask) => subtask.status !== "done"),
	);
	if (!nextLevel) return;
	for (const subtask of nextLevel) {
		if (subtask.status !== "pending" || !subtask.issueId) continue;
		const issue = loadIssueForDispatch(subtask.issueId);
		if (!issue?.company_id || !["backlog", "todo"].includes(issue.status))
			continue;
		const agent = findBestAgent(subtask.assignTo, plan.companyId, subtask);
		if (!agent) continue;
		const created = await createRun(agent, issue);
		if (!created) continue;
		queueRunExecution({
			agent,
			runId: created.runId,
			issueId: issue.id,
			companyId: plan.companyId,
		});
	}
}

/**
 * Recover from stale runs — runs stuck in pending/running for too long.
 * Resets agent to idle and issue back to todo so they can be re-dispatched.
 */
function recoverStaleRuns(): void {
	const raw = getRawDb();
	const staleSeconds = Math.round(STALE_RUN_TIMEOUT_MS / 1000);
	const now = new Date().toISOString();

	// Find runs stuck in pending/running for longer than the timeout
	const staleRuns = raw
		.prepare(
			`SELECT r.id, r.agent, r.plot_id, r.status
			   FROM runs r
			  WHERE r.status IN ('pending', 'running')
			    AND strftime('%Y-%m-%d %H:%M:%S', r.started_at) <= datetime('now', ?)`,
		)
		.all(`-${staleSeconds} seconds`) as Array<{
		id: string;
		agent: string;
		plot_id: string;
		status: string;
	}>;

	for (const run of staleRuns) {
		log.warn("recovering stale run", {
			runId: run.id,
			agentSlug: run.agent,
			status: run.status,
			staleSeconds,
		});

		// Mark run as failed
		raw
			.prepare(
				`UPDATE runs SET status = 'failed', error_message = 'stale run recovered by dispatcher', ended_at = ?, updated_at = ? WHERE id = ?`,
			)
			.run(now, now, run.id);

		// Reset agent to idle
		raw
			.prepare(
				`UPDATE agent_roster
				    SET status = 'idle',
				        last_run_ended_at = ?,
				        updated_at = ?
				  WHERE slug = ? AND status = 'running'`,
			)
			.run(now, now, run.agent);

		// Reset linked issues back to todo
		raw
			.prepare(
				`UPDATE board_issues SET status = 'todo', updated_at = ? WHERE linked_plot_id = ? AND status = 'in_progress'`,
			)
			.run(now, run.plot_id);

		emit("run:updated", {
			runId: run.id,
			agentId: run.agent,
			status: "failed",
		});
	}

	if (staleRuns.length > 0) {
		log.info("recovered stale runs", { count: staleRuns.length });
	}

	// ── Orphaned issues: in_progress (NOT in_review) with no active run ─
	// in_review means a run completed successfully — don't re-dispatch those.
	const orphaned = raw
		.prepare(
			`SELECT i.id, substr(i.title, 1, 60) AS title, i.linked_plot_id
			   FROM board_issues i
			  WHERE i.status = 'in_progress'
			    AND NOT EXISTS (
			      SELECT 1 FROM runs r
			       WHERE r.plot_id = i.linked_plot_id
			         AND r.status IN ('pending', 'running')
			    )`,
		)
		.all() as Array<{
		id: string;
		title: string;
		linked_plot_id: string | null;
	}>;

	for (const issue of orphaned) {
		log.info("resetting orphaned issue", {
			issueId: issue.id,
			title: issue.title,
		});
		raw
			.prepare(
				`UPDATE board_issues SET status = 'todo', updated_at = ? WHERE id = ?`,
			)
			.run(now, issue.id);
	}

	// ── Orphaned agents: status=running but no active run ───────────────
	raw
		.prepare(
			`UPDATE agent_roster
			    SET status = 'idle', updated_at = ?
			  WHERE status = 'running'
			    AND NOT EXISTS (
			      SELECT 1 FROM runs r WHERE r.agent = agent_roster.slug AND r.status IN ('pending', 'running')
			    )`,
		)
		.run(now);
}

/**
 * Run a single dispatcher pass. Exported for tests.
 */
export async function dispatchOnce(): Promise<DispatchResult> {
	const result: DispatchResult = {
		dispatched: 0,
		skippedNoAgent: 0,
		skippedAtCap: 0,
		perCompany: {},
	};
	const raw = getRawDb();
	const companies = raw.prepare(`SELECT id FROM companies`).all() as Array<{
		id: string;
	}>;

	// Also include the legacy "_pending_default" bucket via getAllSettings()
	// — but for dispatch purposes only real companies count.
	void getAllSettings();

	for (const co of companies) {
		if (!isAutoDispatchEnabled(co.id)) continue;
		const cap = getCompanyMaxParallel(co.id);
		const active = activeRunsForCompany(co.id);
		result.perCompany[co.id] = { dispatched: 0, activeRuns: active, cap };
		if (active >= cap) {
			result.skippedAtCap++;
			continue;
		}

		const agents = idleDeveloperAgents(co.id);
		if (agents.length === 0) {
			const issues = readyIssuesForCompany(co.id, cap - active);
			result.skippedNoAgent += issues.length;
			continue;
		}

		let slots = Math.min(cap - active, agents.length);
		const issues = readyIssuesForCompany(co.id, Math.max(slots * 5, slots));
		if (issues.length === 0) continue;
		let issueIdx = 0;
		const availableAgents = [...agents];
		const projectRunCounts = new Map<string, number>();
		while (
			slots > 0 &&
			issueIdx < issues.length &&
			availableAgents.length > 0
		) {
			const issue = issues[issueIdx];
			issueIdx++;
			if (!issue) break;
			if (slots <= 0) break;
			const policy = getProjectDispatchPolicy(issue.project_id, co.id);
			if (policy.budgetCapUsd > 0 && policy.remainingBudgetUsd <= 0) {
				continue;
			}
			const activeProjectRuns =
				projectRunCounts.get(issue.project_id) ??
				activeRunsForProject(issue.project_id);
			if (activeProjectRuns >= policy.maxParallelRuns) {
				continue;
			}

			// Prefer the agent explicitly assigned to the issue, if it's idle.
			// Skip agents that have already reassigned (declined) this issue.
			let agentIdx = -1;
			if (issue.assigned_agent_id) {
				const preferred = availableAgents.findIndex(
					(a) => a.id === issue.assigned_agent_id,
				);
				if (preferred !== -1) agentIdx = preferred;
			}
			if (agentIdx < 0) {
				// Find first available agent that hasn't declined this issue
				for (let i = 0; i < availableAgents.length; i++) {
					const a = availableAgents[i];
					if (!a) continue;
					const declined = raw
						.prepare(
							`SELECT 1 FROM runs WHERE agent = ? AND outcome = 'reassigned'
							 AND plot_id IN (SELECT linked_plot_id FROM board_issues WHERE id = ?)
							 LIMIT 1`,
						)
						.get(a.slug, issue.id);
					if (!declined) {
						agentIdx = i;
						break;
					}
				}
			}
			if (agentIdx < 0) {
				// All agents declined this issue — skip it
				continue;
			}
			const agent = availableAgents[agentIdx];
			if (!agent) break;
			const created = await createRun(agent, issue);
			if (!created) continue;
			availableAgents.splice(agentIdx, 1);
			const { runId } = created;
			projectRunCounts.set(issue.project_id, activeProjectRuns + 1);
			slots--;
			result.dispatched++;
			const co0 = result.perCompany[co.id];
			if (co0) co0.dispatched++;

			// Refresh the project's sprint board so the pinned message in its
			// channel reflects the just-dispatched run. Best-effort.
			try {
				rebuildSprintBoard(issue.project_id);
			} catch {
				/* ignore */
			}

			// PTY-only adapters (claude, codex, amp, opencode, gemini) cannot run
			// server-side. Leave the run as 'pending' — the desktop Electron app's
			// PTY dispatch poller (apps/desktop/src/main/ipc/pty-dispatch.ts) will
			// pick it up and execute it via node-pty with full coding tools.
			queueRunExecution({
				agent,
				runId,
				issueId: issue.id,
				companyId: co.id,
			});
		}
	}

	for (const co of companies) {
		if (!isAutoDispatchEnabled(co.id)) continue;
		if (readyIssuesForCompany(co.id, 1).length > 0) continue;
		const companyStats = result.perCompany[co.id];
		const cap = companyStats?.cap ?? getCompanyMaxParallel(co.id);
		const active = activeRunsForCompany(co.id);
		const availableSlots = Math.max(0, cap - active);
		if (availableSlots <= 0) continue;
		const continuousAgents = listEligibleContinuousAgents(co.id).slice(
			0,
			availableSlots,
		);
		for (const agent of continuousAgents) {
			const created = await createMonitoringRun(agent, co.id);
			if (!created) continue;
			queueRunExecution({
				agent,
				runId: created.runId,
				companyId: co.id,
				task: created.task,
			});
		}
	}

	// ── Pick up orphaned pending runs (e.g. retries) that aren't being executed ─
	const orphanedPending = raw
		.prepare(
			`SELECT r.id AS run_id, r.agent, r.plot_id,
			        i.id AS issue_id,
			        COALESCE(i.company_id, ar.company_id) AS company_id,
			        ar.adapter_type,
			        c0.content AS task
			   FROM runs r
			   JOIN agent_roster ar ON ar.slug = r.agent
			   LEFT JOIN board_issues i ON i.linked_plot_id = r.plot_id
			   LEFT JOIN chunks c0 ON c0.run_id = r.id AND c0.sequence = 0
			  WHERE r.status = 'pending'
			    AND strftime('%Y-%m-%d %H:%M:%S', r.started_at) <= datetime('now', '-10 seconds')
			  ORDER BY r.started_at ASC
			  LIMIT 8`,
		)
		.all() as Array<{
		run_id: string;
		agent: string;
		plot_id: string;
		issue_id: string | null;
		company_id: string | null;
		adapter_type: string | null;
		task: string | null;
	}>;

	for (const pr of orphanedPending) {
		if (!pr.company_id || PTY_ONLY_ADAPTERS.has(pr.adapter_type ?? ""))
			continue;
		log.info("executing orphaned pending run", {
			runId: pr.run_id,
			agentSlug: pr.agent,
		});
		void spawnServerRun({
			runId: pr.run_id,
			agentSlug: pr.agent,
			issueId: pr.issue_id,
			companyId: pr.company_id,
			task: pr.task,
		}).catch((err) => {
			log.warn("spawnServerRun failed", {
				runId: pr.run_id,
				error: err instanceof Error ? err.message : String(err),
			});
		});
	}

	return result;
}

/**
 * After the main dispatch loop assigns issues to agents, run the autonomous
 * cycle for every company to set up git branches/worktrees and post comments.
 * Best-effort — errors here must not propagate back to the caller.
 */
async function runAutonomousCycles(
	companies: Array<{ id: string }>,
): Promise<void> {
	for (const co of companies) {
		try {
			await autonomousDispatchCycle(co.id);
		} catch (err) {
			log.warn("autonomous dispatch cycle failed", {
				companyId: co.id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}

export interface DispatcherHandle {
	stop: () => void;
	isRunning: () => boolean;
}

export function postVerificationDigest(companyId: string): void {
	const nowMs = Date.now();

	// Persist-safe throttle: check the DB for the last digest message
	// instead of relying on in-memory Map (which resets on server restart).
	const raw = getRawDb();
	const lastDigestRow = raw
		.prepare(
			`SELECT created_at FROM team_messages
			  WHERE from_agent = 'ceo'
			    AND channel = 'general'
			    AND content LIKE '%Verification Digest%'
			  ORDER BY created_at DESC LIMIT 1`,
		)
		.get() as { created_at: string } | undefined;
	if (lastDigestRow) {
		const lastMs = new Date(lastDigestRow.created_at).getTime();
		if (nowMs - lastMs < VERIFICATION_DIGEST_INTERVAL_MS) return;
	}
	const issues = raw
		.prepare(
			`SELECT i.id,
			        i.title,
			        i.pr_url AS prUrl,
			        p.name AS projectName
			   FROM board_issues i
			   LEFT JOIN board_projects p ON p.id = i.project_id
			  WHERE i.company_id = ?
			    AND i.status = 'in_review'
			  ORDER BY COALESCE(i.updated_at, i.created_at) ASC`,
		)
		.all(companyId) as Array<{
		id: string;
		title: string;
		prUrl: string | null;
		projectName: string | null;
	}>;
	if (issues.length === 0) return;

	const header = `📋 Daily Verification Digest: ${issues.length} issue${issues.length === 1 ? "" : "s"} awaiting review`;
	const content = [
		header,
		"",
		...issues.map((issue) => {
			const projectPrefix = issue.projectName ? `[${issue.projectName}] ` : "";
			const prSuffix = issue.prUrl ? ` — ${issue.prUrl}` : "";
			return `- ${projectPrefix}${issue.title}${prSuffix}`;
		}),
	].join("\n");
	const messageId = crypto.randomUUID();
	const createdAt = new Date(nowMs).toISOString();

	raw
		.prepare(
			`INSERT INTO team_messages (id, plot_id, from_agent, channel, content, sequence, created_at)
		     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
		)
		.run(messageId, "ceo", "general", content, nowMs, createdAt);
	try {
		raw
			.prepare(`UPDATE team_messages SET company_id = ? WHERE id = ?`)
			.run(companyId, messageId);
	} catch {
		/* column may be absent on legacy DBs */
	}
	lastDigestAt.set(companyId, nowMs);
	emit("team:message", {
		id: messageId,
		channel: "general",
		fromAgent: "ceo",
		companyId,
	});
}

function getDispatcherStartupSnapshot(): {
	agents: number;
	pendingIssues: number;
} {
	const raw = getRawDb();
	const companies = raw.prepare(`SELECT id FROM companies`).all() as Array<{
		id: string;
	}>;
	const enabledCompanyIds = companies
		.map((company) => company.id)
		.filter((companyId) => isAutoDispatchEnabled(companyId));
	if (enabledCompanyIds.length === 0) {
		return { agents: 0, pendingIssues: 0 };
	}
	const placeholders = enabledCompanyIds.map(() => "?").join(", ");
	const agentRow = raw
		.prepare(
			`SELECT COUNT(*) AS c FROM agent_roster WHERE is_active = 1 AND company_id IN (${placeholders})`,
		)
		.get(...enabledCompanyIds) as { c: number } | undefined;
	const issueRow = raw
		.prepare(
			`SELECT COUNT(*) AS c FROM board_issues WHERE company_id IN (${placeholders}) AND status IN ('todo', 'backlog')`,
		)
		.get(...enabledCompanyIds) as { c: number } | undefined;
	return {
		agents: agentRow?.c ?? 0,
		pendingIssues: issueRow?.c ?? 0,
	};
}

let dispatcherProcessorRegistered = false;

async function runDispatcherCycle(reason = "interval"): Promise<void> {
	if (!_running || _ticking) return;
	_ticking = true;
	try {
		recoverStaleRuns();
		await dispatchOnce();
		const raw2 = getRawDb();
		const cos = raw2.prepare(`SELECT id FROM companies`).all() as Array<{
			id: string;
		}>;
		void runAutonomousCycles(cos).catch(() => {
			/* best-effort */
		});
		for (const company of cos) {
			await checkScheduledRoutines(company.id);
			postVerificationDigest(company.id);
			triggerIdleConversation(company.id).catch(() => {
				/* best-effort */
			});
		}
	} catch (err) {
		log.error("dispatcher tick failed", {
			reason,
			error: err instanceof Error ? err.message : String(err),
		});
	} finally {
		_ticking = false;
	}
}

function registerDispatcherQueueProcessor(): void {
	if (dispatcherProcessorRegistered) return;
	dispatcherProcessorRegistered = true;
	jobQueue.process("pipeline", async (job) => {
		const payload = job.payload as { kind?: string; reason?: string };
		if (payload.kind !== "dispatch") return { skipped: true };
		await runDispatcherCycle(payload.reason ?? "scheduled");
		return { ok: true };
	});
}

function scheduleNextDispatch(intervalMs: number): void {
	if (!_running) return;
	_timer = setTimeout(() => {
		jobQueue.add(
			"pipeline",
			{ kind: "dispatch", reason: "interval" },
			{
				priority: 2,
				maxAttempts: 1,
			},
		);
		scheduleNextDispatch(intervalMs);
	}, intervalMs);
	if (typeof (_timer as { unref?: () => void }).unref === "function") {
		(_timer as { unref: () => void }).unref();
	}
}

export function startDispatcher(
	opts: { intervalMs?: number } = {},
): DispatcherHandle {
	if (_timer) stopDispatcher();
	const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
	_running = true;
	registerDispatcherQueueProcessor();

	registerDispatcherTickHandler((reason) => {
		jobQueue.add(
			"pipeline",
			{ kind: "dispatch", reason: reason ?? "scheduled" },
			{
				priority: 0,
				maxAttempts: 1,
			},
		);
	});
	const snapshot = getDispatcherStartupSnapshot();
	log.info("dispatcher started", {
		agents: snapshot.agents,
		pendingIssues: snapshot.pendingIssues,
	});

	jobQueue.add(
		"pipeline",
		{ kind: "dispatch", reason: "startup" },
		{
			priority: 0,
			maxAttempts: 1,
		},
	);
	scheduleNextDispatch(intervalMs);

	return { stop: stopDispatcher, isRunning: () => _running };
}

export function stopDispatcher(): void {
	if (_timer) clearTimeout(_timer);
	_timer = null;
	_running = false;
	registerDispatcherTickHandler(null);
}
