/**
 * budget.repo.ts — Repository for budget-related data access
 */

import { getRawDb } from "@setra/db";
import { getCanonicalModelPricing } from "../lib/model-pricing.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetTotals {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCostUsd: number;
}

export interface CostAggregate {
	cost: number;
}

export interface TopAgentEntry {
	slug: string | null;
	model: string | null;
	costUsd: number;
}

function normalizeBudgetTotals(
	row: Partial<BudgetTotals> | undefined,
): BudgetTotals | undefined {
	if (!row) return undefined;
	return {
		totalInputTokens: Number(row.totalInputTokens ?? 0),
		totalOutputTokens: Number(row.totalOutputTokens ?? 0),
		totalCacheReadTokens: Number(row.totalCacheReadTokens ?? 0),
		totalCostUsd: Number(row.totalCostUsd ?? 0),
	};
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getMonthlyTotals(
	since: Date,
	companyId: string,
): Promise<BudgetTotals | undefined> {
	const row = getRawDb()
		.prepare(
			`SELECT
coalesce(sum(coalesce(r.prompt_tokens, 0)), 0) as totalInputTokens,
coalesce(sum(coalesce(r.completion_tokens, 0)), 0) as totalOutputTokens,
coalesce(sum(coalesce(r.cache_read_tokens, 0)), 0) as totalCacheReadTokens,
coalesce(sum(coalesce(r.cost_usd, 0)), 0) as totalCostUsd
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?`,
		)
		.get(companyId, since.toISOString()) as Partial<BudgetTotals> | undefined;
	return normalizeBudgetTotals(row);
}

export async function getCostSince(
	since: Date,
	companyId: string,
): Promise<CostAggregate | undefined> {
	const row = getRawDb()
		.prepare(
			`SELECT coalesce(sum(coalesce(r.cost_usd, 0)), 0) as cost
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?`,
		)
		.get(companyId, since.toISOString()) as { cost?: number } | undefined;
	return { cost: Number(row?.cost ?? 0) };
}

export async function getTopAgents(
	since: Date,
	companyId: string,
	limit = 5,
): Promise<TopAgentEntry[]> {
	return getRawDb()
		.prepare(
			`SELECT
r.agent as slug,
r.agent_version as model,
coalesce(sum(coalesce(r.cost_usd, 0)), 0) as costUsd
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?
GROUP BY r.agent, r.agent_version
ORDER BY costUsd DESC
LIMIT ?`,
		)
		.all(companyId, since.toISOString(), limit) as TopAgentEntry[];
}

export async function getGlobalBudgetLimit(companyId: string) {
	return getRawDb()
		.prepare(
			`SELECT
 id,
 limit_usd as limitUsd,
 period_days as periodDays,
 alert_percent as alertPercent
 FROM board_budget_limits
WHERE company_id = ?
  AND project_id IS NULL
  AND agent_slug IS NULL
LIMIT 1`,
		)
		.get(companyId) as
		| {
				id: string;
				limitUsd: number;
				periodDays: number;
				alertPercent: number;
		  }
		| undefined;
}

export async function getGlobalBudgetSettings(companyId: string) {
	const row = await getGlobalBudgetLimit(companyId);
	return {
		limitUsd: row?.limitUsd ?? null,
		periodDays: row?.periodDays ?? 30,
		alertPercent: row?.alertPercent ?? 80,
	};
}

export async function updateGlobalBudgetSettings(
	companyId: string,
	body: {
		limitUsd?: number | null;
		periodDays?: number;
		alertPercent?: number;
	},
): Promise<void> {
	const existing = await getGlobalBudgetLimit(companyId);
	const raw = getRawDb();
	const now = new Date().toISOString();

	if (existing) {
		const updates: string[] = ["updated_at = ?"];
		const params: unknown[] = [now];
		if (body.limitUsd !== undefined) {
			updates.push("limit_usd = ?");
			params.push(body.limitUsd ?? 0);
		}
		if (body.periodDays !== undefined) {
			updates.push("period_days = ?");
			params.push(body.periodDays);
		}
		if (body.alertPercent !== undefined) {
			updates.push("alert_percent = ?");
			params.push(body.alertPercent);
		}
		params.push(existing.id, companyId);
		raw
			.prepare(
				`UPDATE board_budget_limits
    SET ${updates.join(", ")}
  WHERE id = ? AND company_id = ?`,
			)
			.run(...params);
		return;
	}

	raw
		.prepare(
			`INSERT INTO board_budget_limits (
id,
company_id,
limit_usd,
period_days,
alert_percent,
created_at,
updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			crypto.randomUUID(),
			companyId,
			body.limitUsd ?? 0,
			body.periodDays ?? 30,
			body.alertPercent ?? 80,
			now,
			now,
		);
}

export async function getEstimatedCacheSavings(
	since: Date,
	companyId: string,
): Promise<number> {
	const rows = getRawDb()
		.prepare(
			`SELECT
r.agent_version as model,
coalesce(sum(coalesce(r.cache_read_tokens, 0)), 0) as cacheReadTokens
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?
GROUP BY r.agent_version`,
		)
		.all(companyId, since.toISOString()) as Array<{
		model: string | null;
		cacheReadTokens: number;
	}>;

	let total = 0;
	for (const row of rows) {
		if (!row.model || row.cacheReadTokens <= 0) continue;
		const pricing = getCanonicalModelPricing(row.model);
		if (!pricing) continue;
		total += (row.cacheReadTokens / 1_000_000) * pricing.inputPer1M;
	}
	return total;
}
