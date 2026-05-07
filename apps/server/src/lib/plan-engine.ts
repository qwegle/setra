import crypto from "node:crypto";
import { IssuesService } from "@setra/application";
import { getRawDb } from "@setra/db";
import {
	SqliteIssuesRepository,
	requireTenantScope,
} from "@setra/infrastructure";
import { domainEventBus } from "../sse/handler.js";
import { dispatchPlan } from "./dispatcher.js";
import { addAutomationIssueComment } from "./issue-comments.js";
import { createLogger } from "./logger.js";
import { spawnServerRun } from "./run-orchestrator.js";
import { buildSopPipeline } from "./sop-pipeline.js";

export interface Plan {
	id: string;
	issueId: string;
	companyId: string;
	title: string;
	approach: string;
	subtasks: PlanSubtask[];
	status: "draft" | "pending_approval" | "approved" | "rejected" | "executing";
	createdBy: string;
	feedback: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PlanSubtask {
	id: string;
	title: string;
	description: string;
	assignTo: "cto" | "dev" | "auto";
	priority: number;
	dependsOn: string[];
	status: "pending" | "in_progress" | "done";
	issueId?: string | undefined;
}

interface PlanIssueRow {
	id: string;
	title: string;
	description: string | null;
	project_id: string;
	company_id: string | null;
	linked_plot_id: string | null;
	branch_name: string | null;
	labels: string | null;
}

interface PlanRow {
	id: string;
	issue_id: string;
	company_id: string;
	title: string;
	approach: string | null;
	subtasks: string;
	status: Plan["status"];
	created_by: string | null;
	feedback: string | null;
	created_at: string;
	updated_at: string;
}

const log = createLogger("plan-engine");
const issuesService = new IssuesService(
	new SqliteIssuesRepository(),
	domainEventBus,
);

function loadIssue(issueId: string): PlanIssueRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT id, title, description, project_id, company_id, linked_plot_id, branch_name, labels
				   FROM board_issues
				  WHERE id = ?`,
			)
			.get(issueId) as PlanIssueRow | undefined) ?? null
	);
}

function normalizeAssignTo(value: unknown): PlanSubtask["assignTo"] {
	const normalized = String(value ?? "auto")
		.trim()
		.toLowerCase();
	if (normalized === "cto" || normalized === "dev") return normalized;
	return "auto";
}

function normalizePlanSubtask(
	value: unknown,
	index: number,
): PlanSubtask | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const title = String(raw.title ?? "").trim();
	if (!title) return null;
	const description = String(raw.description ?? "").trim() || title;
	const dependsOn = Array.isArray(raw.dependsOn)
		? raw.dependsOn.map((item) => String(item ?? "").trim()).filter(Boolean)
		: [];
	const status = String(raw.status ?? "pending")
		.trim()
		.toLowerCase();
	return {
		id:
			String(raw.id ?? `subtask-${index + 1}`).trim() || `subtask-${index + 1}`,
		title,
		description,
		assignTo: normalizeAssignTo(raw.assignTo),
		priority: Number(raw.priority ?? index + 1) || index + 1,
		dependsOn,
		status:
			status === "done"
				? "done"
				: status === "in_progress"
					? "in_progress"
					: "pending",
		issueId:
			typeof raw.issueId === "string" && raw.issueId.trim().length > 0
				? raw.issueId.trim()
				: undefined,
	};
}

function stripComplexityMarker(agentOutput: string): string {
	return agentOutput.replace(/\[COMPLEXITY:\s*(XS|S|M|L|XL)\]/i, "").trim();
}

function extractJsonPlan(agentOutput: string): Record<string, unknown> | null {
	const fencedBlocks = [
		...agentOutput.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi),
	];
	for (const match of fencedBlocks) {
		const block = (match[1] ?? "").replace(/^PLAN_JSON\s*/i, "").trim();
		if (!block) continue;
		try {
			const parsed = JSON.parse(block) as Record<string, unknown>;
			if (Array.isArray(parsed.subtasks)) return parsed;
		} catch {
			/* try next block */
		}
	}
	const start = agentOutput.indexOf("{");
	const end = agentOutput.lastIndexOf("}");
	if (start >= 0 && end > start) {
		try {
			const parsed = JSON.parse(agentOutput.slice(start, end + 1)) as Record<
				string,
				unknown
			>;
			if (Array.isArray(parsed.subtasks)) return parsed;
		} catch {
			/* fall through */
		}
	}
	return null;
}

function fallbackPlanDraft(
	issue: PlanIssueRow,
	agentOutput: string,
): {
	title: string;
	approach: string;
	subtasks: PlanSubtask[];
} {
	const lines = agentOutput
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const bulletLines = lines.filter((line) => /^([-*]|\d+\.)\s+/.test(line));
	const subtasks = (bulletLines.length > 0 ? bulletLines : lines.slice(0, 5))
		.map((line, index) => {
			const content = line.replace(/^([-*]|\d+\.)\s+/, "").trim();
			if (!content) return null;
			const lowered = content.toLowerCase();
			return {
				id: `subtask-${index + 1}`,
				title: content.slice(0, 120),
				description: content,
				assignTo: (lowered.includes("architect") ||
				lowered.includes("security") ||
				lowered.includes("cto")
					? "cto"
					: "dev") as PlanSubtask["assignTo"],
				priority: index + 1,
				dependsOn: index === 0 ? [] : [`subtask-${index}`],
				status: "pending" as const,
			};
		})
		.filter((item): item is Exclude<typeof item, null> => item !== null);
	return {
		title: issue.title,
		approach:
			agentOutput.trim().slice(0, 2000) || issue.description || issue.title,
		subtasks:
			subtasks.length > 0
				? subtasks
				: [
						{
							id: "subtask-1",
							title: issue.title,
							description: issue.description ?? issue.title,
							assignTo: "dev",
							priority: 1,
							dependsOn: [],
							status: "pending",
						},
					],
	};
}

function parsePlanDraft(issue: PlanIssueRow, agentOutput: string) {
	const normalizedOutput = stripComplexityMarker(agentOutput);
	const parsed = extractJsonPlan(normalizedOutput);
	if (!parsed) return fallbackPlanDraft(issue, normalizedOutput);
	const subtasks = Array.isArray(parsed.subtasks)
		? parsed.subtasks
				.map((item, index) => normalizePlanSubtask(item, index))
				.filter((item): item is Exclude<typeof item, null> => item !== null)
		: [];
	if (subtasks.length === 0) return fallbackPlanDraft(issue, normalizedOutput);
	return {
		title: String(parsed.title ?? issue.title).trim() || issue.title,
		approach:
			String(parsed.approach ?? "").trim() ||
			agentOutput.trim().slice(0, 2000) ||
			issue.description ||
			issue.title,
		subtasks,
	};
}

function renderSopArtifactComment(heading: string, body: string): string {
	return `${heading}\n\n${body}`.trim();
}

function renderPlanComment(plan: Plan): string {
	const lines = [
		"## Plan Awaiting Approval",
		`**${plan.title}**`,
		"",
		plan.approach,
		"",
		"### Subtasks",
		...plan.subtasks
			.sort((left, right) => left.priority - right.priority)
			.map((subtask) => {
				const dependencyText =
					subtask.dependsOn.length > 0
						? ` — depends on ${subtask.dependsOn.join(", ")}`
						: "";
				return `${subtask.priority}. **${subtask.title}** _(assign: ${subtask.assignTo})_${dependencyText}\n   ${subtask.description}`;
			}),
		"",
		"Approve this plan in the Approvals view to start execution.",
	];
	return lines.join("\n");
}

function syncSubtaskStatuses(plan: Plan): Plan {
	const db = getRawDb();
	let changed = false;
	const subtasks = plan.subtasks.map((subtask) => {
		if (!subtask.issueId) return subtask;
		const row = db
			.prepare(`SELECT status FROM board_issues WHERE id = ?`)
			.get(subtask.issueId) as { status: string } | undefined;
		if (!row) return subtask;
		const nextStatus: PlanSubtask["status"] =
			row.status === "done"
				? "done"
				: row.status === "in_progress" || row.status === "in_review"
					? "in_progress"
					: "pending";
		if (nextStatus === subtask.status) return subtask;
		changed = true;
		return { ...subtask, status: nextStatus };
	});
	if (!changed) return plan;
	const updated = {
		...plan,
		subtasks,
		updatedAt: new Date().toISOString(),
	};
	db.prepare(`UPDATE plans SET subtasks = ?, updated_at = ? WHERE id = ?`).run(
		JSON.stringify(subtasks),
		updated.updatedAt,
		updated.id,
	);
	return updated;
}

function hydratePlan(row: PlanRow): Plan {
	const parsed = (() => {
		try {
			return JSON.parse(row.subtasks) as unknown;
		} catch {
			return [];
		}
	})();
	const subtasks = Array.isArray(parsed)
		? parsed
				.map((item, index) => normalizePlanSubtask(item, index))
				.filter((item): item is PlanSubtask => item !== null)
		: [];
	return syncSubtaskStatuses({
		id: row.id,
		issueId: row.issue_id,
		companyId: row.company_id,
		title: row.title,
		approach: row.approach ?? "",
		subtasks,
		status: row.status,
		createdBy: row.created_by ?? "ceo",
		feedback: row.feedback,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function loadPlanRow(planId: string): PlanRow | null {
	return (
		(getRawDb().prepare(`SELECT * FROM plans WHERE id = ?`).get(planId) as
			| PlanRow
			| undefined) ?? null
	);
}

function findCeoAgent(companyId: string): { id: string; slug: string } | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT id, slug
				   FROM agent_roster
				  WHERE company_id = ?
				    AND is_active = 1
				    AND (lower(slug) LIKE '%ceo%' OR lower(display_name) LIKE '%ceo%')
				  ORDER BY created_at ASC
				  LIMIT 1`,
			)
			.get(companyId) as { id: string; slug: string } | undefined) ?? null
	);
}

