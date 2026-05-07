/**
 * TUI application state (Zustand)
 *
 * Mirrors the Electron renderer stores in packages/ui/src/stores/.
 * The same shape means data fetched via either transport slots in cleanly.
 *
 * State machines modelled here:
 *   - activeView:  which panel is shown in the main pane
 *   - focus:       which region has keyboard focus (sidebar | main | modal)
 *   - panes:       split-pane layout
 *   - commandMode: the `:` command bar (Vim-style)
 */

import { create } from "zustand";
import type {
	DaemonStatus,
	Ground,
	LedgerSummary,
	Plot,
	Run,
	RunStatus,
	TraceResult,
} from "../../ipc/socket.js";

// ─── View names ───────────────────────────────────────────────────────────────

export type ViewName =
	| "projects"
	| "plots"
	| "runs"
	| "traces"
	| "ledger"
	| "grounds"
	| "tools"
	| "help";

// ─── Focus zones ──────────────────────────────────────────────────────────────

export type FocusZone = "sidebar" | "main" | "pane" | "command" | "modal";

// ─── Split pane ───────────────────────────────────────────────────────────────

export type PaneSplit = "horizontal" | "vertical"; // | = vertical, - = horizontal

export type Pane = {
	id: string;
	plotId: string | null; // null = no plot attached
	runId: string | null;
	title: string;
	scrollback: string[]; // ring buffer: last 500 lines of terminal output
	cursorLine: number; // for scroll position
};

export type PaneLayout = {
	type: "leaf" | "split";
	pane?: Pane; // present when type='leaf'
	split?: PaneSplit; // present when type='split'
	children?: [PaneLayout, PaneLayout]; // present when type='split'
	ratio: number; // 0.0–1.0 (how much space left child gets)
};

// ─── App state ────────────────────────────────────────────────────────────────

export type AppState = {
	// Connection
	daemonConnected: boolean;
	daemonStatus: DaemonStatus | null;
	connectionError: string | null;

	// View routing
	activeView: ViewName;
	sidebarVisible: boolean;
	focusZone: FocusZone;

	// Command mode (`:` bar)
	commandMode: boolean;
	commandBuffer: string;
	commandError: string | null;

	// Data
	plots: Plot[];
	selectedPlotId: string | null;
	runs: Run[];
	selectedRunId: string | null;
	traces: TraceResult[];
	traceQuery: string;
	ledger: LedgerSummary | null;
	grounds: Ground[];

	// Split pane layout
	paneLayout: PaneLayout;
	activePaneId: string;

	// Loading states
	loading: Record<string, boolean>;
	errors: Record<string, string | null>;

	// ─── Actions ───────────────────────────────────────────────────────────────

	setView: (view: ViewName) => void;
	setFocus: (zone: FocusZone) => void;
	toggleSidebar: () => void;

	enterCommandMode: () => void;
	exitCommandMode: () => void;
	appendCommand: (char: string) => void;
	backspaceCommand: () => void;
	setCommandError: (msg: string | null) => void;

	setPlots: (plots: Plot[]) => void;
	selectPlot: (id: string | null) => void;
	setRuns: (runs: Run[]) => void;
	selectRun: (id: string | null) => void;
	updateRunStatus: (runId: string, status: RunStatus) => void;
	appendRunOutput: (paneId: string, chunk: string) => void;
	setTraces: (traces: TraceResult[]) => void;
	setTraceQuery: (q: string) => void;
	setLedger: (l: LedgerSummary) => void;
	setGrounds: (g: Ground[]) => void;

	setDaemonConnected: (connected: boolean, status?: DaemonStatus) => void;
	setConnectionError: (err: string | null) => void;

	// Pane management
	splitPane: (paneId: string, direction: PaneSplit, plotId?: string) => void;
	closePane: (paneId: string) => void;
	setActivePane: (paneId: string) => void;
	attachPlotToPane: (paneId: string, plotId: string) => void;

	setLoading: (key: string, loading: boolean) => void;
	setError: (key: string, err: string | null) => void;
};

// ─── Initial pane layout (single pane, no plot) ───────────────────────────────

const INITIAL_PANE_ID = "pane-main";

