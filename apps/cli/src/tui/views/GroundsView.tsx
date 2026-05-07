/**
 * GroundsView — manage remote SSH environments
 *
 * Layout:
 *   ┌─ GROUNDS ───────────────────────────────────────────────────────┐
 *   │  Name           Host                     Status      Latency   │
 *   │  ─────────────────────────────────────────────────────────────  │
 *   │  prod-server    ubuntu@10.0.1.42:22       ● connected  42ms    │
 *   │  dev-box        root@192.168.1.100:22     ◯ idle               │
 *   │  ci-runner      ci@build.internal:22      ✗ error              │
 *   └─────────────────────────────────────────────────────────────────┘
 *   a add   t test   Enter connect   d delete
 */

import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React, { useEffect, useState } from "react";
import { api } from "../../ipc/socket.js";
import type { Ground } from "../../ipc/socket.js";
import { useAppStore } from "../store/appStore.js";
import { box, c, icon, palette, truncate } from "../theme.js";

type Props = { width: number; height: number; focused: boolean };

export function GroundsView({ width, height, focused }: Props) {
	const { grounds, setGrounds } = useAppStore();
	const [cursor, setCursor] = useState(0);
	const [testing, setTesting] = useState<string | null>(null);
	const [latencies, setLatencies] = useState<Record<string, number>>({});
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		setIsLoading(true);
		api.grounds
			.list()
			.then(setGrounds)
			.finally(() => setIsLoading(false));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const testSelected = async () => {
		const g = grounds[cursor];
		if (!g) return;
		setTesting(g.id);
		const result = await api.grounds.test(g.id);
		if (result.ok) {
			setLatencies((l) => ({ ...l, [g.id]: result.latencyMs }));
		}
		setTesting(null);
	};

	function statusBadge(g: Ground): string {
		if (testing === g.id) return `${icon.pending} testing…`;
		if (g.status === "connected") return `${icon.running} connected`;
		if (g.status === "disconnected") return `${icon.idle} idle`;
		return `${icon.error} error`;
	}

	return (
		<Box flexDirection="column" width={width} height={height} paddingX={1}>
			{/* Header */}
			<Box marginBottom={1}>
				<Text color={palette.accent} bold>
					{"  GROUNDS"}
				</Text>
				{isLoading && (
					<Text color={palette.textMuted}>
						{"  "}
						<Spinner type="dots" />
					</Text>
				)}
			</Box>

			{/* Column headers */}
			<Text color={palette.textMuted}>
				{"  " +
					"Name".padEnd(18) +
					"Host".padEnd(32) +
					"Status".padEnd(20) +
					"Latency"}
			</Text>
			<Text color={palette.border}>
				{box.h.repeat(Math.min(width - 2, 80))}
			</Text>

			{/* Ground rows */}
			{grounds.length === 0 && !isLoading && (
				<Box marginTop={2} flexDirection="column">
					<Text color={palette.textMuted}>{"  No grounds configured."}</Text>
					<Text color={palette.textMuted}>
						{`  Run ${c.key("setra grounds add <name>")} or press ${c.key("a")} here.`}
					</Text>
				</Box>
			)}

			{grounds.map((g, idx) => {
				const isSelected = focused && idx === cursor;
				const latency = latencies[g.id];
				const latStr = latency ? `${latency}ms` : "—";

				const row = [
					truncate(g.name, 16).padEnd(18),
					truncate(`${g.user}@${g.host}:${g.port}`, 30).padEnd(32),
					statusBadge(g).padEnd(20),
					latStr,
				].join("");

				return (
					<Box key={g.id}>
						<Text
							color={isSelected ? palette.accent : palette.textSecondary}
							backgroundColor={isSelected ? palette.accentDim : undefined}
							wrap="truncate-end"
						>
							{"  "}
							{row}
						</Text>
					</Box>
				);
			})}

			{/* Footer */}
			<Box flexGrow={1} alignItems="flex-end">
				<Text color={palette.textMuted}>
					{[
						`${c.key("a")} add`,
						`${c.key("t")} test`,
						`${c.key("Enter")} connect`,
						`${c.key("d")} delete`,
					].join("  ")}
				</Text>
			</Box>
		</Box>
	);
}
