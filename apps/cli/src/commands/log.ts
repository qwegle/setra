import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

const ACTION_COLORS: Record<string, (text: string) => string> = {
	task_start: chalk.blue,
	file_change: chalk.yellow,
	command_exec: chalk.cyan,
	review: chalk.magenta,
	apply: chalk.green,
	reject: chalk.red,
	checkpoint: chalk.white,
	complete: chalk.greenBright,
	error: chalk.redBright,
};

const ACTION_ICONS: Record<string, string> = {
	task_start: "🎯",
	file_change: "📄",
	command_exec: "⚡",
	review: "👁️ ",
	apply: "✅",
	reject: "❌",
	checkpoint: "📌",
	complete: "🎉",
	error: "💥",
};

export async function logCommand(opts: {
	limit: string;
	run?: string;
}): Promise<void> {
	const historyDir = path.join(process.cwd(), ".setra", "history");

	if (!fs.existsSync(historyDir)) {
		console.log(
			chalk.gray("No plan history yet. Run an agent to generate history."),
		);
		return;
	}

	const limit = Number.parseInt(opts.limit, 10) || 50;
	const files = fs
		.readdirSync(historyDir)
		.filter((fileName) => fileName.endsWith(".jsonl"))
		.sort()
		.reverse();

	if (files.length === 0) {
		console.log(chalk.gray("No history entries found."));
		return;
	}

	console.log(chalk.bold("\n📜 Plan History\n"));

	let shown = 0;
	for (const file of files) {
		if (shown >= limit) {
			break;
		}

		const runId = file.replace(".jsonl", "");
		if (opts.run && !runId.startsWith(opts.run)) {
			continue;
		}

		const content = fs.readFileSync(path.join(historyDir, file), "utf-8");
		const entries = content
			.split("\n")
			.filter(Boolean)
			.map(
				(line) =>
					JSON.parse(line) as {
						timestamp?: string;
						action: string;
						description: string;
						agent: string;
					},
			);

		if (entries.length === 0) {
			continue;
		}

		console.log(
			chalk.dim(
				`─── Run: ${runId.slice(0, 8)}... (${entries.length} actions) ───`,
			),
		);

		for (const entry of entries.slice(-limit + shown)) {
			if (shown >= limit) {
				break;
			}
			const time = entry.timestamp?.split("T")[1]?.split(".")[0] ?? "";
			const icon = ACTION_ICONS[entry.action] ?? "•";
			const color = ACTION_COLORS[entry.action] ?? chalk.white;
			console.log(
				`  ${chalk.dim(time)} ${icon} ${color(entry.description)} ${chalk.dim(`[${entry.agent}]`)}`,
			);
			shown++;
		}
		console.log("");
	}

	if (shown === 0) {
		console.log(chalk.gray("No matching entries."));
	}
}
