import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	type TeamAgent,
	listTeamAgentsLocal,
	startTeamAgentLocal,
	stopTeamAgentLocal,
} from "../../commands/runtime-support.js";

export function TeamView(props: { active: boolean }) {
	const [agents, setAgents] = useState<TeamAgent[]>([]);
	const [selected, setSelected] = useState(0);
	const [showDetails, setShowDetails] = useState(false);

	const refresh = useCallback(async () => {
		setAgents(await listTeamAgentsLocal());
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const selectedAgent = useMemo(
		() => agents[selected] ?? null,
		[agents, selected],
	);

	useInput((input, key) => {
		if (!props.active) return;
		if (key.upArrow) {
			setSelected((value) => Math.max(0, value - 1));
			return;
		}
		if (key.downArrow) {
			setSelected((value) =>
				Math.min(Math.max(0, agents.length - 1), value + 1),
			);
			return;
		}
		if (key.return) {
			setShowDetails((value) => !value);
			return;
		}
		if (input === "s" && selectedAgent) {
			void startTeamAgentLocal(selectedAgent.slug).then(refresh);
			return;
		}
		if (input === "x" && selectedAgent) {
			void stopTeamAgentLocal(selectedAgent.slug).then(refresh);
		}
	});

	if (agents.length === 0) {
		return <Text color="gray">No agents registered yet.</Text>;
	}

	return (
		<Box flexDirection="column" width="100%">
			<Text color="gray">STATUS AGENT CURRENT TASK</Text>
			{agents.map((agent, index) => {
				const active = props.active && index === selected;
				const color =
					agent.status === "running"
						? "green"
						: agent.status === "stopped"
							? "red"
							: "yellow";
				return (
					<Text key={agent.slug} backgroundColor={active ? "blue" : undefined}>
						{`${agent.status.padEnd(12)} ${agent.slug.padEnd(12)} ${agent.currentTask ?? "—"}`}
					</Text>
				);
			})}
			{showDetails && selectedAgent && (
				<Box
					flexDirection="column"
					marginTop={1}
					borderStyle="single"
					borderColor="gray"
					paddingX={1}
				>
					<Text bold color="blue">
						{selectedAgent.slug}
					</Text>
					<Text color="gray">
						Status:{" "}
						<Text
							color={
								selectedAgent.status === "running"
									? "green"
									: selectedAgent.status === "stopped"
										? "red"
										: "yellow"
							}
						>
							{selectedAgent.status}
						</Text>
					</Text>
					<Text>Current task: {selectedAgent.currentTask ?? "None"}</Text>
					<Text color="gray">
						Updated: {selectedAgent.updatedAt.replace("T", " ").slice(0, 19)}
					</Text>
				</Box>
			)}
			<Box marginTop={1}>
				<Text color="gray">↑/↓ select · Enter details · s start · x stop</Text>
			</Box>
		</Box>
	);
}
