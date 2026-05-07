import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

type SandboxChange = {
	id: string;
	filePath: string;
	originalContent: string | null;
	proposedContent: string;
	operation: "create" | "modify" | "delete";
	status: "pending" | "applied" | "rejected";
};

export async function diffCommand(opts: {
	runId?: string;
	apply?: boolean;
	reject?: boolean;
}): Promise<void> {
	const setraDir = path.join(process.cwd(), ".setra", "sandbox");

	if (!fs.existsSync(setraDir)) {
		console.log(chalk.gray("No pending changes in sandbox."));
		return;
	}

	const runs = fs
		.readdirSync(setraDir)
		.filter((entry) => fs.statSync(path.join(setraDir, entry)).isDirectory())
		.sort();

	if (runs.length === 0) {
		console.log(chalk.gray("No pending changes."));
		return;
	}

	const targetRun = opts.runId ?? runs[runs.length - 1];
	const runDir = path.join(setraDir, targetRun);

	if (!fs.existsSync(runDir)) {
		console.log(chalk.red(`Run ${targetRun} not found.`));
		return;
	}

	const changeFiles = fs
		.readdirSync(runDir)
		.filter((entry) => entry.endsWith(".json"));
	const changes = changeFiles.map((fileName) => {
		const raw = fs.readFileSync(path.join(runDir, fileName), "utf-8");
		return JSON.parse(raw) as SandboxChange;
	});
	const pending = changes.filter((change) => change.status === "pending");

	if (pending.length === 0) {
		console.log(chalk.gray("No pending changes to review."));
		return;
	}

	console.log(
		chalk.bold(`\n📋 Pending changes from run ${targetRun.slice(0, 8)}...\n`),
	);
	console.log(chalk.gray(`${pending.length} file(s) modified\n`));

	for (const change of pending) {
		const icon =
			change.operation === "create"
				? chalk.green("+ NEW")
				: change.operation === "delete"
					? chalk.red("- DEL")
					: chalk.yellow("~ MOD");
		console.log(`  ${icon} ${chalk.white(change.filePath)}`);

		if (change.operation === "modify" && change.originalContent !== null) {
			const originalLines = change.originalContent.split("\n").length;
			const proposedLines = change.proposedContent.split("\n").length;
			const delta = proposedLines - originalLines;
			console.log(
				chalk.gray(
					`       ${originalLines} → ${proposedLines} lines (${delta >= 0 ? "+" : ""}${delta})`,
				),
			);
		} else if (change.operation === "create") {
			const lines = change.proposedContent.split("\n").length;
			console.log(chalk.gray(`       ${lines} lines`));
		}
	}

	if (opts.apply) {
		console.log(chalk.green("\n✅ Applying all changes..."));
		for (const change of pending) {
			const absPath = path.resolve(process.cwd(), change.filePath);
			if (change.operation === "delete") {
				if (fs.existsSync(absPath)) {
					fs.unlinkSync(absPath);
				}
			} else {
				fs.mkdirSync(path.dirname(absPath), { recursive: true });
				fs.writeFileSync(absPath, change.proposedContent);
			}
			change.status = "applied";
			persistChange(runDir, change);
		}
		console.log(chalk.green(`Applied ${pending.length} changes.`));
		return;
	}

	if (opts.reject) {
		console.log(chalk.red("\n❌ Rejecting all changes..."));
		for (const change of pending) {
			change.status = "rejected";
			persistChange(runDir, change);
		}
		console.log(chalk.red(`Rejected ${pending.length} changes.`));
		return;
	}

	console.log(chalk.gray("\nUse --apply to apply all, --reject to reject all"));
	console.log(chalk.gray("Or: setra diff --run-id <id> --apply"));
}

function persistChange(runDir: string, change: SandboxChange): void {
	fs.writeFileSync(
		path.join(runDir, `${change.id}.json`),
		JSON.stringify(change, null, 2),
	);
}
