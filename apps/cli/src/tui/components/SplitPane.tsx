/**
 * SplitPane — recursive pane tree renderer
 *
 * Renders the PaneLayout tree from appStore as nested Ink <Box> elements.
 * Each leaf is a TerminalPane showing terminal output for a plot.
 * Each split is a row (vertical split |) or column (horizontal split -).
 *
 * Keyboard shortcuts for pane management (when focus=main):
 *   |  split current pane vertically (new pane to the right)
 *   -  split current pane horizontally (new pane below)
 *   Ctrl+w  close active pane
 *   Tab     cycle through panes
 *
 * The split ratio is stored in PaneLayout.ratio and is currently fixed at
 * 0.5 (even split). Future: drag-to-resize via mouse event support in Ink.
 */

import { Box, Text } from "ink";
import React, { useCallback } from "react";
import { useAppStore } from "../store/appStore.js";
import type { Pane, PaneLayout } from "../store/appStore.js";
import { box, c, icon, palette, truncate } from "../theme.js";

type SplitPaneProps = {
	layout: PaneLayout;
	width: number;
	height: number;
};

export function SplitPane({ layout, width, height }: SplitPaneProps) {
	if (layout.type === "leaf" && layout.pane) {
		return <LeafPane pane={layout.pane} width={width} height={height} />;
	}

	if (layout.type === "split" && layout.children && layout.split) {
		const [left, right] = layout.children;
		const isVertical = layout.split === "vertical";
		const ratio = layout.ratio ?? 0.5;

		if (isVertical) {
			const leftW = Math.floor(width * ratio);
			const rightW = width - leftW - 1; // -1 for divider
			return (
				<Box flexDirection="row" width={width} height={height}>
					<SplitPane layout={left} width={leftW} height={height} />
					<PaneDivider direction="vertical" height={height} />
					<SplitPane layout={right} width={rightW} height={height} />
				</Box>
			);
		} else {
			const topH = Math.floor(height * ratio);
			const bottomH = height - topH - 1; // -1 for divider
			return (
				<Box flexDirection="column" width={width} height={height}>
					<SplitPane layout={left} width={width} height={topH} />
					<PaneDivider direction="horizontal" width={width} />
					<SplitPane layout={right} width={width} height={bottomH} />
				</Box>
			);
		}
	}

	return null;
}

// ─── Divider between panes ────────────────────────────────────────────────────

function PaneDivider({
	direction,
	height,
	width,
}: {
	direction: "vertical" | "horizontal";
	height?: number;
	width?: number;
}) {
	if (direction === "vertical") {
		return (
			<Box flexDirection="column" width={1}>
				{Array.from({ length: height ?? 1 }, (_, i) => (
					<Text key={i} color={palette.border}>
						{box.v}
					</Text>
				))}
			</Box>
		);
	}
	return (
		<Box width={width ?? 0} height={1}>
			<Text color={palette.border}>{box.h.repeat(width ?? 0)}</Text>
		</Box>
	);
}

// ─── Leaf pane: terminal output + title bar ───────────────────────────────────

function LeafPane({
	pane,
	width,
	height,
}: { pane: Pane; width: number; height: number }) {
	const { activePaneId, plots, runs, setActivePane, setFocus } = useAppStore();
	const isActive = pane.id === activePaneId;

	const plot = pane.plotId ? plots.find((p) => p.id === pane.plotId) : null;
	const run = pane.runId ? runs.find((r) => r.id === pane.runId) : null;
	const hasRun = run?.status === "running";

	// ─── Title bar ─────────────────────────────────────────────────────────────

	const titleText = plot
		? `${hasRun ? icon.running : icon.idle} ${truncate(plot.name, width - 10)}`
		: `${icon.idle} ${c.muted("empty")}`;

	const titlePad = width - stripAnsi(titleText).length - 2;

	// ─── Terminal output ───────────────────────────────────────────────────────
	// Show last (height - 1) lines of scrollback (minus title bar)
	const outputHeight = height - 1;
	const visibleLines = pane.scrollback.slice(-outputHeight);

	// Pad to fill height
	while (visibleLines.length < outputHeight) {
		visibleLines.unshift("");
	}

	return (
		<Box
			flexDirection="column"
			width={width}
			height={height}
			borderStyle={isActive ? "bold" : undefined}
			borderColor={isActive ? palette.accent : palette.border}
		>
			{/* Pane title bar */}
			<Box width={width} height={1}>
				<Text
					backgroundColor={isActive ? palette.accentDim : palette.bgSurface}
					color={isActive ? palette.textPrimary : palette.textSecondary}
				>
					{" "}
					{titleText}
					{" ".repeat(Math.max(0, titlePad))}{" "}
				</Text>
			</Box>

			{/* Terminal output (raw ANSI pass-through) */}
			<Box flexDirection="column" flexGrow={1}>
				{visibleLines.map((line, i) => (
					<Text key={i} wrap="truncate-end">
						{line || " "}
					</Text>
				))}
			</Box>

			{/* "Press i to enter" hint when not in pane focus */}
			{isActive && (
				<Box height={0}>
					{/* Invisible — just marks this as active for keyboard routing */}
				</Box>
			)}
		</Box>
	);
}

function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1B\[[0-9;]*m/g, "");
}
