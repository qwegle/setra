import { getDb, runs } from "@setra/db";
import { gte, sum } from "drizzle-orm";
import type { TokenStats } from "./types.js";

export function queryTokenStats(windowHours = 24): TokenStats {
	const empty: TokenStats = {
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCachedTokens: 0,
		totalCacheWriteTokens: 0,
		cacheHitPercent: 0,
		estimatedCostUsd: 0,
		savedByCache: 0,
		tokensPerMinute: 0,
	};

	try {
		const db = getDb();
		const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
		const sinceMinute = new Date(Date.now() - 60_000).toISOString();

		const result = db
			.select({
				totalInput: sum(runs.promptTokens),
				totalOutput: sum(runs.completionTokens),
				totalCached: sum(runs.cacheReadTokens),
				totalCacheWrite: sum(runs.cacheWriteTokens),
				totalCost: sum(runs.costUsd),
			})
			.from(runs)
			.where(gte(runs.startedAt, since))
			.get();

		const totalInputTokens = Number(result?.totalInput ?? 0);
		const totalOutputTokens = Number(result?.totalOutput ?? 0);
		const totalCachedTokens = Number(result?.totalCached ?? 0);
		const totalCacheWriteTokens = Number(result?.totalCacheWrite ?? 0);
		const estimatedCostUsd = Number(result?.totalCost ?? 0);

		const cacheHitPercent =
			totalInputTokens > 0 ? (totalCachedTokens / totalInputTokens) * 100 : 0;

		const denominator = totalInputTokens + totalCacheWriteTokens;
		const avgInputCostPerToken =
			denominator > 0 ? estimatedCostUsd / denominator : 0;
		const savedByCache = totalCachedTokens * avgInputCostPerToken * 0.9;

		const recentResult = db
			.select({
				recentInput: sum(runs.promptTokens),
				recentOutput: sum(runs.completionTokens),
			})
			.from(runs)
			.where(gte(runs.startedAt, sinceMinute))
			.get();

		const tokensPerMinute =
			Number(recentResult?.recentInput ?? 0) +
			Number(recentResult?.recentOutput ?? 0);

		return {
			totalInputTokens,
			totalOutputTokens,
			totalCachedTokens,
			totalCacheWriteTokens,
			cacheHitPercent,
			estimatedCostUsd,
			savedByCache,
			tokensPerMinute,
		};
	} catch {
		return empty;
	}
}
