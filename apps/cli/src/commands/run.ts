import { execSync } from "node:child_process";
import { getDb, schema } from "@setra/db";
import chalk from "chalk";

interface RunOptions {
	plotId?: string;
	agent: string;
	useTmux: boolean;
}

export async function runCommand(opts: RunOptions): Promise<void> {
	let db;
	try {
		db = getDb();
	} catch {
		console.error(chalk.red("No setra database. Run: setra init"));
		process.exit(1);
	}

	let plot;
	if (opts.plotId) {
		plot = db
			.select()
			.from(schema.plots)
			.all()
			.find((p) => p.id === opts.plotId);
	} else {
		// Use the most recently active idle plot
		plot = db
			.select()
			.from(schema.plots)
			.all()
			.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
			.find((p) => p.status === "idle");
	}

	if (!plot) {
		console.error(
			chalk.red("No plot found. Create one with: setra new <name>"),
		);
		process.exit(1);
	}

	const tmuxSession = `setra-${plot.id}`;
	const agentCmd = opts.agent === "claude" ? "claude" : opts.agent;

	if (opts.useTmux) {
		try {
			execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null`);
			// Session exists — attach to it
			execSync(`tmux attach-session -t ${tmuxSession}`, { stdio: "inherit" });
		} catch {
			// Session doesn't exist — create it and start the agent
			const env = [
				`SETRA_PLOT_ID=${plot.id}`,
				`SETRA_BRANCH=${plot.branch}`,
				`ANTHROPIC_PROMPT_CACHING=1`,
			].join(" ");

			execSync(`tmux new-session -s ${tmuxSession} ${env} ${agentCmd}`, {
				stdio: "inherit",
			});
		}
	} else {
		// No tmux — run the agent directly (session won't persist if terminal closes)
		console.log(
			chalk.yellow("Warning: running without tmux — session will not persist."),
		);
		const { spawnSync } = await import("node:child_process");
		spawnSync(agentCmd, [], {
			stdio: "inherit",
			env: {
				...process.env,
				SETRA_PLOT_ID: plot.id,
				SETRA_BRANCH: plot.branch,
				ANTHROPIC_PROMPT_CACHING: "1",
			},
		});
	}
}
