/**
 * PlotsView — list of plots with status, agent, and run controls
 *
 * Layout:
 *   ┌─ PLOTS ─────────────────────────────────────────────────────────┐
 *   │  #  Name           Status    Agent    Branch          Updated   │
 *   │  ─────────────────────────────────────────────────────────────  │
 *   │  1  feat/add-auth  ● running  claude  setra/plot-a1f  2m ago    │
 *   │  2  fix/null-ptr   ◯ idle     claude  setra/plot-c2e  1h ago    │
 *   │  3  docs/readme    ✓ done     gemini  setra/plot-d3f  3h ago    │
 *   └─────────────────────────────────────────────────────────────────┘
 *   n new   r run   x stop   m mark   d delete   Enter → runs
 */

import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useState } from "react";
import type { Plot } from "../../ipc/socket.js";
import { useAppStore } from "../store/appStore.js";
import { box, c, icon, palette, relativeTime, truncate } from "../theme.js";

type Props = { width: number; height: number; focused: boolean };

const COLS = {
	idx: 4,
	name: 24,
	status: 14,
	agent: 9,
	branch: 22,
	updated: 10,
} as const;

function headerRow(): string {
	return [
		"#".padEnd(COLS.idx),
		"Name".padEnd(COLS.name),
		"Status".padEnd(COLS.status),
		"Agent".padEnd(COLS.agent),
		"Branch".padEnd(COLS.branch),
		"Updated",
	].join("  ");
}

function plotRow(plot: Plot, idx: number, isSelected: boolean): string {
	const statusLabel =
		{
			running: `${icon.running} running`,
			idle: `${icon.idle} idle`,
			done: `${icon.done} done`,
			error: `${icon.error} error`,
			paused: `${icon.paused} paused`,
			archived: `${c.muted("◌")} archived`,
		}[plot.status] ?? `${icon.idle} ${plot.status}`;

	const parts = [
		String(idx + 1).padEnd(COLS.idx),
		truncate(plot.name, COLS.name).padEnd(COLS.name),
		statusLabel.padEnd(COLS.status + 2),
		truncate(plot.agentAdapter, COLS.agent).padEnd(COLS.agent),
		truncate(plot.branch, COLS.branch).padEnd(COLS.branch),
		relativeTime(new Date(plot.updatedAt)),
	];

	return parts.join("  ");
}

export function PlotsView({ width, height, focused }: Props) {
	const { plots, selectedPlotId, selectPlot, setView, loading } = useAppStore();
	const [cursor, setCursor] = useState(0);
	const isLoading = loading["plots"];

	const selectedIdx = plots.findIndex((p) => p.id === selectedPlotId);

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={palette.accent} bold>
					{"  PLOTS"}
				</Text>
				{isLoading && (
					<Text color={palette.textMuted}>
						{"  "}
						<Spinner type="dots" />
					</Text>
				)}
			</Box>

			{/* Column headers */}
			<Text color={palette.textMuted}>{headerRow()}</Text>
			<Text color={palette.border}>
				{box.h.repeat(Math.min(width - 2, 80))}
			</Text>

			{/* Plot rows */}
			{plots.length === 0 && !isLoading && (
				<Box marginTop={2} flexDirection="column" alignItems="center">
					<Text color={palette.textMuted}>No plots yet.</Text>
					<Text color={palette.textMuted}>
						Press {c.key("n")} to create your first plot.
					</Text>
				</Box>
			)}

			{plots.map((plot, idx) => {
				const isSelected = focused && idx === selectedIdx;
				const row = plotRow(plot, idx, isSelected);

				return (
					<Box key={plot.id} width={width - 2}>
						{isSelected ? (
							<Text
								backgroundColor={palette.accentDim}
								color={palette.textPrimary}
								wrap="truncate-end"
							>
								{" "}
								{row}
							</Text>
						) : (
							<Text color={palette.textSecondary} wrap="truncate-end">
								{"  "}
								{row}
							</Text>
						)}
					</Box>
				);
			})}

			{/* Footer hints */}
			<Box marginTop={1} flexGrow={1} alignItems="flex-end">
				<Text color={palette.textMuted}>
					{[
						`${c.key("n")} new`,
						`${c.key("r")} run`,
						`${c.key("x")} stop`,
						`${c.key("m")} mark`,
						`${c.key("d")} delete`,
						`${c.key("Enter")} → runs`,
					].join("  ")}
				</Text>
			</Box>
		</Box>
	);
}
