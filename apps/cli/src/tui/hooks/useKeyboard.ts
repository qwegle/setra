/**
 * useKeyboard — global and context-aware keyboard handler
 *
 * Implements Vim-inspired keybindings. Context is determined by the active
 * focus zone in appStore. When commandMode is true, all characters are
 * captured for the command buffer (`:` bar) instead.
 *
 * Key routing:
 *   commandMode=true  → route to command bar
 *   focus=sidebar     → sidebar navigation
 *   focus=main        → view-specific navigation
 *   focus=pane        → terminal pane (raw pass-through)
 *
 * Special keys:
 *   Esc   → always exits command mode / pane focus
 *   ?     → toggle help view
 *   :     → enter command mode
 *   Tab   → cycle focus: sidebar → main → next pane
 *   !     → toggle sidebar
 *   q     → quit (only from sidebar/main, not from terminal pane)
 */

import { useInput } from "ink";
import { useCallback } from "react";
import { useAppStore } from "../store/appStore.js";
import type { ViewName } from "../store/appStore.js";

type Handler = (input: string, key: KeyInfo) => void;
type KeyInfo = {
	upArrow: boolean;
	downArrow: boolean;
	leftArrow: boolean;
	rightArrow: boolean;
	return: boolean;
	escape: boolean;
	ctrl: boolean;
	shift: boolean;
	tab: boolean;
	backspace: boolean;
	delete: boolean;
	pageDown: boolean;
	pageUp: boolean;
	meta: boolean;
};

// ─── View shortcut map ────────────────────────────────────────────────────────
// Pressing a letter from the sidebar jumps to that view
const VIEW_SHORTCUTS: Record<string, ViewName> = {
	p: "plots",
	P: "projects",
	t: "traces",
	l: "ledger",
	g: "grounds",
	T: "tools",
};

// ─── Command aliases ───────────────────────────────────────────────────────────
// Commands typed in `:` mode
type CommandHandler = () => void;

