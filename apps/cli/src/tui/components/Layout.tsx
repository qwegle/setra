/**
 * Layout — the master TUI shell
 *
 * Visual structure:
 *
 *   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
 *   ┃  setra.sh  ●  my-project                             v0.1.0    ┃
 *   ┣━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
 *   ┃  PLOTS     ┃                                                    ┃
 *   ┃  ◉ feat    ┃         main pane (view content or terminals)      ┃
 *   ┃  ◯ fix     ┃                                                    ┃
 *   ┃  ◯ docs    ┃                                                    ┃
 *   ┃  ─────     ┃                                                    ┃
 *   ┃  VIEWS     ┃                                                    ┃
 *   ┃  Plots     ┃                                                    ┃
 *   ┃  Traces    ┃                                                    ┃
 *   ┃  Ledger    ┃                                                    ┃
 *   ┃  Grounds   ┃                                                    ┃
 *   ┃  Tools     ┃                                                    ┃
 *   ┣━━━━━━━━━━━━┻━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
 *   ┃  ●running  feat/main  $0.0023  3.2kt  │  ? help  : cmd  q quit ┃
 *   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
 *
 * When command mode active, the status bar becomes a command input:
 *   ┃  :split right█                                                  ┃
 */

import { Box, Text, useStdout } from "ink";
import useStdoutDimensions from "ink-use-stdout-dimensions";
import React, { useCallback } from "react";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { useSocket } from "../hooks/useSocket.js";
import { useAppStore } from "../store/appStore.js";
import { c, icon, palette } from "../theme.js";
import { CommandBar } from "./CommandBar.js";
import { MainPane } from "./MainPane.js";
import { MonitorFooter } from "./MonitorFooter.js";
import { Sidebar } from "./Sidebar.js";
import { StatusBar } from "./StatusBar.js";

export function Layout() {
	const [columns, rows] = useStdoutDimensions();

	const {
		activeView,
		sidebarVisible,
		focusZone,
		commandMode,
		setView,
		setFocus,
		toggleSidebar,
		plots,
		selectedPlotId,
		selectPlot,
		runs,
		selectedRunId,
		selectRun,
		splitPane,
		closePane,
		activePaneId,
	} = useAppStore();

	// Connect to setra-core daemon + subscribe to push events
	useSocket();

	// Sidebar selection cursor
	const sidebarItems = plots.map((p) => p.id);
	const currentIdx = selectedPlotId ? sidebarItems.indexOf(selectedPlotId) : -1;

	const handleQuit = useCallback(() => {
		process.exit(0);
	}, []);

	const handleSelectNext = useCallback(() => {
		if (focusZone === "sidebar") {
			const next = Math.min(currentIdx + 1, sidebarItems.length - 1);
			selectPlot(sidebarItems[next] ?? null);
		}
	}, [focusZone, currentIdx, sidebarItems, selectPlot]);

	const handleSelectPrev = useCallback(() => {
		if (focusZone === "sidebar") {
			const prev = Math.max(currentIdx - 1, 0);
			selectPlot(sidebarItems[prev] ?? null);
		}
	}, [focusZone, currentIdx, sidebarItems, selectPlot]);

	const handleSplitRight = useCallback(() => {
		splitPane(activePaneId, "vertical");
	}, [activePaneId, splitPane]);

	const handleSplitDown = useCallback(() => {
		splitPane(activePaneId, "horizontal");
	}, [activePaneId, splitPane]);

	const handleClosePane = useCallback(() => {
		closePane(activePaneId);
	}, [activePaneId, closePane]);

	// Wire up global keyboard handler
	useKeyboard({
		onSelectNext: handleSelectNext,
		onSelectPrev: handleSelectPrev,
		onSplitRight: handleSplitRight,
		onSplitDown: handleSplitDown,
		onClosePane: handleClosePane,
		onQuit: handleQuit,
		onConfirm: () => {
			if (focusZone === "sidebar" && selectedPlotId) {
				setView("runs");
				setFocus("main");
			}
		},
	});

	const SIDEBAR_WIDTH = 20;
	const mainWidth = sidebarVisible ? columns - SIDEBAR_WIDTH - 1 : columns;

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			{/* ─── Title bar ──────────────────────────────────────────────────────── */}
			<TitleBar columns={columns} />

			{/* ─── Main content area ──────────────────────────────────────────────── */}
			<Box flexGrow={1} flexDirection="row">
				{/* Sidebar */}
				{sidebarVisible && (
					<Box width={SIDEBAR_WIDTH} flexDirection="column">
						<Sidebar
							width={SIDEBAR_WIDTH}
							height={rows - 4}
							focused={focusZone === "sidebar"}
						/>
					</Box>
				)}

				{/* Vertical divider */}
				{sidebarVisible && (
					<Box flexDirection="column" width={1}>
						{Array.from({ length: rows - 4 }, (_, i) => (
							<Text
								key={i}
								color={
									focusZone !== "sidebar" ? palette.accent : palette.border
								}
							>
								{focusZone !== "sidebar" ? "┃" : "│"}
							</Text>
						))}
					</Box>
				)}

				{/* Main pane */}
				<Box width={mainWidth} flexDirection="column">
					<MainPane
						width={mainWidth}
						height={rows - 4}
						focused={focusZone === "main" || focusZone === "pane"}
					/>
				</Box>
			</Box>

			{/* ─── Monitor footer ──────────────────────────────────────────────────── */}
			<MonitorFooter columns={columns} />

			{/* ─── Status / Command bar ────────────────────────────────────────────── */}
			{commandMode ? (
				<CommandBar columns={columns} />
			) : (
				<StatusBar columns={columns} />
			)}
		</Box>
	);
}

// ─── Title bar ────────────────────────────────────────────────────────────────

function TitleBar({ columns }: { columns: number }) {
	const { daemonConnected, plots, selectedPlotId, daemonStatus } =
		useAppStore();
	const activePlot = plots.find((p) => p.id === selectedPlotId);
	const version = daemonStatus?.version ?? "0.1.0";

	const left = ` ${c.accent("setra.sh")} `;
	const mid = activePlot ? `  ${icon.mark} ${c.primary(activePlot.name)}` : "";
	const right = ` ${c.muted(`v${version}`)}  ${daemonConnected ? icon.running : icon.error} `;

	// Pad to fill width
	const bare = stripAnsi(left + mid);
	const bareR = stripAnsi(right);
	const padLen = Math.max(0, columns - bare.length - bareR.length);

	return (
		<Box width={columns} height={1}>
			<Text>
				{left}
				{mid}
				{" ".repeat(padLen)}
				{right}
			</Text>
		</Box>
	);
}

// Minimal ANSI stripper for width calculation (no dep)
function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1B\[[0-9;]*m/g, "");
}