const initialLayout: PaneLayout = {
	type: "leaf",
	pane: {
		id: INITIAL_PANE_ID,
		plotId: null,
		runId: null,
		title: "terminal",
		scrollback: [],
		cursorLine: 0,
	},
	ratio: 1.0,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()((set, get) => ({
	daemonConnected: false,
	daemonStatus: null,
	connectionError: null,

	activeView: "plots",
	sidebarVisible: true,
	focusZone: "sidebar",

	commandMode: false,
	commandBuffer: "",
	commandError: null,

	plots: [],
	selectedPlotId: null,
	runs: [],
	selectedRunId: null,
	traces: [],
	traceQuery: "",
	ledger: null,
	grounds: [],

	paneLayout: initialLayout,
	activePaneId: INITIAL_PANE_ID,

	loading: {},
	errors: {},

	// ─── View + Focus ──────────────────────────────────────────────────────────

	setView: (view) => set({ activeView: view }),
	setFocus: (zone) => set({ focusZone: zone }),
	toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

	// ─── Command mode ──────────────────────────────────────────────────────────

	enterCommandMode: () =>
		set({ commandMode: true, commandBuffer: "", commandError: null }),
	exitCommandMode: () => set({ commandMode: false, commandBuffer: "" }),
	appendCommand: (char) =>
		set((s) => ({ commandBuffer: s.commandBuffer + char })),
	backspaceCommand: () =>
		set((s) => ({
			commandBuffer: s.commandBuffer.slice(0, -1),
		})),
	setCommandError: (msg) => set({ commandError: msg }),

	// ─── Data setters ──────────────────────────────────────────────────────────

	setPlots: (plots) => set({ plots }),
	selectPlot: (id) => set({ selectedPlotId: id }),
	setRuns: (runs) => set({ runs }),
	selectRun: (id) => set({ selectedRunId: id }),

	updateRunStatus: (runId, status) =>
		set((s) => ({
			runs: s.runs.map((r) => (r.id === runId ? { ...r, status } : r)),
		})),

	appendRunOutput: (paneId, chunk) =>
		set((s) => {
			const layout = appendToPane(s.paneLayout, paneId, chunk);
			return { paneLayout: layout };
		}),

	setTraces: (traces) => set({ traces }),
	setTraceQuery: (q) => set({ traceQuery: q }),
	setLedger: (l) => set({ ledger: l }),
	setGrounds: (g) => set({ grounds: g }),

	setDaemonConnected: (connected, status) =>
		set({ daemonConnected: connected, daemonStatus: status ?? null }),
	setConnectionError: (err) => set({ connectionError: err }),

	// ─── Pane management ───────────────────────────────────────────────────────

	splitPane: (paneId, direction, plotId) => {
		const newPaneId = `pane-${Date.now()}`;
		set((s) => ({
			paneLayout: splitPaneInLayout(s.paneLayout, paneId, direction, {
				id: newPaneId,
				plotId: plotId ?? null,
				runId: null,
				title: plotId ? "terminal" : "empty",
				scrollback: [],
				cursorLine: 0,
			}),
			activePaneId: newPaneId,
		}));
	},

	closePane: (paneId) => {
		set((s) => {
			const next = removePaneFromLayout(s.paneLayout, paneId);
			if (!next) return {};
			const firstLeaf = getFirstLeafId(next);
			return {
				paneLayout: next,
				activePaneId: firstLeaf ?? INITIAL_PANE_ID,
			};
		});
	},

	setActivePane: (id) => set({ activePaneId: id }),
	attachPlotToPane: (paneId, plotId) =>
		set((s) => ({
			paneLayout: updatePaneInLayout(s.paneLayout, paneId, (p) => ({
				...p,
				plotId,
				title: get().plots.find((pl) => pl.id === plotId)?.name ?? "terminal",
			})),
		})),

	// ─── Loading / errors ──────────────────────────────────────────────────────

	setLoading: (key, loading) =>
		set((s) => ({ loading: { ...s.loading, [key]: loading } })),
	setError: (key, err) => set((s) => ({ errors: { ...s.errors, [key]: err } })),
}));

// ─── Pane tree helpers ────────────────────────────────────────────────────────

function splitPaneInLayout(
	layout: PaneLayout,
	targetId: string,
	direction: PaneSplit,
	newPane: Pane,
): PaneLayout {
	if (layout.type === "leaf" && layout.pane?.id === targetId) {
		return {
			type: "split",
			split: direction,
			ratio: 0.5,
			children: [
				{ type: "leaf", pane: layout.pane, ratio: 1.0 },
				{ type: "leaf", pane: newPane, ratio: 1.0 },
			],
		};
	}
	if (layout.type === "split" && layout.children) {
		return {
			...layout,
			children: [
				splitPaneInLayout(layout.children[0], targetId, direction, newPane),
				splitPaneInLayout(layout.children[1], targetId, direction, newPane),
			],
		};
	}
	return layout;
}

function removePaneFromLayout(
	layout: PaneLayout,
	paneId: string,
): PaneLayout | null {
	if (layout.type === "leaf") {
		return layout.pane?.id === paneId ? null : layout;
	}
	if (layout.type === "split" && layout.children) {
		const [left, right] = layout.children;
		const newLeft = removePaneFromLayout(left, paneId);
		const newRight = removePaneFromLayout(right, paneId);
		if (!newLeft) return newRight;
		if (!newRight) return newLeft;
		return { ...layout, children: [newLeft, newRight] };
	}
	return layout;
}

function updatePaneInLayout(
	layout: PaneLayout,
	paneId: string,
	fn: (p: Pane) => Pane,
): PaneLayout {
	if (layout.type === "leaf" && layout.pane?.id === paneId) {
		return { ...layout, pane: fn(layout.pane) };
	}
	if (layout.type === "split" && layout.children) {
		return {
			...layout,
			children: [
				updatePaneInLayout(layout.children[0], paneId, fn),
				updatePaneInLayout(layout.children[1], paneId, fn),
			],
		};
	}
	return layout;
}

function appendToPane(
	layout: PaneLayout,
	paneId: string,
	chunk: string,
): PaneLayout {
	return updatePaneInLayout(layout, paneId, (p) => {
		const lines = (p.scrollback.join("") + chunk).split("\n");
		const RING_LIMIT = 500;
		return {
			...p,
			scrollback: lines.slice(-RING_LIMIT),
			cursorLine: Math.max(0, lines.length - 1),
		};
	});
}

function getFirstLeafId(layout: PaneLayout): string | null {
	if (layout.type === "leaf") return layout.pane?.id ?? null;
	if (layout.children) return getFirstLeafId(layout.children[0]);
	return null;
}