export function useKeyboard(handlers: {
	onNewPlot?: CommandHandler;
	onDeletePlot?: CommandHandler;
	onStartRun?: CommandHandler;
	onStopRun?: CommandHandler;
	onAttach?: CommandHandler;
	onMark?: CommandHandler;
	onSelectNext?: CommandHandler;
	onSelectPrev?: CommandHandler;
	onConfirm?: CommandHandler;
	onSearch?: CommandHandler;
	onSplitRight?: CommandHandler;
	onSplitDown?: CommandHandler;
	onClosePane?: CommandHandler;
	onScrollBottom?: CommandHandler;
	onQuit?: CommandHandler;
}) {
	const {
		focusZone,
		commandMode,
		commandBuffer,
		enterCommandMode,
		exitCommandMode,
		appendCommand,
		backspaceCommand,
		setCommandError,
		setView,
		setFocus,
		toggleSidebar,
		setActivePane,
	} = useAppStore();

	const handleInput: Handler = useCallback(
		(input, key) => {
			// ── Esc is always "go up" ────────────────────────────────────────────────
			if (key.escape) {
				if (commandMode) {
					exitCommandMode();
					return;
				}
				if (focusZone === "pane") {
					setFocus("main");
					return;
				}
				if (focusZone === "main") {
					setFocus("sidebar");
					return;
				}
				return;
			}

			// ── Command mode — swallow everything for the command buffer ─────────────
			if (commandMode) {
				if (key.return) {
					executeCommand(commandBuffer, handlers, setView, setCommandError);
					exitCommandMode();
					return;
				}
				if (key.backspace || key.delete) {
					backspaceCommand();
					return;
				}
				if (input && !key.ctrl && !key.meta) {
					appendCommand(input);
				}
				return;
			}

			// ── Terminal pane focus — raw pass-through (Ink handles it) ─────────────
			if (focusZone === "pane") {
				// Only handle escape (above). Everything else is passed to xterm-in-ink.
				return;
			}

			// ── Global shortcuts (always active outside terminal) ────────────────────

			if (input === "?") {
				setView("help");
				setFocus("main");
				return;
			}

			if (input === ":") {
				enterCommandMode();
				return;
			}

			if (key.tab) {
				// Cycle: sidebar → main → sidebar
				if (focusZone === "sidebar") {
					setFocus("main");
					return;
				}
				if (focusZone === "main") {
					setFocus("sidebar");
					return;
				}
				return;
			}

			if (input === "!") {
				toggleSidebar();
				return;
			}

			// ── Sidebar focus ─────────────────────────────────────────────────────────
			if (focusZone === "sidebar") {
				if (key.downArrow || input === "j") {
					handlers.onSelectNext?.();
					return;
				}
				if (key.upArrow || input === "k") {
					handlers.onSelectPrev?.();
					return;
				}
				if (key.return || input === "l") {
					setFocus("main");
					return;
				}

				// View jump shortcuts
				const view = VIEW_SHORTCUTS[input];
				if (view) {
					setView(view);
					return;
				}

				if (input === "q") {
					handlers.onQuit?.();
					return;
				}
				return;
			}

			// ── Main pane focus ───────────────────────────────────────────────────────
			if (focusZone === "main") {
				if (key.downArrow || input === "j") {
					handlers.onSelectNext?.();
					return;
				}
				if (key.upArrow || input === "k") {
					handlers.onSelectPrev?.();
					return;
				}
				if (key.leftArrow || input === "h") {
					setFocus("sidebar");
					return;
				}
				if (key.return || input === "l") {
					handlers.onConfirm?.();
					return;
				}

				// Plot shortcuts
				if (input === "n") {
					handlers.onNewPlot?.();
					return;
				}
				if (input === "d") {
					handlers.onDeletePlot?.();
					return;
				}

				// Run shortcuts
				if (input === "r") {
					handlers.onStartRun?.();
					return;
				}
				if (input === "x") {
					handlers.onStopRun?.();
					return;
				}
				if (input === "a") {
					handlers.onAttach?.();
					return;
				}

				// Space = pause/resume
				if (input === " ") {
					handlers.onStopRun?.(); // toggle: handled by run command
					return;
				}

				// Mark
				if (input === "m") {
					handlers.onMark?.();
					return;
				}

				// Search
				if (input === "/") {
					handlers.onSearch?.();
					return;
				}

				// Scroll bottom
				if (input === "G") {
					handlers.onScrollBottom?.();
					return;
				}

				// Split panes
				if (input === "|") {
					handlers.onSplitRight?.();
					return;
				}
				if (input === "-") {
					handlers.onSplitDown?.();
					return;
				}

				// Close pane
				if (key.ctrl && input === "w") {
					handlers.onClosePane?.();
					return;
				}

				// Enter terminal pane
				if (input === "i" || input === "Enter") {
					setFocus("pane");
					return;
				}

				if (input === "q") {
					handlers.onQuit?.();
					return;
				}
			}
		},
		[
			focusZone,
			commandMode,
			commandBuffer,
			enterCommandMode,
			exitCommandMode,
			appendCommand,
			backspaceCommand,
			setCommandError,
			setView,
			setFocus,
			toggleSidebar,
			handlers,
		],
	);

	useInput(handleInput);
}

// ─── Command executor ─────────────────────────────────────────────────────────
// Handles `:q`, `:new my-plot`, `:run`, `:trace search <query>` etc.

function executeCommand(
	cmd: string,
	handlers: Record<string, CommandHandler | undefined>,
	setView: (v: ViewName) => void,
	setError: (msg: string | null) => void,
) {
	const [verb, ...rest] = cmd.trim().split(/\s+/);
	const arg = rest.join(" ");

	setError(null);

	switch (verb) {
		case "q":
		case "quit":
		case "exit":
			handlers.onQuit?.();
			break;
		case "new":
			handlers.onNewPlot?.();
			break;
		case "run":
			handlers.onStartRun?.();
			break;
		case "stop":
			handlers.onStopRun?.();
			break;
		case "mark":
			handlers.onMark?.();
			break;
		case "plots":
			setView("plots");
			break;
		case "traces":
		case "trace":
			setView("traces");
			break;
		case "ledger":
			setView("ledger");
			break;
		case "grounds":
			setView("grounds");
			break;
		case "help":
			setView("help");
			break;
		case "split":
			if (arg === "right" || arg === "v") handlers.onSplitRight?.();
			else if (arg === "down" || arg === "h") handlers.onSplitDown?.();
			else handlers.onSplitRight?.();
			break;
		default:
			setError(`Unknown command: ${verb}`);
	}
}
