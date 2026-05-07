/**
 * StatusBar — bottom bar showing active run info, cost, and key hints
 *
 * Format (single line, full width):
 *   ● running  feat/add-auth  $0.0042  4.1kt  │  r run  x stop  m mark  │  ? help  : cmd
 *
 * When there is no active run:
 *   ◯ idle  feat/add-auth  │  n new plot  r run  │  ? help  : cmd  q quit
 */

import { Box, Text } from "ink";
import React from "react";
import { type AppState, useAppStore } from "../store/appStore.js";
import { box, c, formatCost, formatTokens, icon, palette } from "../theme.js";

type Props = { columns: number };

export function StatusBar({ columns }: Props) {
	const {
		runs,
		selectedRunId,
		plots,
		selectedPlotId,
		daemonConnected,
		focusZone,
	} = useAppStore();

	const activeRun = runs.find(
		(r) => r.id === selectedRunId && r.status === "running",
	);
	const activePlot = plots.find((p) => p.id === selectedPlotId);

	// ─── Left segment ─────────────────────────────────────────────────────────

	const left = buildLeft(activeRun, activePlot, daemonConnected);

	// ─── Right segment (key hints, context-sensitive) ─────────────────────────

	const right = buildRight(activeRun, focusZone);

	// Pad between left and right
	const leftBare = stripAnsi(left);
	const rightBare = stripAnsi(right);
	const pad = Math.max(1, columns - leftBare.length - rightBare.length - 2);

	return (
		<Box width={columns} height={1}>
			<Text>
				{" "}
				{left}
				{" ".repeat(pad)}
				{right}{" "}
			</Text>
		</Box>
	);
}

function buildLeft(
	run: AppState["runs"][number] | undefined,
	plot: AppState["plots"][number] | undefined,
	connected: boolean,
): string {
	const conn = connected ? "" : `${icon.error} daemon offline  ${box.sep}  `;

	if (!plot) {
		return `${conn}${icon.idle}  ${c.muted("no plot selected")}`;
	}

	if (!run) {
		const plotLabel = c.secondary(plot.name);
		return `${conn}${icon.idle}  ${plotLabel}  ${c.muted(plot.branch ?? "")}`;
	}

	// Active run
	const parts: string[] = [
		`${icon.running}  ${c.secondary(plot.name)}`,
		c.muted(plot.branch ?? ""),
		formatCost(run.costUsd),
		formatTokens(run.totalTokens),
	];
	return conn + parts.join(`  ${c.muted(box.sep)}  `);
}

function buildRight(
	run: AppState["runs"][number] | undefined,
	focus: string,
): string {
	const hints: Array<[string, string]> = [];

	if (run?.status === "running") {
		hints.push(
			["x", "stop"],
			["Space", "pause"],
			["m", "mark"],
			["a", "attach"],
		);
	} else {
		hints.push(["n", "new"], ["r", "run"]);
	}

	hints.push(["|", "split›"], ["-", "split↓"]);
	hints.push(["?", "help"], [":", "cmd"], ["q", "quit"]);

	return hints
		.map(([key, label]) => `${c.key(key)} ${c.muted(label)}`)
		.join(`  `);
}

function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1B\[[0-9;]*m/g, "");
}
