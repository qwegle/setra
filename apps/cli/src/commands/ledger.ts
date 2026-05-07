import { getDb, schema } from "@setra/db";
import chalk from "chalk";

export async function ledgerCommand(opts: { json: boolean }): Promise<void> {
	let db;
	try {
		db = getDb();
	} catch {
		console.error("No setra database found. Run: setra init");
		process.exit(1);
	}

	const runs = db.select().from(schema.runs).all();
	const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
	const totalPrompt = runs.reduce((s, r) => s + r.promptTokens, 0);
	const totalCompletion = runs.reduce((s, r) => s + r.completionTokens, 0);
	const totalCacheRead = runs.reduce((s, r) => s + r.cacheReadTokens, 0);
	const totalCacheWrite = runs.reduce((s, r) => s + r.cacheWriteTokens, 0);
	const totalInput = totalPrompt + totalCacheRead;
	const cacheHitRate = totalInput > 0 ? totalCacheRead / totalInput : 0;

	const summary = {
		totalCostUsd: totalCost,
		totalRuns: runs.length,
		totalPromptTokens: totalPrompt,
		totalCompletionTokens: totalCompletion,
		totalCacheReadTokens: totalCacheRead,
		totalCacheWriteTokens: totalCacheWrite,
		cacheHitRate,
	};

	if (opts.json) {
		console.log(JSON.stringify(summary, null, 2));
		return;
	}

	console.log(chalk.bold("\n  setra ledger\n"));
	console.log(
		`  Total cost:        ${chalk.yellow("$" + totalCost.toFixed(4))}`,
	);
	console.log(`  Total runs:        ${chalk.white(String(runs.length))}`);
	console.log(
		`  Prompt tokens:     ${chalk.gray(totalPrompt.toLocaleString())}`,
	);
	console.log(
		`  Completion tokens: ${chalk.gray(totalCompletion.toLocaleString())}`,
	);
	console.log(
		`  Cache read tokens: ${chalk.green(totalCacheRead.toLocaleString())}`,
	);
	console.log(
		`  Cache write tokens:${chalk.cyan(totalCacheWrite.toLocaleString())}`,
	);
	console.log(
		`  Cache hit rate:    ${cacheHitRate > 0.5 ? chalk.green((cacheHitRate * 100).toFixed(1) + "%") : chalk.yellow((cacheHitRate * 100).toFixed(1) + "%")}`,
	);
	console.log();
}
