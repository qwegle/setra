/**
 * Sidebar — left panel with plot list and view navigation
 *
 * Two sections:
 *   1. PLOTS — list of plots in the current project with status dots
 *   2. VIEWS — navigation shortcuts to Traces, Ledger, Grounds, Tools
 *
 * Keyboard (when focused):
 *   j/↓  next item    k/↑  prev item
 *   Enter/l  open     n  new plot
 *   p  plots  t  traces  l  ledger  g  grounds
 */

import { Box, Text } from "ink";
import React from "react";
import type { Plot } from "../../ipc/socket.js";
import { useAppStore } from "../store/appStore.js";
import type { ViewName } from "../store/appStore.js";
import { box, c, icon, palette, truncate } from "../theme.js";

type Props = {
	width: number;
	height: number;
	focused: boolean;
};

// ─── Status dot per plot ──────────────────────────────────────────────────────

function statusIcon(plot: Plot): string {
	switch (plot.status) {
		case "running":
			return icon.running;
		case "error":
			return icon.error;
		case "paused":
			return icon.paused;
		case "archived":
			return icon.bullet;
		default:
			return icon.idle;
	}
}

// ─── View list items ──────────────────────────────────────────────────────────

const VIEW_ITEMS: Array<{ view: ViewName; label: string; key: string }> = [
	{ view: "plots", label: "Plots", key: "p" },
	{ view: "traces", label: "Traces", key: "t" },
	{ view: "ledger", label: "Ledger", key: "l" },
	{ view: "grounds", label: "Grounds", key: "g" },
	{ view: "tools", label: "Tools", key: "T" },
	{ view: "help", label: "Help", key: "?" },
];

export function Sidebar({ width, height, focused }: Props) {
	const { plots, selectedPlotId, activeView, selectPlot, setView, setFocus } =
		useAppStore();

	// Inner content width (no border)
	const inner = width - 2;

	return (
		<Box flexDirection="column" width={width} height={height}>
			{/* ─── PLOTS section ──────────────────────────────────────────────────── */}
			<Box flexDirection="column">
				<Text color={palette.textMuted}>{" " + "PLOTS".padEnd(inner)}</Text>

				{plots.length === 0 && (
					<Text color={palette.textMuted}>
						{" " + c.muted("  no plots yet")}
					</Text>
				)}

				{plots.map((plot) => {
					const isSelected = plot.id === selectedPlotId;
					const dot = statusIcon(plot);
					const name = truncate(plot.name, inner - 4);
					const line = ` ${dot} ${name}`;

					return (
						<Box key={plot.id} width={width}>
							{isSelected && focused ? (
								<Text
									backgroundColor={palette.accentDim}
									color={palette.textPrimary}
								>
									{line.padEnd(inner)}
								</Text>
							) : isSelected ? (
								<Text color={palette.accent}>{line.padEnd(inner)}</Text>
							) : (
								<Text color={palette.textSecondary}>{line.padEnd(inner)}</Text>
							)}
						</Box>
					);
				})}

				{/* Add-new hint */}
				<Text color={palette.textMuted}>{` ${c.muted("n")} new plot`}</Text>
			</Box>

			{/* ─── Separator ──────────────────────────────────────────────────────── */}
			<Box marginY={1}>
				<Text color={palette.border}>{" " + box.h.repeat(inner - 1)}</Text>
			</Box>

			{/* ─── VIEWS section ──────────────────────────────────────────────────── */}
			<Box flexDirection="column">
				<Text color={palette.textMuted}>{" " + "VIEWS".padEnd(inner)}</Text>

				{VIEW_ITEMS.map(({ view, label, key }) => {
					const isActive = activeView === view;
					const line = ` ${isActive ? icon.arrow : icon.bullet} ${label}`;

					return (
						<Box key={view} width={width}>
							<Text
								color={isActive ? palette.accent : palette.textSecondary}
								bold={isActive}
							>
								{line.padEnd(inner)}
							</Text>
						</Box>
					);
				})}
			</Box>

			{/* ─── Fill remaining space ───────────────────────────────────────────── */}
			<Box flexGrow={1} />

			{/* ─── Ground indicator (bottom of sidebar) ───────────────────────────── */}
			<GroundIndicator width={inner} />
		</Box>
	);
}

function GroundIndicator({ width }: { width: number }) {
	const { grounds, plots, selectedPlotId } = useAppStore();
	const plot = plots.find((p) => p.id === selectedPlotId);
	const ground = plot?.groundId
		? grounds.find((g) => g.id === plot.groundId)
		: null;

	if (!ground) {
		return (
			<Text color={palette.textMuted}>
				{" " + truncate("⬡ local", width - 1)}
			</Text>
		);
	}

	const status = ground.status === "connected" ? icon.running : icon.error;
	return (
		<Text color={ground.status === "connected" ? palette.info : palette.error}>
			{" " + truncate(`${status} ${ground.name}`, width - 1)}
		</Text>
	);
}
