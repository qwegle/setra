export interface SystemStats {
	cpuPercent: number;
	ramUsedMb: number;
	ramTotalMb: number;
	ramPercent: number;
	processRamMb: number;
}

export interface TokenStats {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCachedTokens: number;
	totalCacheWriteTokens: number;
	cacheHitPercent: number;
	estimatedCostUsd: number;
	savedByCache: number;
	tokensPerMinute: number;
}

export interface MonitorSnapshot {
	system: SystemStats;
	tokens: TokenStats;
	timestamp: number;
}
