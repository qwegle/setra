/**
 * costs.repo.ts — Repository for cost tracking queries
 */

import { getRawDb } from "@setra/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RunBasic {
	costUsd: number | null;
	startedAt: string;
}

export interface AgentCostRow {
	agent: string | null;
	totalCostUsd: number;
	promptTokens: number;
	completionTokens: number;
	runCount: number;
}

export interface ProjectCostRow {
	projectId: string;
	projectName: string;
	totalCostUsd: number;
	promptTokens: number;
	completionTokens: number;
	runCount: number;
}

export interface BudgetLimitRow {
	id: string;
	limitUsd: number | null;
	periodDays: number | null;
	agentSlug: string | null;
	agentId: string | null;
	projectId: string | null;
	alertPercent: number | null;
	companyId: string;
	createdAt: string;
	updatedAt: string | null;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getMtdRuns(
	mtdStart: string,
	companyId: string,
): Promise<RunBasic[]> {
	return getRawDb()
		.prepare(
			`SELECT
r.cost_usd as costUsd,
r.started_at as startedAt
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?
ORDER BY r.started_at ASC`,
		)
		.all(companyId, mtdStart) as RunBasic[];
}

export async function getAgentCostsMtd(
	mtdStart: string,
	companyId: string,
): Promise<AgentCostRow[]> {
	return getRawDb()
		.prepare(
			`SELECT
r.agent as agent,
coalesce(sum(coalesce(r.cost_usd, 0)), 0) as totalCostUsd,
coalesce(sum(coalesce(r.prompt_tokens, 0)), 0) as promptTokens,
coalesce(sum(coalesce(r.completion_tokens, 0)), 0) as completionTokens,
count(*) as runCount
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?
GROUP BY r.agent
ORDER BY totalCostUsd DESC`,
		)
		.all(companyId, mtdStart) as AgentCostRow[];
}

export async function getProjectCostsMtd(
	mtdStart: string,
	companyId: string,
): Promise<ProjectCostRow[]> {
	return getRawDb()
		.prepare(
			`SELECT
bp.id as projectId,
bp.name as projectName,
coalesce(sum(coalesce(r.cost_usd, 0)), 0) as totalCostUsd,
coalesce(sum(coalesce(r.prompt_tokens, 0)), 0) as promptTokens,
coalesce(sum(coalesce(r.completion_tokens, 0)), 0) as completionTokens,
count(*) as runCount
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?
GROUP BY bp.id, bp.name
ORDER BY totalCostUsd DESC`,
		)
		.all(companyId, mtdStart) as ProjectCostRow[];
}

export async function getBudgetLimits(
	companyId: string,
): Promise<BudgetLimitRow[]> {
	return getRawDb()
		.prepare(
			`SELECT
b.id as id,
b.limit_usd as limitUsd,
b.period_days as periodDays,
b.agent_slug as agentSlug,
ar.id as agentId,
b.project_id as projectId,
b.alert_percent as alertPercent,
b.company_id as companyId,
b.created_at as createdAt,
b.updated_at as updatedAt
 FROM board_budget_limits b
 LEFT JOIN agent_roster ar
   ON ar.slug = b.agent_slug
  AND ar.company_id = b.company_id
WHERE b.company_id = ?
  AND b.agent_slug IS NOT NULL
ORDER BY b.agent_slug`,
		)
		.all(companyId) as BudgetLimitRow[];
}

export async function getAgentUsedUsd(
	agentSlug: string,
	startDate: Date,
	companyId: string,
): Promise<number> {
	const row = getRawDb()
		.prepare(
			`SELECT coalesce(sum(coalesce(r.cost_usd, 0)), 0) as sum
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.agent = ?
  AND r.started_at >= ?`,
		)
		.get(companyId, agentSlug, startDate.toISOString()) as
		| { sum?: number }
		| undefined;
	return Number(row?.sum ?? 0);
}

export async function getTotalUsedUsd(
	startDate: Date,
	companyId: string,
): Promise<number> {
	const row = getRawDb()
		.prepare(
			`SELECT coalesce(sum(coalesce(r.cost_usd, 0)), 0) as sum
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?`,
		)
		.get(companyId, startDate.toISOString()) as { sum?: number } | undefined;
	return Number(row?.sum ?? 0);
}

export async function getExistingBudgetByAgent(
	agentSlug: string,
	companyId: string,
): Promise<{ id: string } | undefined> {
	return getRawDb()
		.prepare(
			`SELECT id
 FROM board_budget_limits
WHERE company_id = ?
  AND agent_slug = ?
LIMIT 1`,
		)
		.get(companyId, agentSlug) as { id: string } | undefined;
}

export async function updateAgentBudget(
	agentSlug: string,
	companyId: string,
	params: {
		limitUsd?: number;
		periodDays?: number;
		alertPercent?: number;
	},
) {
	const updates: string[] = ["updated_at = ?"];
	const values: unknown[] = [new Date().toISOString()];
	if (params.limitUsd !== undefined) {
		updates.push("limit_usd = ?");
		values.push(params.limitUsd);
	}
	if (params.periodDays !== undefined) {
		updates.push("period_days = ?");
		values.push(params.periodDays);
	}
	if (params.alertPercent !== undefined) {
		updates.push("alert_percent = ?");
		values.push(params.alertPercent);
	}
	values.push(companyId, agentSlug);

	getRawDb()
		.prepare(
			`UPDATE board_budget_limits
    SET ${updates.join(", ")}
  WHERE company_id = ?
    AND agent_slug = ?`,
		)
		.run(...values);

	return getRawDb()
		.prepare(
			`SELECT *
 FROM board_budget_limits
WHERE company_id = ?
  AND agent_slug = ?
LIMIT 1`,
		)
		.get(companyId, agentSlug);
}

export async function createAgentBudget(
	agentSlug: string,
	companyId: string,
	params: {
		limitUsd?: number;
		periodDays?: number;
		alertPercent?: number;
	},
) {
	const now = new Date().toISOString();
	getRawDb()
		.prepare(
			`INSERT INTO board_budget_limits (
id,
company_id,
agent_slug,
limit_usd,
period_days,
alert_percent,
created_at,
updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			crypto.randomUUID(),
			companyId,
			agentSlug,
			params.limitUsd ?? 0,
			params.periodDays ?? 30,
			params.alertPercent ?? 80,
			now,
			now,
		);

	return getRawDb()
		.prepare(
			`SELECT *
 FROM board_budget_limits
WHERE company_id = ?
  AND agent_slug = ?
LIMIT 1`,
		)
		.get(companyId, agentSlug);
}

export function getModelSpendMtd(
	mtdStart: string,
	companyId: string,
): Array<{ model: string | null; cost: number }> {
	return getRawDb()
		.prepare(
			`SELECT
r.agent_version as model,
coalesce(sum(coalesce(r.cost_usd, 0)), 0) as cost
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?
GROUP BY r.agent_version`,
		)
		.all(companyId, mtdStart) as Array<{ model: string | null; cost: number }>;
}
