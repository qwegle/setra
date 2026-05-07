/**
 * Budget enforcement threshold logic.
 *
 * The GET /api/budget/summary endpoint computes hardStop trigger when
 * periodSpend >= limitUsd && limitUsd > 0. The actual SQL aggregation lives
 * in the route, but the *decision logic* — what counts as "alert" vs
 * "hard stop", what reason string we emit — is small and deserves its
 * own pure-function tests so we don't regress it accidentally.
 */

import { describe, expect, it } from "vitest";
import { computeBudgetVerdict } from "../lib/budget-verdict.js";

describe("budget verdict — alert threshold", () => {
	it("no limit configured = no alerts, no hard stop", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 9999,
			limitUsd: 0,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.alerts).toEqual([]);
		expect(v.hardStop).toBe(false);
	});

	it("under alert threshold = silent", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 5,
			limitUsd: 100,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.alerts).toEqual([]);
		expect(v.hardStop).toBe(false);
	});

	it("at alert threshold = alert but no hard stop", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 80,
			limitUsd: 100,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.alerts.length).toBe(1);
		expect(v.alerts[0]).toContain("80%");
		expect(v.hardStop).toBe(false);
	});

	it("over alert threshold but under limit = alert only", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 95,
			limitUsd: 100,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.alerts.length).toBe(1);
		expect(v.hardStop).toBe(false);
	});
});

describe("budget verdict — hard stop", () => {
	it("at exactly 100% triggers hard stop", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 100,
			limitUsd: 100,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.hardStop).toBe(true);
		expect(v.hardStopReason).toContain("budget_hard_stop");
		expect(v.hardStopReason).toContain("$100.00");
		expect(v.hardStopReason).toContain("30d");
	});

	it("over 100% triggers hard stop", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 150.5,
			limitUsd: 100,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.hardStop).toBe(true);
		expect(v.hardStopReason).toContain("$150.50");
	});

	it("hard stop also raises the alert + the hard-stop alert", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 100,
			limitUsd: 100,
			alertPercent: 0.8,
			periodDays: 30,
		});
		expect(v.alerts.length).toBe(2);
		expect(v.alerts.some((a) => a.includes("100%"))).toBe(true);
		expect(v.alerts.some((a) => a.includes("Hard stop"))).toBe(true);
	});

	it("custom period days appears in reason string", () => {
		const v = computeBudgetVerdict({
			periodSpendUsd: 50,
			limitUsd: 50,
			alertPercent: 0.8,
			periodDays: 7,
		});
		expect(v.hardStopReason).toContain("7d");
	});
});
