import { getDb, schema } from "@setra/db";
import { Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import React, { useState, useEffect } from "react";
import { TasksView } from "./views/TasksView.js";
import { TeamView } from "./views/TeamView.js";

// ─────────────────────────────────────────────────────────────────────────────
// Top-level TUI layout
// Tab-based navigation: [p]lots | [r]uns | [t]races | [l]edger | tas[k]s | te[a]m
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "plots" | "runs" | "traces" | "ledger" | "tasks" | "team";

const TABS: Array<{ key: Tab; label: string; shortcut: string }> = [
	{ key: "plots", label: "Plots", shortcut: "p" },
	{ key: "runs", label: "Runs", shortcut: "r" },
	{ key: "traces", label: "Traces", shortcut: "t" },
	{ key: "ledger", label: "Ledger", shortcut: "l" },
	{ key: "tasks", label: "Tasks", shortcut: "k" },
	{ key: "team", label: "Team", shortcut: "a" },
];

export function SetraTUI() {
	const { exit } = useApp();
	const [activeTab, setActiveTab] = useState<Tab>("plots");
	const [loading, setLoading] = useState(true);
	const [inputLocked, setInputLocked] = useState(false);

	useEffect(() => {
		// Give the DB a moment to be ready
		const t = setTimeout(() => setLoading(false), 200);
		return () => clearTimeout(t);
	}, []);

	useInput((input, key) => {
		if (key.ctrl && input === "c") exit();
		if (inputLocked) return;
		if (input === "q") exit();
		for (const tab of TABS) {
			if (input === tab.shortcut) setActiveTab(tab.key);
		}
	});

	if (loading) {
		return (
			<Box padding={1}>
				<Text color="blue">
					<Spinner type="dots" />
				</Text>
				<Text> Starting setra…</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width="100%">
			{/* Header */}
			<Box
				borderStyle="single"
				borderColor="blue"
				paddingX={1}
				marginBottom={0}
			>
				<Text bold color="blue">
					setra
				</Text>
				<Text color="gray"> | </Text>
				{TABS.map((tab, i) => (
					<React.Fragment key={tab.key}>
						<Text
							color={activeTab === tab.key ? "white" : "gray"}
							bold={activeTab === tab.key}
							underline={activeTab === tab.key}
						>
							{tab.label}
						</Text>
						<Text color="gray"> [{tab.shortcut}] </Text>
						{i < TABS.length - 1 && <Text color="gray"> · </Text>}
					</React.Fragment>
				))}
				<Text color="gray"> q=quit</Text>
			</Box>

			{/* Tab content */}
			<Box paddingX={1} paddingY={0} flexGrow={1}>
				{activeTab === "plots" && <PlotsTab />}
				{activeTab === "runs" && <RunsTab />}
				{activeTab === "traces" && <TracesTab />}
				{activeTab === "ledger" && <LedgerTab />}
				{activeTab === "tasks" && (
					<TasksView
						active={activeTab === "tasks"}
						onInputLockChange={setInputLocked}
					/>
				)}
				{activeTab === "team" && <TeamView active={activeTab === "team"} />}
			</Box>
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plots tab
// ─────────────────────────────────────────────────────────────────────────────

function PlotsTab() {
	const [plots, setPlots] = useState<
		Array<{ id: string; name: string; status: string; branch: string }>
	>([]);

	useEffect(() => {
		try {
			const db = getDb();
			const result = db.select().from(schema.plots).limit(20).all();
			setPlots(
				result.map((p) => ({
					id: p.id,
					name: p.name,
					status: p.status,
					branch: p.branch,
				})),
			);
		} catch {
			// DB not ready yet
		}
	}, []);

	if (plots.length === 0) {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color="gray">No plots yet.</Text>
				<Text color="gray">Run: setra new "My task" to create one.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text color="gray" dimColor>
				{"  "}
				{"NAME".padEnd(30)}
				{"STATUS".padEnd(12)}
				{"BRANCH".padEnd(40)}
			</Text>
			{plots.map((p) => (
				<Box key={p.id}>
					<Text color={p.status === "running" ? "green" : "white"}>
						{"  "}
						{p.name.substring(0, 28).padEnd(30)}
						{p.status.padEnd(12)}
						{p.branch.substring(0, 38)}
					</Text>
				</Box>
			))}
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs tab
// ─────────────────────────────────────────────────────────────────────────────

function RunsTab() {
	const [runs, setRuns] = useState<
		Array<{
			id: string;
			agent: string;
			status: string;
			costUsd: number;
			startedAt: string;
		}>
	>([]);

	useEffect(() => {
		try {
			const db = getDb();
			const result = db.select().from(schema.runs).limit(20).all();
			setRuns(
				result.map((r) => ({
					id: r.id.substring(0, 8),
					agent: r.agent,
					status: r.status,
					costUsd: r.costUsd,
					startedAt: r.startedAt.substring(11, 19), // HH:MM:SS
				})),
			);
		} catch {
			// DB not ready yet
		}
	}, []);

	if (runs.length === 0) {
		return (
			<Box paddingY={1}>
				<Text color="gray">No runs yet. Use setra run to start one.</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Text color="gray" dimColor>
				{"  "}
				{"ID".padEnd(10)}
				{"AGENT".padEnd(12)}
				{"STATUS".padEnd(12)}
				{"COST".padEnd(10)}
				{"STARTED".padEnd(10)}
			</Text>
			{runs.map((r) => (
				<Box key={r.id}>
					<Text
						color={
							r.status === "running"
								? "green"
								: r.status === "failed"
									? "red"
									: "white"
						}
					>
						{"  "}
						{r.id.padEnd(10)}
						{r.agent.padEnd(12)}
						{r.status.padEnd(12)}
						{`$${r.costUsd.toFixed(4)}`.padEnd(10)}
						{r.startedAt}
					</Text>
				</Box>
			))}
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Traces tab
// ─────────────────────────────────────────────────────────────────────────────

function TracesTab() {
	return (
		<Box paddingY={1}>
			<Text color="gray">
				Use {'"setra trace search <query>"'} to search past run memory.
			</Text>
		</Box>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger tab
// ─────────────────────────────────────────────────────────────────────────────

function LedgerTab() {
	const [summary, setSummary] = useState<{
		totalCostUsd: number;
		totalRuns: number;
		cacheHitRate: number;
	} | null>(null);

	useEffect(() => {
		try {
			const db = getDb();
			const runs = db.select().from(schema.runs).all();
			const totalPrompt = runs.reduce((s, r) => s + r.promptTokens, 0);
			const totalCacheRead = runs.reduce((s, r) => s + r.cacheReadTokens, 0);
			const totalInput = totalPrompt + totalCacheRead;

			setSummary({
				totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
				totalRuns: runs.length,
				cacheHitRate: totalInput > 0 ? totalCacheRead / totalInput : 0,
			});
		} catch {
			// DB not ready
		}
	}, []);

	if (!summary) {
		return <Text color="gray">Loading…</Text>;
	}

	return (
		<Box flexDirection="column" paddingY={1} gap={1}>
			<Box gap={4}>
				<Box flexDirection="column">
					<Text color="gray" dimColor>
						TOTAL COST
					</Text>
					<Text color="white" bold>
						${summary.totalCostUsd.toFixed(4)}
					</Text>
				</Box>
				<Box flexDirection="column">
					<Text color="gray" dimColor>
						TOTAL RUNS
					</Text>
					<Text color="white" bold>
						{summary.totalRuns}
					</Text>
				</Box>
				<Box flexDirection="column">
					<Text color="gray" dimColor>
						CACHE HIT RATE
					</Text>
					<Text color={summary.cacheHitRate > 0.5 ? "green" : "yellow"} bold>
						{(summary.cacheHitRate * 100).toFixed(1)}%
					</Text>
				</Box>
			</Box>
			{summary.cacheHitRate > 0.5 && (
				<Text color="green" dimColor>
					✓ Prompt caching is working — you{"'"}re saving on token costs.
				</Text>
			)}
		</Box>
	);
}
