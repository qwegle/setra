import { getDb, schema } from "@setra/db";
import { count, desc, eq, sum } from "drizzle-orm";
import { ipcMain } from "electron";

export function registerLedgerHandlers(): void {
	ipcMain.handle("ledger:summary", (_e, projectId?: string) => {
		const db = getDb();

		const runsQuery = db
			.select({
				totalCostUsd: sum(schema.runs.costUsd),
				totalRuns: count(schema.runs.id),
				totalPromptTokens: sum(schema.runs.promptTokens),
				totalCompletionTokens: sum(schema.runs.completionTokens),
				totalCacheReadTokens: sum(schema.runs.cacheReadTokens),
				totalCacheWriteTokens: sum(schema.runs.cacheWriteTokens),
			})
			.from(schema.runs);

		if (projectId) {
			// Join through plots to filter by project
			const plotIds = db
				.select({ id: schema.plots.id })
				.from(schema.plots)
				.where(eq(schema.plots.projectId, projectId))
				.all()
				.map((p) => p.id);

			if (plotIds.length === 0) {
				return {
					totalCostUsd: 0,
					totalRuns: 0,
					totalPromptTokens: 0,
					totalCompletionTokens: 0,
					totalCacheReadTokens: 0,
					totalCacheWriteTokens: 0,
				};
			}

			// Use a subselect approach — for simplicity, get all and filter in JS
			const allRows = db.select().from(schema.runs).all();
			const filtered = allRows.filter((r) => plotIds.includes(r.plotId));
			return {
				totalCostUsd: filtered.reduce((a, r) => a + (r.costUsd ?? 0), 0),
				totalRuns: filtered.length,
				totalPromptTokens: filtered.reduce(
					(a, r) => a + (r.promptTokens ?? 0),
					0,
				),
				totalCompletionTokens: filtered.reduce(
					(a, r) => a + (r.completionTokens ?? 0),
					0,
				),
				totalCacheReadTokens: filtered.reduce(
					(a, r) => a + (r.cacheReadTokens ?? 0),
					0,
				),
				totalCacheWriteTokens: filtered.reduce(
					(a, r) => a + (r.cacheWriteTokens ?? 0),
					0,
				),
			};
		}

		const result = runsQuery.get();
		return {
			totalCostUsd: Number(result?.totalCostUsd ?? 0),
			totalRuns: Number(result?.totalRuns ?? 0),
			totalPromptTokens: Number(result?.totalPromptTokens ?? 0),
			totalCompletionTokens: Number(result?.totalCompletionTokens ?? 0),
			totalCacheReadTokens: Number(result?.totalCacheReadTokens ?? 0),
			totalCacheWriteTokens: Number(result?.totalCacheWriteTokens ?? 0),
		};
	});

	ipcMain.handle(
		"ledger:entries",
		(_e, opts: { projectId?: string; limit?: number; offset?: number }) => {
			const db = getDb();
			const limit = opts?.limit ?? 50;

			// Get all plots
			let plotsQuery = db.select().from(schema.plots);
			if (opts?.projectId) {
				plotsQuery = plotsQuery.where(
					eq(schema.plots.projectId, opts.projectId),
				) as typeof plotsQuery;
			}
			const plots = plotsQuery
				.orderBy(desc(schema.plots.updatedAt))
				.limit(limit)
				.all() as Array<{
				id: string;
				name: string;
				totalCostUsd: number;
				lastActiveAt: string | null;
			}>;

			// For each plot, aggregate runs
			return plots.map((plot) => {
				const runs = db
					.select()
					.from(schema.runs)
					.where(eq(schema.runs.plotId, plot.id))
					.all();

				return {
					plotId: plot.id,
					plotName: plot.name,
					runCount: runs.length,
					costUsd: runs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
					promptTokens: runs.reduce((a, r) => a + (r.promptTokens ?? 0), 0),
					completionTokens: runs.reduce(
						(a, r) => a + (r.completionTokens ?? 0),
						0,
					),
					cacheReadTokens: runs.reduce(
						(a, r) => a + (r.cacheReadTokens ?? 0),
						0,
					),
					lastRunAt: plot.lastActiveAt,
				};
			});
		},
	);
}
