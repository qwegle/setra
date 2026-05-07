/**
 * InstanceSwitcher — TUI sidebar component for switching between setra instances
 *
 * Press `i` to open the instance list modal.
 * ↑/↓ to navigate, Enter to switch, Esc to close.
 */

import {
	getActiveInstance,
	readInstanceRegistry,
	setActiveInstance,
} from "@setra/shared";
import type { SetraInstance } from "@setra/shared";
import { Box, Text, useInput } from "ink";
import React, { useState, useEffect } from "react";
import { c, icon, palette } from "../theme.js";

type Props = {
	width: number;
};

export function InstanceSwitcher({ width }: Props) {
	const [instances, setInstances] = useState<SetraInstance[]>([]);
	const [active, setActive] = useState<SetraInstance | null>(null);
	const [open, setOpen] = useState(false);
	const [cursor, setCursor] = useState(0);

	const refresh = () => {
		setInstances(readInstanceRegistry());
		setActive(getActiveInstance());
	};

	useEffect(() => {
		refresh();
		const interval = setInterval(refresh, 5000);
		return () => clearInterval(interval);
	}, []);

	useInput((input, key) => {
		if (!open) {
			if (input === "i") {
				setOpen(true);
				setCursor(0);
			}
			return;
		}

		if (key.escape || input === "q") {
			setOpen(false);
			return;
		}

		if (key.upArrow || input === "k") {
			setCursor((prev) => Math.max(0, prev - 1));
			return;
		}

		if (key.downArrow || input === "j") {
			setCursor((prev) => Math.min(instances.length - 1, prev + 1));
			return;
		}

		if (key.return) {
			const inst = instances[cursor];
			if (inst) {
				setActiveInstance(inst.id);
				setActive(inst);
				setOpen(false);
			}
		}
	});

	const inner = width - 2;

	return (
		<Box flexDirection="column" width={width}>
			{/* Header line */}
			<Box width={width}>
				<Text color={palette.textMuted}>
					{" " +
						truncateStr(
							`⚡ ${active?.name ?? "no instance"}  ${c.muted("[i]")}`,
							inner,
						)}
				</Text>
			</Box>

			{/* Modal overlay */}
			{open && (
				<Box
					flexDirection="column"
					borderStyle="round"
					borderColor={palette.accent}
					paddingX={1}
					marginTop={1}
				>
					<Text color={palette.accent} bold>
						{"  INSTANCES"}
					</Text>
					<Text color={palette.textMuted}>
						{"  ↑↓ navigate  Enter switch  Esc close"}
					</Text>
					<Box height={1} />

					{instances.length === 0 ? (
						<Text color={palette.textMuted}>{"  no instances registered"}</Text>
					) : (
						instances.map((inst, i) => {
							const isSelected = i === cursor;
							const isActive = inst.id === active?.id;
							const homeDir = process.env["HOME"] ?? "";
							const projDir = inst.projectDir?.replace(homeDir, "~") ?? "";
							const line = ` ${isActive ? icon.running : icon.bullet} ${inst.name}${
								projDir ? `  ${c.muted(projDir)}` : ""
							}`;

							return (
								<Box key={inst.id} width={inner}>
									{isSelected ? (
										<Text
											backgroundColor={palette.accentDim}
											color={palette.textPrimary}
											bold
										>
											{line.padEnd(inner - 2)}
										</Text>
									) : (
										<Text
											color={isActive ? palette.accent : palette.textSecondary}
										>
											{line}
										</Text>
									)}
								</Box>
							);
						})
					)}
					<Box height={1} />
				</Box>
			)}
		</Box>
	);
}

function truncateStr(str: string, max: number): string {
	return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
