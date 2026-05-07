/**
 * MainPane — routes to the active view based on appStore.activeView
 *
 * Views:
 *   plots    → PlotsView (list + status + quick actions)
 *   runs     → RunsView  (SplitPane terminal output)
 *   traces   → TracesView (semantic search + result list)
 *   ledger   → LedgerView (cost breakdown table)
 *   grounds  → GroundsView (remote environment list)
 *   help     → HelpView (keyboard shortcut reference)
 */

import { Box } from "ink";
import React from "react";
import { useAppStore } from "../store/appStore.js";
import { GroundsView } from "../views/GroundsView.js";
import { HelpView } from "../views/HelpView.js";
import { LedgerView } from "../views/LedgerView.js";
import { PlotsView } from "../views/PlotsView.js";
import { RunsView } from "../views/RunsView.js";
import { TracesView } from "../views/TracesView.js";

type Props = {
	width: number;
	height: number;
	focused: boolean;
};

export function MainPane({ width, height, focused }: Props) {
	const { activeView } = useAppStore();

	return (
		<Box width={width} height={height} flexDirection="column">
			{activeView === "plots" && (
				<PlotsView width={width} height={height} focused={focused} />
			)}
			{activeView === "runs" && (
				<RunsView width={width} height={height} focused={focused} />
			)}
			{activeView === "traces" && (
				<TracesView width={width} height={height} focused={focused} />
			)}
			{activeView === "ledger" && (
				<LedgerView width={width} height={height} focused={focused} />
			)}
			{activeView === "grounds" && (
				<GroundsView width={width} height={height} focused={focused} />
			)}
			{(activeView === "help" ||
				activeView === "projects" ||
				activeView === "tools") && (
				<HelpView width={width} height={height} focused={focused} />
			)}
		</Box>
	);
}
