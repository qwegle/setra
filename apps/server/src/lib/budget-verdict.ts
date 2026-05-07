/**
 * Budget enforcement decision logic.
 *
 * Pure-function helper used by GET /api/budget/summary so the threshold
 * rules are unit-tested without a DB. See __tests__/budget-enforcement.test.ts.
 */

export interface BudgetState {
	periodSpendUsd: number;
	limitUsd: number;
	alertPercent: number; // 0–1
	periodDays: number;
}

export interface BudgetVerdict {
	alerts: string[];
	hardStop: boolean;
	hardStopReason?: string;
}

export function computeBudgetVerdict(s: BudgetState): BudgetVerdict {
	const verdict: BudgetVerdict = { alerts: [], hardStop: false };
	if (s.limitUsd <= 0) return verdict;

	const periodPct = s.periodSpendUsd / s.limitUsd;
	if (periodPct >= s.alertPercent) {
		verdict.alerts.push(
			`Budget ${Math.round(periodPct * 100)}% consumed (${s.periodDays}-day window)`,
		);
	}
	if (s.periodSpendUsd >= s.limitUsd) {
		verdict.hardStop = true;
		verdict.hardStopReason = `budget_hard_stop: $${s.periodSpendUsd.toFixed(2)} >= $${s.limitUsd.toFixed(2)} (${s.periodDays}d)`;
		verdict.alerts.push("Hard stop: budget exhausted");
	}
	return verdict;
}
