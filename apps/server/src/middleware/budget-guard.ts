/**
 * budget-guard.ts — Pre-run budget enforcement.
 *
 * Checks current spend against configured limits before allowing a new agent
 * run to start. Returns { allowed: false } if any limit is exceeded.
 */

import { getRawDb } from "@setra/db";

export interface BudgetCheckResult {
	allowed: boolean;
	reason?: string;
	periodSpendUsd?: number;
	limitUsd?: number;
}

/**
 * Check whether a new run is permitted under the current budget limits.
 *
 * @param agentSlug Optional agent slug for per-agent limit checks
 */
export async function checkBudgetAllowed(
	agentSlug?: string,
	companyId = "default",
): Promise<BudgetCheckResult> {
	const raw = getRawDb();

	const globalLimit = raw
		.prepare(
			`SELECT limit_usd as limitUsd, period_days as periodDays
 FROM board_budget_limits
WHERE company_id = ?
  AND project_id IS NULL
  AND agent_slug IS NULL
LIMIT 1`,
		)
		.get(companyId) as { limitUsd: number; periodDays: number } | undefined;

	if (globalLimit) {
		const periodStart = new Date(
			Date.now() - globalLimit.periodDays * 86_400_000,
		).toISOString();
		const spendRow = raw
			.prepare(
				`SELECT coalesce(sum(coalesce(r.cost_usd, 0)), 0) as cost
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.started_at >= ?`,
			)
			.get(companyId, periodStart) as { cost?: number } | undefined;

		const spend = Number(spendRow?.cost ?? 0);
		if (spend >= globalLimit.limitUsd) {
			return {
				allowed: false,
				reason: `Global budget limit of $${globalLimit.limitUsd.toFixed(2)} reached ($${spend.toFixed(2)} spent in last ${globalLimit.periodDays} days)`,
				periodSpendUsd: spend,
				limitUsd: globalLimit.limitUsd,
			};
		}
	}

	if (agentSlug) {
		const agentLimit = raw
			.prepare(
				`SELECT limit_usd as limitUsd, period_days as periodDays
 FROM board_budget_limits
WHERE company_id = ?
  AND agent_slug = ?
LIMIT 1`,
			)
			.get(companyId, agentSlug) as
			| { limitUsd: number; periodDays: number }
			| undefined;

		if (agentLimit) {
			const periodStart = new Date(
				Date.now() - agentLimit.periodDays * 86_400_000,
			).toISOString();
			const agentSpendRow = raw
				.prepare(
					`SELECT coalesce(sum(coalesce(r.cost_usd, 0)), 0) as cost
 FROM runs r
 JOIN plots p ON p.id = r.plot_id
 JOIN board_projects bp ON bp.id = p.project_id
WHERE bp.company_id = ?
  AND r.agent = ?
  AND r.started_at >= ?`,
				)
				.get(companyId, agentSlug, periodStart) as
				| { cost?: number }
				| undefined;

			const agentSpend = Number(agentSpendRow?.cost ?? 0);
			if (agentSpend >= agentLimit.limitUsd) {
				return {
					allowed: false,
					reason: `Per-agent budget limit reached for "${agentSlug}" ($${agentSpend.toFixed(2)} / $${agentLimit.limitUsd.toFixed(2)} in last ${agentLimit.periodDays} days)`,
					periodSpendUsd: agentSpend,
					limitUsd: agentLimit.limitUsd,
				};
			}
		}
	}

	return { allowed: true };
}
