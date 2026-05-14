/**
 * analytics.ts — Pre-aggregated dashboard metrics for OverviewPage.
 *
 * Endpoint: GET /api/analytics/dashboard?days=14
 *
 * Returns four series ready for recharts cards:
 *  - runActivity:   per-day count + success + fail buckets (agent_runs)
 *  - issuesByStatus:   bucketed by issues.status
 *  - issuesByPriority: bucketed by issues.priority
 *  - successRate:   per-day success ratio for run cards
 *
 * Scoped to the active company via getCompanyId(c). All counts come from
 * SQLite via getRawDb prepared statements so we avoid an N+1 hit and the
 * client never has to compute totals.
 */
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";

export const analyticsRoute = new Hono();

interface DayBucket {
	date: string;
	count: number;
	success: number;
	fail: number;
}

function buildDays(n: number): string[] {
	const out: string[] = [];
	const today = new Date();
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(today);
		d.setUTCDate(d.getUTCDate() - i);
		out.push(d.toISOString().slice(0, 10));
	}
	return out;
}

analyticsRoute.get("/dashboard", async (c) => {
	const companyId = getCompanyId(c);
	const daysParam = Number(c.req.query("days") ?? "14");
	const days = Math.max(1, Math.min(90, Number.isFinite(daysParam) ? daysParam : 14));
	const dayList = buildDays(days);
	const sinceIso = `${dayList[0]}T00:00:00.000Z`;
	const db = getRawDb();

	// Run activity per day. agent_runs joins via agent_id → agent_roster.company_id
	// so we can scope. status='success' / 'failed' are the two terminal buckets.
	const runRows = db
		.prepare(
			`SELECT substr(r.started_at, 1, 10) AS day,
			        SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) AS success,
			        SUM(CASE WHEN r.status = 'failed'  THEN 1 ELSE 0 END) AS fail,
			        COUNT(*) AS total
			   FROM agent_runs r
			   JOIN agent_roster ar ON ar.id = r.agent_id
			  WHERE ar.company_id = ?
			    AND r.started_at >= ?
			  GROUP BY day`,
		)
		.all(companyId, sinceIso) as Array<{
		day: string;
		success: number;
		fail: number;
		total: number;
	}>;
	const runMap = new Map(runRows.map((r) => [r.day, r]));
	const runActivity: DayBucket[] = dayList.map((date) => {
		const row = runMap.get(date);
		return {
			date,
			count: row?.total ?? 0,
			success: row?.success ?? 0,
			fail: row?.fail ?? 0,
		};
	});
	const successRate: Array<{ date: string; pct: number }> = runActivity.map((r) => ({
		date: r.date,
		pct: r.count > 0 ? Math.round((r.success / r.count) * 100) : 0,
	}));

	// Issues grouped by status, scoped by project.company_id.
	const issuesByStatusRows = db
		.prepare(
			`SELECT i.status AS bucket, COUNT(*) AS n
			   FROM issues i
			   JOIN projects p ON p.id = i.project_id
			  WHERE p.company_id = ?
			  GROUP BY i.status`,
		)
		.all(companyId) as Array<{ bucket: string; n: number }>;

	const issuesByPriorityRows = db
		.prepare(
			`SELECT i.priority AS bucket, COUNT(*) AS n
			   FROM issues i
			   JOIN projects p ON p.id = i.project_id
			  WHERE p.company_id = ?
			  GROUP BY i.priority`,
		)
		.all(companyId) as Array<{ bucket: string; n: number }>;

	return c.json({
		days,
		runActivity,
		successRate,
		issuesByStatus: issuesByStatusRows,
		issuesByPriority: issuesByPriorityRows,
		totals: {
			runs: runActivity.reduce((s, r) => s + r.count, 0),
			successes: runActivity.reduce((s, r) => s + r.success, 0),
			fails: runActivity.reduce((s, r) => s + r.fail, 0),
			issues: issuesByStatusRows.reduce((s, r) => s + r.n, 0),
		},
	});
});
