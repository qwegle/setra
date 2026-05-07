/**
 * setra trace search <query>
 * setra trace list
 *
 * Semantic search across all past run traces via sqlite-vec.
 * Output is formatted for terminal (no TUI required).
 *
 * Example:
 *   $ setra trace search "JWT middleware refresh token"
 *
 *   ┌─ Traces matching "JWT middleware refresh token" ─────────────────┐
 *   │  92%  feat/add-auth   2d ago  JWT middleware in src/auth/        │
 *   │  87%  fix/null-ptr    5d ago  Fixed NPE in auth service          │
 *   └────────────────────────────────────────────────────────────────── ┘
 *
 *   [1] feat/add-auth · 2d ago
 *       …wrote the JWT middleware with refresh token rotation. Used
 *       jose library. Tokens expire in 15m with 7d refresh window…
 */

import chalk from "chalk";
import { api, getClient } from "../ipc/socket.js";
import { c, icon, palette, relativeTime, truncate } from "../tui/theme.js";

export type TraceSearchOptions = {
	limit?: string;
	plot?: string;
	json?: boolean;
};

export async function runTraceSearch(
	query: string,
	opts: TraceSearchOptions,
): Promise<void> {
	try {
		await getClient().connect();
	} catch {
		console.error(`  ${icon.error} setra-core not running`);
		process.exit(1);
	}

	const results = await api.traces.search(query, {
		limit: Number.parseInt(opts.limit ?? "10", 10),
		plotId: opts.plot,
	});

	if (opts.json) {
		console.log(JSON.stringify(results, null, 2));
		getClient().disconnect();
		return;
	}

	if (results.length === 0) {
		console.log(`\n  ${icon.idle} No traces matching ${chalk.italic(query)}\n`);
		getClient().disconnect();
		return;
	}

	console.log(
		`\n  ${c.accent(icon.trace + " Traces")} matching ${chalk.italic(`"${query}"`)}\n`,
	);

	for (const [i, trace] of results.entries()) {
		const score = Math.round(trace.score * 100);
		const time = relativeTime(new Date(trace.createdAt));
		const bar =
			"█".repeat(Math.round(score / 10)) +
			"░".repeat(10 - Math.round(score / 10));

		// Row
		const barColored =
			score > 85
				? chalk.hex(palette.success)(bar)
				: score > 60
					? chalk.hex(palette.warning)(bar)
					: chalk.hex(palette.textMuted)(bar);

		console.log(
			`  ${barColored}  ${String(score).padStart(3)}%  ` +
				`${c.secondary(truncate(trace.plotId.slice(0, 20), 20)).padEnd(22)}  ` +
				`${time}  ` +
				truncate(trace.summary, 40),
		);

		// Snippet
		if (trace.content) {
			const snippet = trace.content.slice(0, 160).replace(/\n/g, " ");
			console.log(`  ${chalk.dim("│")}  ${chalk.dim(truncate(snippet, 72))}`);
		}
		console.log("");
	}

	getClient().disconnect();
}

export async function runTraceList(): Promise<void> {
	try {
		await getClient().connect();
	} catch {
		console.error(`  ${icon.error} setra-core not running`);
		process.exit(1);
	}

	const traces = await api.traces.list();
	console.log(`\n  ${c.accent("Recent Traces")}  (${traces.length})\n`);

	for (const trace of traces.slice(0, 20)) {
		const time = relativeTime(new Date(trace.createdAt));
		console.log(
			`  ${icon.trace}  ${c.secondary(truncate(trace.plotId, 22)).padEnd(24)}  ` +
				`${time}  ${truncate(trace.summary, 50)}`,
		);
	}

	console.log("");
	getClient().disconnect();
}

// ─────────────────────────────────────────────────────────────────────────────
// setra trace search — local semantic memory search via @setra/memory
// ─────────────────────────────────────────────────────────────────────────────

export type MemorySearchOptions = { limit?: number; minScore?: number };

export async function memorySearchCommand(
	query: string,
	opts: MemorySearchOptions = {},
): Promise<void> {
	const { getMemoryStore } = await import("@setra/memory");
	const store = getMemoryStore();
	await store.init();

	const results = await store.search(query, {
		limit: opts.limit ?? 10,
		minScore: opts.minScore ?? 0.3,
	});

	if (results.length === 0) {
		console.log(
			`\n  ${icon.idle} No memories matching ${chalk.italic(`"${query}"`)}\n`,
		);
		return;
	}

	console.log(
		`\n  ${c.accent("⬡ Memory")} matching ${chalk.italic(`"${query}"`)}\n`,
	);

	const colWidths = { score: 5, content: 60, meta: 30 };

	// Header
	console.log(
		chalk.dim(
			`  ${"SCORE".padEnd(colWidths.score)}  ${"CONTENT PREVIEW".padEnd(colWidths.content)}  METADATA`,
		),
	);
	console.log(
		chalk.dim(
			`  ${"─".repeat(colWidths.score + colWidths.content + colWidths.meta + 6)}`,
		),
	);

	for (const { entry, score } of results) {
		const pct = Math.round(score * 100);
		const scoreStr = String(pct).padStart(3) + "%";
		const scoreColored =
			pct > 80
				? chalk.hex(palette.success)(scoreStr)
				: pct > 55
					? chalk.hex(palette.warning)(scoreStr)
					: chalk.hex(palette.textMuted)(scoreStr);

		const contentPreview = entry.content
			.replace(/\n/g, " ")
			.slice(0, colWidths.content);

		const metaEntries = Object.entries(entry.metadata)
			.map(([k, v]) => `${k}=${String(v).slice(0, 15)}`)
			.slice(0, 3)
			.join(" ");

		const plotTag = entry.plotId
			? chalk.dim(`[${entry.plotId.slice(0, 12)}]`)
			: "";

		console.log(
			`  ${scoreColored}  ${truncate(contentPreview, colWidths.content).padEnd(colWidths.content)}  ${plotTag} ${chalk.dim(metaEntries)}`,
		);
	}

	console.log("");
}
