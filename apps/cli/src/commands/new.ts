/**
 * setra new <name> — create a new plot (isolated git worktree)
 *
 * What happens:
 *   1. Reads .setra/config.json for project context
 *   2. Calls setra-core plots:create via IPC
 *   3. setra-core calls packages/git/worktree.ts to:
 *        git worktree add .setra/plots/<name> setra/plot-<id>
 *   4. Runs the setup script if one exists
 *   5. Prints next step: setra run <name>
 */

import path from "path";
import chalk from "chalk";
import { api, getClient } from "../ipc/socket.js";
import { c, icon } from "../tui/theme.js";

export type NewOptions = {
	ground?: string;
	agent?: string;
	branch?: string;
	setup?: boolean;
};

export async function runNew(name: string, opts: NewOptions): Promise<void> {
	console.log(`\n  ${c.accent("setra new")} ${c.primary(name)}\n`);

	// Validate name
	if (!/^[a-z0-9][a-z0-9/_-]*$/.test(name)) {
		console.error(
			`  ${icon.error} Invalid plot name. Use lowercase letters, numbers, - and /`,
		);
		process.exit(1);
	}

	try {
		await getClient().connect();
	} catch {
		console.error(
			`  ${icon.error} setra-core not running. Start it with ${c.key("setra serve")}`,
		);
		process.exit(1);
	}

	const spinner = startSpinner(`Creating plot ${chalk.bold(name)}…`);

	try {
		// Derive project ID from cwd (setra-core will look up or create it)
		const plot = await api.plots.create({
			name,
			projectId: process.cwd(), // setra-core resolves to proper ID
			agentAdapter: opts.agent ?? "claude",
			groundId: opts.ground,
			branch: opts.branch ?? "main",
		});

		stopSpinner(spinner);

		console.log(`  ${icon.done} Plot created:  ${c.accent(plot.name)}`);
		console.log(
			`  ${icon.done} Branch:        ${chalk.dim(`setra/plot-${plot.id.slice(0, 8)}`)}`,
		);
		console.log(
			`  ${icon.done} Worktree:      ${chalk.dim(`.setra/plots/${name}`)}`,
		);
		if (opts.ground) {
			console.log(`  ${icon.ground} Ground:        ${chalk.dim(opts.ground)}`);
		}

		console.log(`\n  Next: ${c.key(`setra run ${name}`)}\n`);
	} catch (err: unknown) {
		stopSpinner(spinner);
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`  ${icon.error} ${msg}`);
		process.exit(1);
	}
}

// Minimal spinner (no dep)
function startSpinner(msg: string): NodeJS.Timeout {
	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	let i = 0;
	process.stdout.write(`  ${frames[0]} ${msg}`);
	return setInterval(() => {
		process.stdout.write(`\r  ${frames[i++ % frames.length]} ${msg}`);
	}, 80);
}

function stopSpinner(timer: NodeJS.Timeout): void {
	clearInterval(timer);
	process.stdout.write("\r" + " ".repeat(80) + "\r");
}
