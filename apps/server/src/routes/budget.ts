import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { pauseAllAgents, unpauseAllAgents } from "../lib/agent-lifecycle.js";
import { computeBudgetVerdict } from "../lib/budget-verdict.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as budgetRepo from "../repositories/budget.repo.js";
import { emit } from "../sse/handler.js";
import { UpdateBudgetSettingsSchema } from "../validators/budget.validators.js";

export const budgetRoute = new Hono();

async function buildBudgetSummary(companyId: string) {
	const now = new Date();
	const day = new Date(now);
	day.setDate(day.getDate() - 1);
	const week = new Date(now);
	week.setDate(week.getDate() - 7);
	const month = new Date(now);
	month.setDate(month.getDate() - 30);

	const totals = await budgetRepo.getMonthlyTotals(month, companyId);
	const daily = await budgetRepo.getCostSince(day, companyId);
	const weekly = await budgetRepo.getCostSince(week, companyId);
	const topAgents = await budgetRepo.getTopAgents(month, companyId, 5);
	const globalLimit = await budgetRepo.getGlobalBudgetLimit(companyId);
	const estimatedCacheSavingsUsd = await budgetRepo.getEstimatedCacheSavings(
		month,
		companyId,
	);

	const input = totals?.totalInputTokens ?? 0;
	const cacheReads = totals?.totalCacheReadTokens ?? 0;
	const cacheHitRate = input > 0 ? cacheReads / (input + cacheReads) : 0;

	const limitUsd = globalLimit?.limitUsd ?? 0;
	const alertPct = (globalLimit?.alertPercent ?? 80) / 100;
	const periodDays = globalLimit?.periodDays ?? 30;

	const periodStart = new Date(now);
	periodStart.setDate(periodStart.getDate() - periodDays);
	const periodSpend =
		(await budgetRepo.getCostSince(periodStart, companyId))?.cost ?? 0;

	const verdict = computeBudgetVerdict({
		periodSpendUsd: periodSpend,
		limitUsd,
		alertPercent: alertPct,
		periodDays,
	});

	return {
		verdict,
		limitUsd,
		data: {
			dailyCostUsd: daily?.cost ?? 0,
			weeklyCostUsd: weekly?.cost ?? 0,
			monthlyCostUsd: totals?.totalCostUsd ?? 0,
			cacheHitRate,
			totalInputTokens: input,
			totalOutputTokens: totals?.totalOutputTokens ?? 0,
			totalCacheReadTokens: cacheReads,
			topAgents,
			alerts: verdict.alerts,
			periodDays,
			periodSpendUsd: periodSpend,
			estimatedCacheSavingsUsd,
		},
	};
}

budgetRoute.get("/summary", async (c) => {
	const summary = await buildBudgetSummary(getCompanyId(c));
	return c.json(summary.data);
});

budgetRoute.post("/enforce", async (c) => {
	const companyId = getCompanyId(c);
	const summary = await buildBudgetSummary(companyId);
	let hardStop:
		| { triggered: boolean; agentsPaused: number; runsCancelled: number }
		| undefined;

	if (summary.verdict.hardStop && summary.verdict.hardStopReason) {
		const result = pauseAllAgents(summary.verdict.hardStopReason, companyId);
		hardStop = { triggered: true, ...result };
		emit("budget:hard_stop", {
			reason: summary.verdict.hardStopReason,
			...result,
			periodSpendUsd: summary.data.periodSpendUsd,
			limitUsd: summary.limitUsd,
		});
	}

	if (summary.verdict.alerts.length > 0) {
		const periodPct =
			summary.limitUsd > 0 ? summary.data.periodSpendUsd / summary.limitUsd : 0;
		emit("budget:alert", { alerts: summary.verdict.alerts, periodPct });
	}

	return c.json({ ...summary.data, hardStop });
});

// ── Budget settings ───────────────────────────────────────────────────────────

budgetRoute.get("/settings", async (c) => {
	const settings = await budgetRepo.getGlobalBudgetSettings(getCompanyId(c));
	return c.json(settings);
});

budgetRoute.patch(
	"/settings",
	zValidator("json", UpdateBudgetSettingsSchema),
	async (c) => {
		const body = c.req.valid("json");
		const updates: {
			limitUsd?: number | null;
			periodDays?: number;
			alertPercent?: number;
		} = {};
		if (body.limitUsd !== undefined) updates.limitUsd = body.limitUsd;
		if (body.periodDays !== undefined) updates.periodDays = body.periodDays;
		if (body.alertPercent !== undefined)
			updates.alertPercent = body.alertPercent;

		await budgetRepo.updateGlobalBudgetSettings(getCompanyId(c), updates);
		return c.json({ ok: true });
	},
);

// POST /budget/resume — admin endpoint that lifts a budget hard_stop.
// Caller is expected to have raised the limit first. No body — clients invoke
// this method-only; skipping zValidator.
budgetRoute.post("/resume", async (c) => {
	const result = unpauseAllAgents(getCompanyId(c));
	return c.json({ ok: true, ...result });
});
