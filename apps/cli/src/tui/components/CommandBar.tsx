/**
 * CommandBar — the `:` command input (Vim-style)
 *
 * Replaces the StatusBar when commandMode=true.
 * Shows typed characters with a blinking cursor.
 * Errors from unknown commands appear in red inline.
 *
 * Example states:
 *   :█                        (empty, waiting for input)
 *   :split right█             (typing command)
 *   :foo   Unknown command    (error state)
 */

import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";
import { useAppStore } from "../store/appStore.js";
import { c, palette } from "../theme.js";

type Props = { columns: number };

export function CommandBar({ columns }: Props) {
	const { commandBuffer, commandError } = useAppStore();

	return (
		<Box width={columns} height={1} flexDirection="row">
			{/* Prompt */}
			<Text color={palette.accent} bold>
				:
			</Text>

			{/* Typed command */}
			<Text color={palette.textPrimary}>{commandBuffer}</Text>

			{/* Block cursor */}
			<Text backgroundColor={palette.textPrimary} color={palette.bgDeep}>
				{" "}
			</Text>

			{/* Inline error */}
			{commandError && (
				<Text color={palette.error}>
					{"  "}
					{commandError}
				</Text>
			)}

			{/* Right edge: ESC hint */}
			<Box flexGrow={1} justifyContent="flex-end">
				<Text color={palette.textMuted}>{"  Esc to cancel  "}</Text>
			</Box>
		</Box>
	);
}
