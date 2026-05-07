import { execSync } from "node:child_process";
import { getDb, schema } from "@setra/db";
import chalk from "chalk";
import { eq } from "drizzle-orm";

interface MarkOptions {
	message?: string;
	plotId?: string;
}

export async function markCommand(opts: MarkOptions): Promise<void> {
	const message =
		opts.message ?? `setra: manual mark ${new Date().toISOString()}`;

	let commitHash: string;
	try {
		execSync("git add -A", { cwd: process.cwd() });
		execSync(`git commit -m "${message}"`, { cwd: process.cwd() });
		commitHash = execSync("git rev-parse HEAD", { cwd: process.cwd() })
			.toString()
			.trim();
	} catch (err) {
		// Nothing to commit is not an error
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("nothing to commit")) {
			console.log(chalk.gray("Nothing to commit — working tree clean."));
			return;
		}
		throw err;
	}

	const branch = execSync("git branch --show-current", { cwd: process.cwd() })
		.toString()
		.trim();

	let db;
	try {
		db = getDb();
	} catch {
		// DB not available — still committed, just can't record the mark
		console.log(chalk.green(`✓ Marked: ${commitHash.substring(0, 8)}`));
		return;
	}

	let plotId = opts.plotId;
	if (!plotId) {
		const plot = db
			.select()
			.from(schema.plots)
			.all()
			.find((p) => p.branch === branch);
		plotId = plot?.id;
	}

	if (plotId) {
		db.insert(schema.marks)
			.values({
				id: crypto.randomUUID(),
				plotId,
				commitHash,
				branch,
				message,
				markType: "manual",
			})
			.run();
	}

	console.log(chalk.green(`✓ Mark created: ${commitHash.substring(0, 8)}`));
	console.log(chalk.gray(`  ${message}`));
}
