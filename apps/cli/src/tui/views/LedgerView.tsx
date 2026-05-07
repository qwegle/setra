/**
 * LedgerView — cost and token usage breakdown
 *
 * Shows three panels:
 *   1. Summary totals (top)
 *   2. By-plot breakdown (left column)
 *   3. By-day sparkline (right column, ASCII bar chart)
 *
 * Layout:
 *   ┌─ LEDGER ────────────────────────────────────────────────────────┐
 *   │  Total spend: $0.0241   Tokens: 48.2kt   Runs: 7               │
 *   │  ─────────────────────────────────────────────────────────────  │
 *   │  BY PLOT                      │  LAST 7 DAYS                    │
 *   │  feat/add-auth    $0.0132  4   │  Mon  ████░░░░  $0.0042        │
 *   │  fix/null-ptr     $0.0061  2   │  Tue  ██████░░  $0.0098        │
 *   │  docs/readme      $0.0048  1   │  Wed  ██░░░░░░  $0.0031        │
 *   └─────────────────────────────────────────────────────────────────┘
 */

import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect, useState } from "react";
import { api } from "../../ipc/socket.js";
import type { LedgerByDay, LedgerByPlot } from "../../ipc/socket.js";
import { useAppStore } from "../store/appStore.js";
import { box, c, formatCost, formatTokens, icon, palette } from "../theme.js";

type Props = { width: number; height: number; focused: boolean };

const BAR_MAX_WIDTH = 12;
const BAR_CHARS = ["░", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];

function renderBar(value: number, max: number): string {
	const ratio = max > 0 ? value / max : 0;
	const filled = Math.round(ratio * BAR_MAX_WIDTH);
	return "█".repeat(filled) + "░".repeat(BAR_MAX_WIDTH - filled);
}

export function LedgerView({ width, height, focused }: Props) {
	const { ledger, setLedger } = useAppStore();
	const [byPlot, setByPlot] = useState<LedgerByPlot[]>([]);
	const [byDay, setByDay] = useState<LedgerByDay[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [cursor, setCursor] = useState(0);

	useEffect(() => {
		setIsLoading(true);
		Promise.allSettled([
			api.ledger.summary(),
			api.ledger.byPlot(),
			api.ledger.byDay(),
		])
			.then(([summary, plots, days]) => {
				if (summary.status === "fulfilled") setLedger(summary.value);
				if (plots.status === "fulfilled") setByPlot(plots.value);
				if (days.status === "fulfilled") setByDay(days.value);
			})
			.finally(() => setIsLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const maxDayCost = Math.max(...byDay.map((d) => d.totalUsd), 0.001);
	const colWidth = Math.floor((width - 4) / 2);

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={palette.accent} bold>
					{"  LEDGER"}
				</Text>
				{isLoading && (
					<Text color={palette.textMuted}>
						{"  "}
						<Spinner type="dots" />
					</Text>
				)}
			</Box>

			{/* Summary row */}
			<Box marginBottom={1}>
				{ledger ? (
					<Text color={palette.textSecondary}>
						{`  Total: ${formatCost(ledger.totalUsd)}    Tokens: ${formatTokens(ledger.totalTokens)}    Runs: ${c.secondary(String(ledger.runCount))}`}
					</Text>
				) : (
					<Text color={palette.textMuted}>{"  Loading…"}</Text>
				)}
			</Box>

			<Text color={palette.border}>
				{box.h.repeat(Math.min(width - 2, 80))}
			</Text>

			{/* Two-column layout */}
			<Box flexDirection="row" flexGrow={1} marginTop={1}>
				{/* BY PLOT */}
				<Box flexDirection="column" width={colWidth}>
					<Text color={palette.textMuted} bold>
						{"  BY PLOT"}
					</Text>
					<Box height={1} />

					{byPlot.length === 0 && !isLoading && (
						<Text color={palette.textMuted}>{"  No data yet"}</Text>
					)}

					{byPlot.map((row, idx) => {
						const isSelected = focused && idx === cursor;
						return (
							<Box key={row.plotId}>
								<Text
									color={isSelected ? palette.accent : palette.textSecondary}
									backgroundColor={isSelected ? palette.accentDim : undefined}
									wrap="truncate-end"
								>
									{`  ${row.plotName.slice(0, 20).padEnd(22)}  ${formatCost(row.totalUsd).padEnd(10)}  ${String(row.runCount).padStart(2)} runs`}
								</Text>
							</Box>
						);
					})}
				</Box>

				{/* Vertical divider */}
				<Box flexDirection="column" width={1}>
					{Array.from({ length: height - 6 }, (_, i) => (
						<Text key={i} color={palette.border}>
							{box.v}
						</Text>
					))}
				</Box>

				{/* LAST 7 DAYS */}
				<Box flexDirection="column" width={colWidth}>
					<Text color={palette.textMuted} bold>
						{"  LAST 7 DAYS"}
					</Text>
					<Box height={1} />

					{byDay.slice(-7).map((day) => {
						const date = new Date(day.date);
						const label = date.toLocaleDateString("en", { weekday: "short" });
						const bar = renderBar(day.totalUsd, maxDayCost);

						return (
							<Box key={day.date}>
								<Text color={palette.textSecondary}>
									{`  ${label}  `}
									<Text
										color={
											day.totalUsd > 0.5 ? palette.costHigh : palette.costLow
										}
									>
										{bar}
									</Text>
									{`  ${formatCost(day.totalUsd)}`}
								</Text>
							</Box>
						);
					})}
				</Box>
			</Box>

			{/* Footer */}
			<Box alignItems="flex-end">
				<Text color={palette.textMuted}>
					{`${c.key("j/k")} navigate  ${c.key("r")} refresh`}
				</Text>
			</Box>
		</Box>
	);
}
