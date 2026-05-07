import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb, runMigrations } from "@setra/db";
import chalk from "chalk";

export async function initCommand(): Promise<void> {
	const cwd = process.cwd();
	const setraDir = join(cwd, ".setra");

	if (!existsSync(join(cwd, ".git"))) {
		console.error(chalk.red("Not in a git repository. Run: git init first."));
		process.exit(1);
	}

	if (existsSync(setraDir)) {
		console.log(chalk.yellow("setra already initialised in this repository."));
		return;
	}

	mkdirSync(setraDir, { recursive: true });

	const config = {
		setup: [".setra/setup.sh"],
		teardown: [".setra/teardown.sh"],
		mcpServers: ["setra-core"],
		defaultAgent: "claude",
		autoCheckpoint: true,
		checkpointInterval: 300,
	};

	writeFileSync(
		join(setraDir, "config.json"),
		JSON.stringify(config, null, 2) + "\n",
	);

	writeFileSync(
		join(setraDir, "setup.sh"),
		`#!/bin/bash\n# runs when a plot is created\n# env vars: SETRA_PLOT_ID, SETRA_ROOT_PATH, SETRA_BRANCH\necho "setting up plot: $SETRA_PLOT_ID"\n`,
	);

	writeFileSync(
		join(setraDir, "teardown.sh"),
		`#!/bin/bash\n# runs when a plot is deleted\necho "tearing down plot: $SETRA_PLOT_ID"\n`,
	);

	// Add .setra/config.json to .gitignore patterns that are sensitive
	// The config itself is fine to commit; only secrets should be in .gitignore
	const gitignorePath = join(cwd, ".gitignore");
	const gitignoreAddition = "\n# setra\n.setra/*.log\n.setra/cache/\n";
	if (existsSync(gitignorePath)) {
		const { appendFileSync } = await import("node:fs");
		appendFileSync(gitignorePath, gitignoreAddition);
	}

	// Ensure ~/.setra/ exists and DB schema is bootstrapped
	const setraHome = join(homedir(), ".setra");
	mkdirSync(setraHome, { recursive: true });
	getDb(); // opens the SQLite file (creates it if absent)
	await runMigrations(); // idempotent — applies only pending migrations

	console.log(chalk.green("✓ setra initialised"));
	console.log(chalk.gray(`  .setra/config.json created`));
	console.log(chalk.gray(`  .setra/setup.sh created`));
	console.log(chalk.gray(`  .setra/teardown.sh created`));
	console.log(chalk.gray(`  ~/.setra/setra.db ready`));
	console.log();
	console.log(
		`Next: ${chalk.cyan("setra new <task-name>")} to create your first plot.`,
	);
}
