import { queryTokenStats, sampleCpuPercent, sampleRam } from "@setra/monitor";
import type { SystemStats, TokenStats } from "@setra/monitor";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

interface Stats {
	system: SystemStats;
	tokens: TokenStats;
}

function fmt(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(Math.round(n));
}

export function MonitorFooter({ columns }: { columns: number }) {
	const [stats, setStats] = useState<Stats | null>(null);

	useEffect(() => {
		let cancelled = false;

		const poll = async () => {
			try {
				const [cpu, ram, tokens] = await Promise.all([
					sampleCpuPercent(),
					Promise.resolve(sampleRam()),
					Promise.resolve(queryTokenStats()),
				]);
				if (!cancelled) {
					setStats({
						system: {
							cpuPercent: cpu,
							ramUsedMb: ram.usedMb,
							ramTotalMb: ram.totalMb,
							ramPercent: ram.percent,
							processRamMb: ram.processMb,
						},
						tokens,
					});
				}
			} catch {
				// ignore
			}
		};

		void poll();
		const timer = setInterval(() => {
			void poll();
		}, 2000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	if (!stats) {
		return (
			<Box width={columns} height={1} paddingX={1}>
				<Text dimColor>CPU: — | RAM: — | Tokens: — | Cache: — | Saved: —</Text>
			</Box>
		);
	}

	const { system, tokens } = stats;
	const ramGB = `${(system.ramUsedMb / 1024).toFixed(1)}/${(system.ramTotalMb / 1024).toFixed(0)}GB`;
	const cacheColor =
		tokens.cacheHitPercent >= 60
			? "green"
			: tokens.cacheHitPercent >= 30
				? "yellow"
				: "red";

	return (
		<Box width={columns} height={1} paddingX={1}>
			<Text dimColor>{"CPU: "}</Text>
			<Text
				color={
					system.cpuPercent > 80
						? "red"
						: system.cpuPercent > 50
							? "yellow"
							: "green"
				}
			>
				{system.cpuPercent.toFixed(0)}%
			</Text>
			<Text dimColor>{" | RAM: "}</Text>
			<Text>{ramGB}</Text>
			<Text
				dimColor
			>{` | Tokens ↑${fmt(tokens.totalInputTokens)} ↓${fmt(tokens.totalOutputTokens)} | Cache: `}</Text>
			<Text color={cacheColor}>{tokens.cacheHitPercent.toFixed(0)}%</Text>
			<Text dimColor>{` | Saved: `}</Text>
			<Text
				color={tokens.savedByCache > 0 ? "green" : undefined}
			>{`$${tokens.savedByCache.toFixed(2)}`}</Text>
		</Box>
	);
}
