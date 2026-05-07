/**
 * RunsView — split-pane terminal output for the active plot
 *
 * When a plot has an active run, shows the live terminal output.
 * When no run is active, shows a "start a run" prompt.
 *
 * Uses SplitPane to support | and - splits for parallel runs.
 *
 * Layout (single pane):
 *   ┌─ feat/add-auth  ● running  $0.0042  4.1kt ──────────────────────┐
 *   │                                                                  │
 *   │  [terminal output scrollback]                                    │
 *   │  ● Analysing codebase...                                         │
 *   │  ● Reading src/auth/login.ts                                     │
 *   │  ● Writing implementation...                                     │
 *   │                                                                  │
 *   │                                                                  │
 *   └──────────────────────────────────────────────────────────────────┘
 *   a attach   x stop   Space pause   m mark   | split›   - split↓
 */

import { Box, Text } from "ink";
import React from "react";
import { SplitPane } from "../components/SplitPane.js";
import { useAppStore } from "../store/appStore.js";
import { c, formatCost, formatTokens, icon, palette } from "../theme.js";

type Props = { width: number; height: number; focused: boolean };

export function RunsView({ width, height, focused }: Props) {
	const {
		paneLayout,
		runs,
		plots,
		selectedPlotId,
		selectedRunId,
		activePaneId,
	} = useAppStore();

	const activeRun = runs.find((r) => r.id === selectedRunId);
	const activePlot = plots.find((p) => p.id === selectedPlotId);

	const footerHeight = 1;
	const paneHeight = height - footerHeight;

	return (
		<Box flexDirection="column" width={width} height={height}>
			{/* ─── Pane tree ──────────────────────────────────────────────────────── */}
			<Box width={width} height={paneHeight}>
				<SplitPane layout={paneLayout} width={width} height={paneHeight} />
			</Box>

			{/* ─── Footer ─────────────────────────────────────────────────────────── */}
			<Box height={footerHeight}>
				{activeRun?.status === "running" ? (
					<Text color={palette.textMuted}>
						{[
							`${c.key("a")} attach`,
							`${c.key("x")} stop`,
							`${c.key("Space")} pause`,
							`${c.key("m")} mark`,
							`${c.key("|")} split›`,
							`${c.key("-")} split↓`,
							`${c.key("Ctrl+w")} close pane`,
						].join("  ")}
					</Text>
				) : (
					<Text color={palette.textMuted}>
						{[
							`${c.key("r")} start run`,
							`${c.key("|")} split›`,
							`${c.key("-")} split↓`,
							`${c.key("i")} enter terminal`,
							`${c.key("Esc")} leave terminal`,
						].join("  ")}
					</Text>
				)}
			</Box>
		</Box>
	);
}
