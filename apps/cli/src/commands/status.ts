import { getDb, runMigrations, schema } from "@setra/db";
import chalk from "chalk";

export async function statusCommand(): Promise<void> {
	let db;
	try {
		getDb();
		await runMigrations();
		db = getDb();
	} catch {
		console.log(chalk.gray("No setra database found. Run: setra init"));
		return;
	}

	const plots = db.select().from(schema.plots).all();
	const running = plots.filter((p) => p.status === "running");
	const idle = plots.filter((p) => p.status === "idle");

	if (plots.length === 0) {
		console.log(chalk.gray("No plots found. Run: setra new <name>"));
		return;
	}

	console.log(chalk.bold("\n  setra status\n"));

	if (running.length > 0) {
		console.log(chalk.green(`  ● ${running.length} running`));
		for (const p of running) {
			console.log(
				chalk.green(`    ${p.name}`) +
					chalk.gray(` [${p.id.substring(0, 8)}] ${p.branch}`),
			);
		}
		console.log();
	}

	if (idle.length > 0) {
		console.log(chalk.gray(`  ○ ${idle.length} idle`));
		for (const p of idle.slice(0, 5)) {
			console.log(chalk.gray(`    ${p.name} [${p.id.substring(0, 8)}]`));
		}
	}

	console.log();
}
