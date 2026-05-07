/**
 * TracesView — semantic memory search across all past run traces
 *
 * Architecture:
 *   - Calls api.traces.search(query) via the IPC socket
 *   - setra-core runs sqlite-vec vector search under the hood
 *   - Results are ranked by cosine similarity (score 0.0–1.0)
 *
 * Layout:
 *   ┌─ TRACES ────────────────────────────────────────────────────────┐
 *   │  Search: [agent wrote jwt middleware for auth ________]          │
 *   │  ─────────────────────────────────────────────────────────────  │
 *   │  0.92  feat/add-auth   2d ago  JWT middleware in src/auth/      │
 *   │         ...wrote the middleware with refresh token rotation...  │
 *   │                                                                  │
 *   │  0.87  fix/null-ptr    5d ago  Fixed NPE in auth service        │
 *   │         ...auth.login() threw NPE when user not found...        │
 *   └─────────────────────────────────────────────────────────────────┘
 *   / search   j/k navigate   Enter expand   Esc clear
 */

import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import React, { useState, useCallback, useEffect } from "react";
import { api } from "../../ipc/socket.js";
import type { TraceResult } from "../../ipc/socket.js";
import { useAppStore } from "../store/appStore.js";
import { box, c, icon, palette, relativeTime, truncate } from "../theme.js";

type Props = { width: number; height: number; focused: boolean };

export function TracesView({ width, height, focused }: Props) {
	const {
		traces,
		setTraces,
		traceQuery,
		setTraceQuery,
		plots,
		setLoading,
		loading,
	} = useAppStore();

	const [isSearching, setIsSearching] = useState(false);
	const [searchMode, setSearchMode] = useState(false);
	const [searchBuf, setSearchBuf] = useState(traceQuery);
	const [cursor, setCursor] = useState(0);
	const [expanded, setExpanded] = useState<string | null>(null);

	// Run search when query changes (debounced by Enter key)
	const doSearch = useCallback(
		async (q: string) => {
			if (!q.trim()) return;
			setIsSearching(true);
			try {
				const results = await api.traces.search(q, { limit: 20 });
				setTraces(results);
				setTraceQuery(q);
			} catch {
				// silently ignore (show stale results)
			} finally {
				setIsSearching(false);
			}
		},
		[setTraces, setTraceQuery],
	);

	// Load recent traces on mount
	useEffect(() => {
		api.traces
			.list()
			.then(setTraces)
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useInput((input, key) => {
		if (!focused) return;

		if (searchMode) {
			if (key.escape) {
				setSearchMode(false);
				return;
			}
			if (key.return) {
				setSearchMode(false);
				doSearch(searchBuf);
				return;
			}
			if (key.backspace) {
				setSearchBuf((b) => b.slice(0, -1));
				return;
			}
			if (input && !key.ctrl) {
				setSearchBuf((b) => b + input);
			}
			return;
		}

		if (input === "/") {
			setSearchMode(true);
			return;
		}
		if (key.downArrow || input === "j") {
			setCursor((c) => Math.min(c + 1, traces.length - 1));
			return;
		}
		if (key.upArrow || input === "k") {
			setCursor((c) => Math.max(c - 1, 0));
			return;
		}
		if (key.return) {
			const tr = traces[cursor];
			setExpanded(tr && expanded !== tr.id ? tr.id : null);
		}
	});

	const contentHeight = height - 4; // account for header + search bar + footer

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={palette.accent} bold>
					{"  TRACES"}
				</Text>
				{isSearching && (
					<Text color={palette.textMuted}>
						{"  "}
						<Spinner type="dots" />
					</Text>
				)}
			</Box>

			{/* Search bar */}
			<Box marginBottom={1}>
				<Text color={palette.textMuted}>{icon.trace} Search: </Text>
				{searchMode ? (
					<>
						<Text color={palette.textPrimary}>{searchBuf}</Text>
						<Text backgroundColor={palette.textPrimary} color={palette.bgDeep}>
							{" "}
						</Text>
					</>
				) : (
					<Text color={traceQuery ? palette.textSecondary : palette.textMuted}>
						{traceQuery || c.muted("Press / to search…")}
					</Text>
				)}
			</Box>

			<Text color={palette.border}>
				{box.h.repeat(Math.min(width - 2, 80))}
			</Text>

			{/* Results */}
			{traces.length === 0 && !isSearching && (
				<Box marginTop={2} flexDirection="column">
					<Text color={palette.textMuted}>{"  No traces yet."}</Text>
					<Text color={palette.textMuted}>
						{"  Traces are captured automatically after each run."}
					</Text>
				</Box>
			)}

			<Box flexDirection="column" height={contentHeight} overflow="hidden">
				{traces.map((trace, idx) => {
					const isSelected = focused && idx === cursor;
					const isOpen = expanded === trace.id;
					const plot = plots.find((p) => p.id === trace.plotId);
					const score = (trace.score * 100).toFixed(0);

					return (
						<Box key={trace.id} flexDirection="column">
							{/* Result row */}
							<Box>
								<Text
									color={isSelected ? palette.accent : palette.textSecondary}
									backgroundColor={isSelected ? palette.accentDim : undefined}
									wrap="truncate-end"
								>
									{`  ${score.padStart(3)}  `}
									{`${c.secondary(truncate(plot?.name ?? trace.plotId, 18)).padEnd(20)}  `}
									{`${relativeTime(new Date(trace.createdAt))}  `}
									{truncate(trace.summary, width - 52)}
								</Text>
							</Box>

							{/* Expanded content */}
							{isOpen && (
								<Box paddingLeft={7} flexDirection="column">
									<Text color={palette.textMuted} wrap="wrap">
										{trace.content.slice(0, 300)}
										{trace.content.length > 300 ? c.muted("…") : ""}
									</Text>
								</Box>
							)}
						</Box>
					);
				})}
			</Box>

			{/* Footer */}
			<Box flexGrow={1} alignItems="flex-end">
				<Text color={palette.textMuted}>
					{[
						`${c.key("/")} search`,
						`${c.key("j/k")} navigate`,
						`${c.key("Enter")} expand`,
						`${c.key("Esc")} clear`,
					].join("  ")}
				</Text>
			</Box>
		</Box>
	);
}
