/**
 * setra team init / run / status — setra-style multi-agent coordination
 *
 * This is Phase 3+ functionality. The team commands launch multiple agent
 * plots simultaneously from a company.json configuration file, similar to
 * how setra uses broker.go + tmux panes.
 *
 * company.json schema:
 * {
 *   "team": [
 *     { "name": "architect", "role": "...", "agent": "claude", "plot": "arch" },
 *     { "name": "engineer",  "role": "...", "agent": "claude", "plot": "eng"  },
 *     { "name": "reviewer",  "role": "...", "agent": "gemini", "plot": "rev"  }
 *   ],
 *   "task": "Implement the authentication module",
 *   "ground": "local",
 *   "maxBudget": 10.0
 * }
 *
 * When launched, each team member gets their own plot + run. The setra-core
 * MCP sidecar handles cross-agent communication (message_board, task_list tools).
 * The TUI opens with a split-pane layout showing all agents simultaneously.
 *
 * setra team run -- company.json
 *   → creates N plots (one per team member)
 *   → starts N runs
 *   → opens TUI with N-way split pane (like setra's tmux layout)
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { z } from "zod";
import { api, getClient } from "../ipc/socket.js";
import { c, icon } from "../tui/theme.js";

// ─── company.json schema ──────────────────────────────────────────────────────

const TeamMemberSchema = z.object({
	name: z.string(),
	role: z.string(),
	agent: z.enum(["claude", "gemini", "codex", "custom"]).default("claude"),
	plot: z.string().optional(),
});

const CompanySchema = z.object({
	team: z.array(TeamMemberSchema).min(1),
	task: z.string(),
	ground: z.string().default("local"),
	maxBudget: z.number().optional(),
});

// ─── setra team init ──────────────────────────────────────────────────────────

export async function runTeamInit(opts: { file: string }): Promise<void> {
	const filePath = path.resolve(opts.file);

	if (!fs.existsSync(filePath)) {
		// Write a starter company.json
		const starter = {
			team: [
				{
					name: "architect",
					role: "Design the system architecture and create the technical spec",
					agent: "claude",
				},
				{
					name: "engineer",
					role: "Implement the code based on the spec",
					agent: "claude",
				},
				{
					name: "reviewer",
					role: "Review the implementation and suggest improvements",
					agent: "gemini",
				},
			],
			task: "Describe your task here",
			ground: "local",
			maxBudget: 10.0,
		};

		fs.writeFileSync(filePath, JSON.stringify(starter, null, 2));
		console.log(`  ${icon.done} Created ${chalk.dim(filePath)}`);
		console.log(
			`  Edit the file, then run: ${c.key(`setra team run -- ${opts.file}`)}`,
		);
		return;
	}

	console.log(`  ${icon.done} ${chalk.dim(filePath)} already exists`);
}

// ─── setra team run ───────────────────────────────────────────────────────────

export async function runTeamRun(
	configPath: string,
	opts: { tui?: boolean },
): Promise<void> {
	const filePath = path.resolve(configPath);

	if (!fs.existsSync(filePath)) {
		console.error(`  ${icon.error} File not found: ${filePath}`);
		process.exit(1);
	}

	const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
	const parsed = CompanySchema.safeParse(raw);

	if (!parsed.success) {
		console.error(`  ${icon.error} Invalid company.json:`);
		console.error(parsed.error.format());
		process.exit(1);
	}

	const company = parsed.data;

	try {
		await getClient().connect();
	} catch {
		console.error(`  ${icon.error} setra-core not running`);
		process.exit(1);
	}

	console.log(`\n  ${c.accent("setra team run")}  ${chalk.dim(configPath)}\n`);
	console.log(`  Task: ${chalk.italic(company.task)}`);
	console.log(
		`  Team: ${company.team.map((m) => chalk.bold(m.name)).join(", ")}\n`,
	);

	// Create a plot for each team member
	const plots: Array<{
		member: (typeof company.team)[number];
		plotId: string;
	}> = [];

	for (const member of company.team) {
		const plotName = member.plot ?? `team-${member.name}`;
		const spinner = startSpinner(`Creating plot for ${member.name}…`);

		try {
			const plot = await api.plots.create({
				name: plotName,
				projectId: process.cwd(),
				agentAdapter: member.agent,
				groundId: company.ground !== "local" ? company.ground : undefined,
			});
			plots.push({ member, plotId: plot.id });
			stopSpinner(spinner);
			console.log(
				`  ${icon.done} ${member.name.padEnd(12)}  ${chalk.dim(plot.id.slice(0, 8))}`,
			);
		} catch (err) {
			stopSpinner(spinner);
			console.error(
				`  ${icon.error} Failed to create plot for ${member.name}: ${err}`,
			);
			process.exit(1);
		}
	}

	// Start runs for all team members in parallel
	console.log(`\n  ${icon.pending} Starting ${plots.length} agent runs…\n`);

	await Promise.all(
		plots.map(async ({ member, plotId }) => {
			const task = `You are ${member.name}. Your role: ${member.role}.\n\nTask: ${company.task}`;
			await api.runs.start(plotId, {
				task,
				budget: company.maxBudget
					? company.maxBudget / plots.length
					: undefined,
			});
			console.log(`  ${icon.running} ${member.name} started`);
		}),
	);

	if (opts.tui === false) {
		console.log(
			`\n  ${icon.done} All agents running. Monitor with ${c.key("setra status --watch")}\n`,
		);
		getClient().disconnect();
		return;
	}

	// Open TUI with all panes visible
	const { launchTUI } = await import("../tui/index.js");
	await launchTUI();
}

// ─── setra team prompt ────────────────────────────────────────────────────────

export async function runTeamPrompt(opts: {
	task: string;
	agents: string;
	budget?: number;
	tui?: boolean;
}): Promise<void> {
	const task = opts.task.trim();
	if (!task) {
		console.error(`  ${icon.error} Task is required`);
		process.exit(1);
	}
	const names = opts.agents
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (names.length === 0) {
		console.error(`  ${icon.error} At least one agent name is required`);
		process.exit(1);
	}

	try {
		await getClient().connect();
	} catch {
		console.error(`  ${icon.error} setra-core not running`);
		process.exit(1);
	}

	console.log(`\n  ${c.accent("setra team prompt")}\n`);
	console.log(`  Task: ${chalk.italic(task)}`);
	console.log(`  Team: ${names.map((n) => chalk.bold(n)).join(", ")}\n`);

	const plots: Array<{
		member: { name: string; role: string };
		plotId: string;
	}> = [];

	for (const name of names) {
		const plotName = `team-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
		const spinner = startSpinner(`Creating plot for ${name}…`);
		try {
			const plot = await api.plots.create({
				name: plotName,
				projectId: process.cwd(),
				agentAdapter: "claude",
			});
			plots.push({
				member: {
					name,
					role: `Own ${name} responsibilities and deliver concrete output for the task.`,
				},
				plotId: plot.id,
			});
			stopSpinner(spinner);
			console.log(
				`  ${icon.done} ${name.padEnd(12)}  ${chalk.dim(plot.id.slice(0, 8))}`,
			);
		} catch (err) {
			stopSpinner(spinner);
			console.error(
				`  ${icon.error} Failed to create plot for ${name}: ${err}`,
			);
			process.exit(1);
		}
	}

	console.log(`\n  ${icon.pending} Starting ${plots.length} agent runs…\n`);
	await Promise.all(
		plots.map(async ({ member, plotId }) => {
			await api.runs.start(plotId, {
				task: `You are ${member.name}. ${member.role}\n\nPrimary task: ${task}`,
				budget: opts.budget ? opts.budget / plots.length : undefined,
			});
			console.log(`  ${icon.running} ${member.name} started`);
		}),
	);

	if (opts.tui === false) {
		console.log(
			`\n  ${icon.done} All agents running. Monitor with ${c.key("setra status")}\n`,
		);
		getClient().disconnect();
		return;
	}
	const { launchTUI } = await import("../tui/index.js");
	await launchTUI();
}

// ─── setra team status ────────────────────────────────────────────────────────

export async function runTeamStatus(): Promise<void> {
	try {
		await getClient().connect();
	} catch {
		console.error(`  ${icon.error} setra-core not running`);
		process.exit(1);
	}

	const plots = await api.plots.list();
	const teamPlots = plots.filter((p) => p.name.startsWith("team-"));

	if (teamPlots.length === 0) {
		console.log(`\n  ${icon.idle} No active team session.\n`);
		console.log(
			`  Start one with ${c.key("setra team run -- company.json")}\n`,
		);
		getClient().disconnect();
		return;
	}

	console.log(`\n  ${c.accent("TEAM")}  (${teamPlots.length} agents)\n`);

	const runs = await api.runs.list();
	for (const plot of teamPlots) {
		const run = runs.find((r) => r.plotId === plot.id);
		const statusIcon =
			(
				{
					running: icon.running,
					idle: icon.idle,
					done: icon.done,
					error: icon.error,
					paused: icon.paused,
					archived: icon.bullet,
				} as Record<string, string>
			)[plot.status] ?? icon.idle;

		console.log(
			`  ${statusIcon}  ${c.secondary(plot.name.padEnd(18))}  ` +
				(run ? `$${run.costUsd.toFixed(4)}` : chalk.dim("—")),
		);
	}

	console.log("");
	getClient().disconnect();
}

function startSpinner(msg: string): NodeJS.Timeout {
	const f = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let i = 0;
	process.stdout.write(`  ${f[0]} ${msg}`);
	return setInterval(() => {
		process.stdout.write(`\r  ${f[i++ % f.length]} ${msg}`);
	}, 80);
}

function stopSpinner(t: NodeJS.Timeout): void {
	clearInterval(t);
	process.stdout.write("\r" + " ".repeat(80) + "\r");
}
