/**
 * goal-engine.ts — decompose a Setra goal into an issue tree.
 *
 * A "goal" (schema.ts: goals) is the highest-level unit of work in Setra.
 * The CEO agent or the operator can mark a goal as ready, at which point
 * the dispatcher hook (see dispatcher.ts) calls decomposeGoal to expand
 * the goal into:
 *
 *   - one root issue per goal (status='backlog')
 *   - one child issue per parsed subtask (parent = root issue)
 *
 * The decomposition is intentionally heuristic-only — no LLM call — so it
 * is cheap and deterministic. A subsequent CEO planning run can refine
 * the tree if needed.
 *
 * The function is idempotent: re-running for a goal that already has an
 * issue tree does nothing (we record the root issue id on the goal via
 * description annotation).
 */

import { randomUUID } from "node:crypto";
import { IssuesService } from "@setra/application";
import { getRawDb } from "@setra/db";
import {
	SqliteIssuesRepository,
	requireTenantScope,
} from "@setra/infrastructure";
import { domainEventBus } from "../sse/handler.js";
import { createLogger } from "./logger.js";

const log = createLogger("goal-engine");

const issuesService = new IssuesService(
	new SqliteIssuesRepository(),
	domainEventBus,
);

export interface DecomposeGoalResult {
	rootIssueId: string;
	rootIssueSlug: string;
	subIssueIds: string[];
	alreadyDecomposed: boolean;
}

interface GoalRow {
	id: string;
	company_id: string | null;
	title: string;
	description: string | null;
	status: string;
}

interface ProjectRow {
	id: string;
}

const SUBTASK_LINE = /^\s*(?:[-*]\s+|\d+[.)]\s+)(.+?)\s*$/;
const ROOT_ANNOTATION_RE = /\nrootIssueId:\s*([0-9a-f-]{36})/i;

function pickDefaultProject(companyId: string): ProjectRow | null {
	const row = getRawDb()
		.prepare(
			`SELECT id FROM board_projects WHERE company_id = ? ORDER BY created_at ASC LIMIT 1`,
		)
		.get(companyId) as ProjectRow | undefined;
	return row ?? null;
}

function parseSubtasks(description: string | null): string[] {
	if (!description) return [];
	const out: string[] = [];
	for (const line of description.split(/\r?\n/)) {
		const m = line.match(SUBTASK_LINE);
		if (m && m[1] && m[1].length >= 4) out.push(m[1].trim());
	}
	return out.slice(0, 25);
}

function loadGoal(goalId: string): GoalRow | null {
	const row = getRawDb()
		.prepare(
			`SELECT id, company_id, title, description, status FROM goals WHERE id = ?`,
		)
		.get(goalId) as GoalRow | undefined;
	return row ?? null;
}

function annotateGoalWithRootIssue(
	goalId: string,
	rootIssueId: string,
): void {
	const goal = loadGoal(goalId);
	if (!goal) return;
	const annotation = `\nrootIssueId: ${rootIssueId}`;
	const next = (goal.description ?? "") + annotation;
	getRawDb()
		.prepare(
			`UPDATE goals SET description = ?, status = 'decomposed', updated_at = ? WHERE id = ?`,
		)
		.run(next, new Date().toISOString(), goalId);
}

function findExistingRootIssue(goal: GoalRow): string | null {
	const match = goal.description?.match(ROOT_ANNOTATION_RE);
	if (match) return match[1] ?? null;
	return null;
}

export async function decomposeGoal(
	goalId: string,
): Promise<DecomposeGoalResult> {
	const goal = loadGoal(goalId);
	if (!goal) throw new Error(`goal ${goalId} not found`);
	if (!goal.company_id) {
		throw new Error(
			`goal ${goalId} has no companyId — cannot decompose without tenant scope`,
		);
	}
	const existingRoot = findExistingRootIssue(goal);
	if (existingRoot) {
		log.info("goal already decomposed", { goalId, rootIssueId: existingRoot });
		return {
			rootIssueId: existingRoot,
			rootIssueSlug: "",
			subIssueIds: [],
			alreadyDecomposed: true,
		};
	}

	const project = pickDefaultProject(goal.company_id);
	if (!project) {
		throw new Error(
			`company ${goal.company_id} has no projects — cannot decompose goal ${goalId}`,
		);
	}

	const scope = requireTenantScope(goal.company_id);
	const subtaskLines = parseSubtasks(goal.description);

	const rootResult = await issuesService.createIssue(scope, {
		projectId: project.id,
		title: goal.title,
		description: goal.description ?? `Goal: ${goal.title}`,
		priority: "medium",
		status: "backlog",
	});
	if (!rootResult.issue) {
		throw new Error(`failed to create root issue for goal ${goalId}`);
	}

	const subIssueIds: string[] = [];
	for (const line of subtaskLines) {
		const sub = await issuesService.createIssue(scope, {
			projectId: project.id,
			title: line,
			description: `Sub-task of goal "${goal.title}".`,
			priority: "medium",
			parentIssueId: rootResult.issue.id,
			status: "backlog",
		});
		if (sub.issue) subIssueIds.push(sub.issue.id);
	}

	getRawDb()
		.prepare(
			`INSERT INTO activity_log (id, issue_id, company_id, actor, event, payload, reason, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			randomUUID(),
			rootResult.issue.id,
			goal.company_id,
			"goal-engine",
			"goal_decomposed",
			JSON.stringify({
				goalId,
				rootIssueId: rootResult.issue.id,
				subIssueIds,
			}),
			"Goal decomposed into an issue tree",
			new Date().toISOString(),
		);

	annotateGoalWithRootIssue(goalId, rootResult.issue.id);

	log.info("goal decomposed", {
		goalId,
		rootIssueId: rootResult.issue.id,
		subIssueCount: subIssueIds.length,
	});

	return {
		rootIssueId: rootResult.issue.id,
		rootIssueSlug: rootResult.issue.slug,
		subIssueIds,
		alreadyDecomposed: false,
	};
}

/**
 * Find goals marked status='ready' and decompose them. Called from
 * dispatchOnce as part of every dispatcher pass. Safe to call repeatedly
 * — decomposeGoal is idempotent and updates the goal to status='decomposed'.
 */
export async function decomposeReadyGoals(): Promise<{
	processed: number;
	failed: number;
}> {
	const rows = getRawDb()
		.prepare(`SELECT id FROM goals WHERE status = 'ready' LIMIT 25`)
		.all() as Array<{ id: string }>;
	let processed = 0;
	let failed = 0;
	for (const row of rows) {
		try {
			await decomposeGoal(row.id);
			processed += 1;
		} catch (error) {
			failed += 1;
			log.warn("decomposeGoal failed", {
				goalId: row.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { processed, failed };
}
