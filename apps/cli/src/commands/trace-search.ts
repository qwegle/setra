import { getDb, schema } from "@setra/db";
import chalk from "chalk";
import { eq } from "drizzle-orm";

interface TraceSearchOptions {
	query: string;
	topK: number;
}

export async function traceSearchCommand(
	opts: TraceSearchOptions,
): Promise<void> {
	let db;
	try {
		db = getDb();
	} catch {
		console.error(chalk.red("No setra database."));
		process.exit(1);
	}

	// Phase 1: simple text search (sqlite LIKE). Phase 2: vector search via sqlite-vec.
	const traces = db
		.select()
		.from(schema.traces)
		.all()
		.filter((t) => t.content.toLowerCase().includes(opts.query.toLowerCase()))
		.slice(0, opts.topK);

	if (traces.length === 0) {
		console.log(chalk.gray(`No traces found for: "${opts.query}"`));
		console.log(chalk.gray("Memory is populated after each run completes."));
		return;
	}

	console.log(chalk.bold(`\n  Traces matching "${opts.query}"\n`));

	for (const trace of traces) {
		const preview = trace.content.substring(0, 200).replace(/\n/g, " ");
		console.log(
			`  ${chalk.cyan(trace.id.substring(0, 8))} · ${chalk.gray(trace.createdAt.substring(0, 10))}`,
		);
		console.log(`  ${preview}`);
		console.log();
	}
}