function mergeIssueLabel(existing: string | null, label: string): string {
	const values = new Set(
		(existing ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	values.add(label);
	return [...values].join(", ");
}

function removeIssueLabel(existing: string | null, label: string): string {
	return (existing ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value && value !== label)
		.join(", ");
}

export async function listPlans(
	companyId: string,
	filters: { issueId?: string | undefined; status?: string | undefined } = {},
): Promise<Plan[]> {
	const clauses = ["company_id = ?"];
	const params: unknown[] = [companyId];
	if (filters.issueId) {
		clauses.push("issue_id = ?");
		params.push(filters.issueId);
	}
	if (filters.status) {
		clauses.push("status = ?");
		params.push(filters.status);
	}
	const rows = getRawDb()
		.prepare(
			`SELECT * FROM plans WHERE ${clauses.join(" AND ")} ORDER BY CASE status WHEN 'pending_approval' THEN 0 WHEN 'executing' THEN 1 ELSE 2 END, created_at DESC`,
		)
		.all(...params) as PlanRow[];
	return rows.map(hydratePlan);
}

export async function getPlanById(planId: string): Promise<Plan | null> {
	const row = loadPlanRow(planId);
	return row ? hydratePlan(row) : null;
}

export async function createPlan(
	issueId: string,
	agentOutput: string,
): Promise<Plan> {
	const issue = loadIssue(issueId);
	if (!issue?.company_id)
		throw new Error("Issue not found or not company scoped");
	const draft = parsePlanDraft(issue, agentOutput);
	const sopPipeline = buildSopPipeline({
		title: issue.title,
		description: issue.description,
		agentOutput,
		planTitle: draft.title,
		planApproach: draft.approach,
		subtasks: draft.subtasks,
	});
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT INTO plans (id, issue_id, company_id, title, approach, subtasks, status, created_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 'pending_approval', 'ceo', ?, ?)`,
		)
		.run(
			id,
			issue.id,
			issue.company_id,
			draft.title,
			draft.approach,
			JSON.stringify(draft.subtasks),
			now,
			now,
		);
	getRawDb()
		.prepare(
			`UPDATE board_issues
			    SET status = 'blocked',
			        labels = ?,
			        updated_at = ?
			  WHERE id = ?`,
		)
		.run(mergeIssueLabel(issue.labels, "planning"), now, issue.id);
	const plan = await getPlanById(id);
	if (!plan) throw new Error("Failed to create plan");
	for (const artifact of sopPipeline.artifacts) {
		addAutomationIssueComment(
			issue.id,
			issue.company_id,
			renderSopArtifactComment(artifact.heading, artifact.body),
			artifact.phase.role,
		);
	}
	addAutomationIssueComment(
		issue.id,
		issue.company_id,
		renderPlanComment({
			...plan,
			approach: `${plan.approach}\n\n**SOP Complexity:** ${sopPipeline.complexity}`,
		}),
		"ceo",
	);
	return plan;
}

export async function approvePlan(planId: string): Promise<void> {
	const plan = await getPlanById(planId);
	if (!plan) throw new Error("Plan not found");
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE plans SET status = 'approved', updated_at = ? WHERE id = ?`,
		)
		.run(now, planId);
	await executePlan({ ...plan, status: "approved", updatedAt: now });
}

export async function rejectPlan(
	planId: string,
	feedback: string,
): Promise<void> {
	const plan = await getPlanById(planId);
	if (!plan) throw new Error("Plan not found");
	const issue = loadIssue(plan.issueId);
	if (!issue?.company_id) throw new Error("Issue not found");
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE plans
			    SET status = 'rejected', feedback = ?, updated_at = ?
			  WHERE id = ?`,
		)
		.run(feedback || null, now, planId);
	addAutomationIssueComment(
		plan.issueId,
		issue.company_id,
		`❌ Plan rejected. ${feedback ? `Feedback: ${feedback}` : "Please revise and resubmit."}`,
		"human",
	);
	const ceo = findCeoAgent(issue.company_id);
	if (!ceo || !issue.linked_plot_id) return;
	const runId = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, branch_name, agent_args, status, started_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
		)
		.run(
			runId,
			issue.linked_plot_id,
			ceo.slug,
			issue.branch_name,
			JSON.stringify({ kind: "plan_revision", planId }),
			now,
			now,
		);
	await spawnServerRun({
		runId,
		agentSlug: ceo.slug,
		issueId: issue.id,
		companyId: issue.company_id,
		task: `Revise the execution plan for issue ${issue.id}. The human rejected the previous plan. Feedback:\n\n${feedback || "No extra feedback supplied."}\n\nProduce a replacement plan in PLAN_JSON format only; do not execute the work.`,
	});
}

export async function executePlan(plan: Plan): Promise<void> {
	const issue = loadIssue(plan.issueId);
	if (!issue?.company_id) throw new Error("Issue not found");
	const scope = requireTenantScope(issue.company_id);
	const nextSubtasks: PlanSubtask[] = [];
	for (const subtask of plan.subtasks.sort(
		(left, right) => left.priority - right.priority,
	)) {
		if (subtask.issueId) {
			nextSubtasks.push(subtask);
			continue;
		}
		const created = await issuesService.createIssue(scope, {
			projectId: issue.project_id,
			title: subtask.title,
			description: subtask.description,
			priority:
				subtask.priority <= 1
					? "high"
					: subtask.priority >= 4
						? "low"
						: "medium",
			parentIssueId: issue.id,
			status: "backlog",
		});
		if (!created.issue) {
			log.warn("failed to create plan sub-issue", {
				planId: plan.id,
				subtaskId: subtask.id,
			});
			nextSubtasks.push(subtask);
			continue;
		}
		nextSubtasks.push({
			...subtask,
			issueId: created.issue.id,
			status: "pending",
		});
	}
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`UPDATE plans
			    SET status = 'executing', subtasks = ?, updated_at = ?
			  WHERE id = ?`,
		)
		.run(JSON.stringify(nextSubtasks), now, plan.id);
	getRawDb()
		.prepare(
			`UPDATE board_issues
			    SET status = 'in_progress', labels = ?, updated_at = ?
			  WHERE id = ?`,
		)
		.run(removeIssueLabel(issue.labels, "planning"), now, issue.id);
	addAutomationIssueComment(
		issue.id,
		issue.company_id,
		`✅ Plan approved. Executing ${nextSubtasks.length} subtask${nextSubtasks.length === 1 ? "" : "s"}.`,
		"setra",
	);
	await dispatchPlan({
		...plan,
		subtasks: nextSubtasks,
		status: "executing",
		updatedAt: now,
	});
}
