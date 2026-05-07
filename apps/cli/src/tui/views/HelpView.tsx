/**
 * HelpView — keyboard shortcut reference (press ? to open)
 *
 * Full cheat-sheet in a clean two-column layout.
 */

import { Box, Text } from "ink";
import React from "react";
import { useAppStore } from "../store/appStore.js";
import { box, c, palette } from "../theme.js";

type Props = { width: number; height: number; focused: boolean };

type ShortcutSection = {
	title: string;
	items: Array<[string, string]>;
};

const SECTIONS: ShortcutSection[] = [
	{
		title: "GLOBAL",
		items: [
			["q", "quit setra TUI"],
			["?", "toggle this help screen"],
			[":", "enter command mode (Vim-style)"],
			["Tab", "cycle focus: sidebar ↔ main"],
			["!", "toggle sidebar"],
			["Esc", "go up / exit mode"],
		],
	},
	{
		title: "NAVIGATION (sidebar)",
		items: [
			["j / ↓", "next item"],
			["k / ↑", "previous item"],
			["Enter / l", "open / focus main"],
			["p", "go to Plots view"],
			["t", "go to Traces view"],
			["l", "go to Ledger view"],
			["g", "go to Grounds view"],
		],
	},
	{
		title: "PLOTS (main pane)",
		items: [
			["n", "new plot"],
			["d", "delete plot"],
			["s", "plot status detail"],
			["Enter", "open runs view for plot"],
		],
	},
	{
		title: "RUNS",
		items: [
			["r", "start agent run"],
			["x", "stop run"],
			["a", "attach to running session"],
			["Space", "pause / resume run"],
			["m", "create a git mark (checkpoint)"],
		],
	},
	{
		title: "SPLIT PANES",
		items: [
			["|", "split active pane vertically (right)"],
			["-", "split active pane horizontally (down)"],
			["Ctrl+w", "close active pane"],
			["Tab", "cycle to next pane"],
		],
	},
	{
		title: "TERMINAL PANE",
		items: [
			["i", "enter terminal focus (raw input)"],
			["Esc", "leave terminal focus"],
			["/", "search scrollback"],
			["G", "scroll to bottom"],
		],
	},
	{
		title: "TRACES",
		items: [
			["/", "open search prompt"],
			["Enter", "expand / collapse result"],
			["j / k", "navigate results"],
		],
	},
	{
		title: "COMMAND MODE (:)",
		items: [
			[":q", "quit"],
			[":new", "create a new plot"],
			[":run", "start a run"],
			[":stop", "stop the current run"],
			[":mark", "create a checkpoint mark"],
			[":split right", "split pane vertically"],
			[":split down", "split pane horizontally"],
			[":traces", "go to traces view"],
			[":ledger", "go to ledger view"],
			[":grounds", "go to grounds view"],
		],
	},
];

export function HelpView({ width, height }: Props) {
	const colWidth = Math.floor((width - 4) / 2);

	// Split sections into two columns
	const mid = Math.ceil(SECTIONS.length / 2);
	const left = SECTIONS.slice(0, mid);
	const right = SECTIONS.slice(mid);

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={2}>
			<Box marginBottom={1}>
				<Text color={palette.accent} bold>
					{" "}
					KEYBOARD SHORTCUTS
				</Text>
				<Text color={palette.textMuted}>{"   press ? or Esc to close"}</Text>
			</Box>

			<Text color={palette.border}>
				{box.h.repeat(Math.min(width - 4, 80))}
			</Text>

			<Box flexDirection="row" marginTop={1}>
				{/* Left column */}
				<Box flexDirection="column" width={colWidth}>
					{left.map((section) => (
						<Section key={section.title} section={section} width={colWidth} />
					))}
				</Box>

				{/* Divider */}
				<Box flexDirection="column" width={1} marginX={1}>
					{Array.from({ length: height - 4 }, (_, i) => (
						<Text key={i} color={palette.border}>
							{box.v}
						</Text>
					))}
				</Box>

				{/* Right column */}
				<Box flexDirection="column" width={colWidth}>
					{right.map((section) => (
						<Section key={section.title} section={section} width={colWidth} />
					))}
				</Box>
			</Box>
		</Box>
	);
}

function Section({
	section,
	width,
}: { section: ShortcutSection; width: number }) {
	const keyWidth = 18;
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={palette.textMuted} bold>
				{section.title}
			</Text>
			{section.items.map(([key, desc]) => (
				<Box key={key}>
					<Text color={palette.accent}>{key.padEnd(keyWidth)}</Text>
					<Text color={palette.textSecondary}>{desc}</Text>
				</Box>
			))}
		</Box>
	);
}
