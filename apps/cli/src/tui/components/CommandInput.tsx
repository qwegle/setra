/**
 * CommandInput — slash command autocomplete for the TUI
 *
 * When the user begins typing `/`, shows a fuzzy-filtered autocomplete list
 * below the current input line. The user can navigate with ↑/↓, complete with
 * Tab or Enter, or cancel with Escape.
 *
 * Props:
 *   onCommand — called when the user selects a command entry
 *   cwd       — working directory used to build the command registry
 */

import { buildCommandRegistry } from "@setra/commands";
import type { SlashCommandEntry } from "@setra/commands";
import { Box, Text, useInput } from "ink";
import React, { useState, useCallback } from "react";
import { c, palette } from "../theme.js";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommandInputProps {
	cwd?: string;
	onCommand: (cmd: SlashCommandEntry, args: string) => void;
}

// ─── Fuzzy match ─────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, entry: SlashCommandEntry): boolean {
	const q = query.toLowerCase();
	const haystack = [entry.name, ...entry.aliases, entry.description]
		.join(" ")
		.toLowerCase();
	return haystack.includes(q);
}

// ─── CommandInput component ───────────────────────────────────────────────────

export function CommandInput({ cwd = ".", onCommand }: CommandInputProps) {
	const [input, setInput] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const [isActive, setIsActive] = useState(false);

	const registry = buildCommandRegistry(cwd);

	// Show autocomplete only when input starts with /
	const showAutocomplete = isActive && input.startsWith("/");
	const rawQuery = showAutocomplete ? input.slice(1) : "";
	const spaceIdx = rawQuery.indexOf(" ");
	const commandQuery = spaceIdx === -1 ? rawQuery : rawQuery.slice(0, spaceIdx);
	const args = spaceIdx === -1 ? "" : rawQuery.slice(spaceIdx + 1);

	const suggestions = showAutocomplete
		? registry.filter((cmd) => fuzzyMatch(commandQuery, cmd))
		: [];

	const handleSelect = useCallback(
		(entry: SlashCommandEntry) => {
			const entryArgs = spaceIdx === -1 ? "" : args;
			onCommand(entry, entryArgs);
			setInput("");
			setIsActive(false);
			setSelectedIdx(0);
		},
		[args, onCommand, spaceIdx],
	);

	useInput((char, key) => {
		if (!isActive) {
			// Activate on any printable character
			if (char && !key.ctrl && !key.meta) {
				setInput(char);
				setIsActive(true);
				setSelectedIdx(0);
			}
			return;
		}

		if (key.escape) {
			setInput("");
			setIsActive(false);
			setSelectedIdx(0);
			return;
		}

		if (key.return || key.tab) {
			if (suggestions.length > 0) {
				const entry = suggestions[selectedIdx] ?? suggestions[0];
				if (entry) {
					handleSelect(entry);
					return;
				}
			}
			// No suggestion — submit raw input
			setInput("");
			setIsActive(false);
			return;
		}

		if (key.upArrow && suggestions.length > 0) {
			setSelectedIdx((i) => Math.max(0, i - 1));
			return;
		}

		if (key.downArrow && suggestions.length > 0) {
			setSelectedIdx((i) => Math.min(suggestions.length - 1, i + 1));
			return;
		}

		if (key.backspace || key.delete) {
			const next = input.slice(0, -1);
			setInput(next);
			if (!next) setIsActive(false);
			return;
		}

		if (char) {
			const next = input + char;
			setInput(next);
			setSelectedIdx(0);
		}
	});

	if (!isActive) {
		return (
			<Box>
				<Text color={palette.textMuted}>
					{"  Press any key or / for commands"}
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{/* Input line */}
			<Box>
				<Text color={palette.accent} bold>
					{"❯ "}
				</Text>
				<Text color={palette.textPrimary}>{input}</Text>
				<Text backgroundColor={palette.textPrimary} color={palette.bgDeep}>
					{" "}
				</Text>
			</Box>

			{/* Autocomplete list */}
			{showAutocomplete && suggestions.length > 0 && (
				<Box
					flexDirection="column"
					marginTop={1}
					borderStyle="single"
					borderColor={
						palette.border as Parameters<typeof Box>[0]["borderColor"]
					}
					paddingX={1}
				>
					{suggestions.slice(0, 8).map((entry, idx) => {
						const isSelected = idx === selectedIdx;
						return (
							<Box key={entry.name} gap={1}>
								<Text
									color={isSelected ? palette.accent : palette.textSecondary}
									bold={isSelected}
								>
									{isSelected ? "▸ " : "  "}
								</Text>
								<Text
									color={isSelected ? palette.accent : palette.textPrimary}
									bold={isSelected}
								>
									{"/" + entry.name}
								</Text>
								{entry.argumentHint ? (
									<Text color={palette.textMuted}>
										{" " + entry.argumentHint}
									</Text>
								) : null}
								<Text color={palette.textSecondary}>
									{"  " + entry.description}
								</Text>
							</Box>
						);
					})}

					{suggestions.length > 8 && (
						<Text color={palette.textMuted}>
							{"  …and " + String(suggestions.length - 8) + " more"}
						</Text>
					)}

					<Box marginTop={1}>
						<Text color={palette.textMuted}>
							{c.key("↑↓")}
							{" navigate  "}
							{c.key("Tab")}
							{" complete  "}
							{c.key("Esc")}
							{" cancel"}
						</Text>
					</Box>
				</Box>
			)}

			{showAutocomplete && suggestions.length === 0 && commandQuery && (
				<Box marginTop={1}>
					<Text color={palette.error}>
						{"  Unknown command: /" + commandQuery}
					</Text>
				</Box>
			)}
		</Box>
	);
}
