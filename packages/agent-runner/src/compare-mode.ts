/**
 * MODEL COMPARISON MODE
 *
 * "Compare" runs the same task with two different models simultaneously,
 * then shows cost/quality side-by-side. This is setra's answer to the
 * "which model should I use for my team?" question.
 *
 * What gets compared:
 *   - Tokens used (prompt + completion, cache separately)
 *   - Cost in USD (actual, not estimated)
 *   - Time to completion (wall clock, from spawn to detectCompletion)
 *   - Files changed (git diff between worktree states)
 *   - A small-model quality judgment (optional, uses Haiku)
 *
 * How it works:
 *   1. Checkout two temporary worktree branches from the same base
 *   2. Spawn both agents concurrently (separate tmux sessions)
 *   3. Monitor both via PTY output streams
 *   4. When both complete (or timeout), collect metrics
 *   5. Run `git diff` on both worktrees
 *   6. Optionally ask Haiku: "which solution is better? why?"
 *   7. Return CompareResult for the UI
 *
 * Note: Compare mode requires the user to have BOTH adapters installed.
 * The UI shows adapter availability before allowing compare to start.
 */

import type { AgentAdapter } from "./adapter.js";
import type { Plot, Run, TokenUsage } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompareRunResult {
	adapterName: string;
	modelId: string;
	tokensUsed: TokenUsage;
	costUsd: number;
	durationMs: number;
	exitCode: number;
	/** Raw PTY output (ANSI stripped). */
	output: string;
	/** Files changed: path → unified diff string. */
	filesChanged: Record<string, string>;
	/** Whether this run completed successfully. */
	completed: boolean;
	error?: string;
}

export interface CompareResult {
	task: string;
	startedAt: Date;
	completedAt: Date;

	a: CompareRunResult;
	b: CompareRunResult;

	// Derived metrics (positive = A is better)
	costDeltaUsd: number; // a.costUsd - b.costUsd (negative = A is cheaper)
	timeDeltaMs: number; // a.durationMs - b.durationMs (negative = A is faster)
	tokenDelta: number; // total tokens A - total tokens B

	/**
	 * Optional quality judgment from Haiku.
	 * null if small-model is unavailable or judgeQuality is false.
	 */
	qualityJudgment: {
		winner: "a" | "b" | "tie";
		reasoning: string;
		model: string;
	} | null;
}

// ─── Compare runner ───────────────────────────────────────────────────────────

export interface CompareOptions {
	task: string;
	plot: Plot;
	adapterA: AgentAdapter;
	adapterB: AgentAdapter;
	modelA: string;
	modelB: string;
	mcpConfigPath: string;
	maxTurns?: number;
	budgetUsd?: number;
	/** Ask Haiku to judge output quality. Adds ~$0.001 per compare run. */
	judgeQuality?: boolean;
	/** Timeout in ms for each run. Default: 10 minutes. */
	timeoutMs?: number;
}

/**
 * Spawn description returned to the caller.
 * The actual PTY spawning is done by local-pty.ts — CompareMode just
 * coordinates the two runs and aggregates results.
 */
export interface ComparePlan {
	runA: Run;
	runB: Run;
	spawnA: ReturnType<AgentAdapter["buildCommand"]>;
	spawnB: ReturnType<AgentAdapter["buildCommand"]>;
}

/**
 * Build the spawn plans for both compare runs.
 * The caller (local-pty.ts) spawns them concurrently and calls
 * `aggregateResults()` once both complete.
 */
export function buildComparePlan(opts: CompareOptions): ComparePlan {
	const baseRun: Omit<Run, "id" | "agent" | "model"> = {
		plotId: opts.plot.id,
		task: opts.task,
		maxTurns: opts.maxTurns ?? 30,
		...(opts.budgetUsd !== undefined && { budgetUsd: opts.budgetUsd }),
	};

	const runA: Run = {
		...baseRun,
		id: `compare-a-${Date.now()}`,
		agent: opts.adapterA.name,
		model: opts.modelA,
	};

	const runB: Run = {
		...baseRun,
		id: `compare-b-${Date.now()}`,
		agent: opts.adapterB.name,
		model: opts.modelB,
	};

	return {
		runA,
		runB,
		spawnA: opts.adapterA.buildCommand(opts.plot, runA, opts.mcpConfigPath),
		spawnB: opts.adapterB.buildCommand(opts.plot, runB, opts.mcpConfigPath),
	};
}

/**
 * Aggregate raw run data into a CompareResult.
 * Call this after both runs have completed.
 */
export async function aggregateResults(
	task: string,
	startedAt: Date,
	a: CompareRunResult,
	b: CompareRunResult,
	opts: { judgeQuality?: boolean } = {},
): Promise<CompareResult> {
	const aTokens = a.tokensUsed.promptTokens + a.tokensUsed.completionTokens;
	const bTokens = b.tokensUsed.promptTokens + b.tokensUsed.completionTokens;

	let qualityJudgment: CompareResult["qualityJudgment"] = null;

	if (opts.judgeQuality && (a.completed || b.completed)) {
		qualityJudgment = await judgeQuality(task, a, b);
	}

	return {
		task,
		startedAt,
		completedAt: new Date(),
		a,
		b,
		costDeltaUsd: a.costUsd - b.costUsd,
		timeDeltaMs: a.durationMs - b.durationMs,
		tokenDelta: aTokens - bTokens,
		qualityJudgment,
	};
}

/**
 * Use the small model to judge which output is higher quality.
 * This is optional and adds ~$0.001 per compare run.
 */
async function judgeQuality(
	task: string,
	a: CompareRunResult,
	b: CompareRunResult,
): Promise<CompareResult["qualityJudgment"]> {
	try {
		const { callSmallModel } = await import("./small-model.js");

		// Summarize diffs for the judge (full diffs can be very long)
		const summaryA = summarizeOutput(a);
		const summaryB = summarizeOutput(b);

		const result = await callSmallModel({
			task: "trace_summary",
			systemPrompt: [
				"You are a code quality judge comparing two AI coding agent solutions.",
				"Given the same task and two solutions, determine which is better.",
				'Respond in JSON: {"winner": "a" | "b" | "tie", "reasoning": "<2 sentences max>"}',
				"Focus on: correctness, code quality, completeness.",
				"Output ONLY valid JSON, no other text.",
			].join("\n"),
			userMessage: [
				`Task: ${task}`,
				"",
				`Solution A (${a.adapterName}/${a.modelId}):`,
				summaryA,
				"",
				`Solution B (${b.adapterName}/${b.modelId}):`,
				summaryB,
			].join("\n"),
			maxTokens: 128,
		});

		if (!result) return null;

		const parsed = JSON.parse(result.content) as {
			winner: "a" | "b" | "tie";
			reasoning: string;
		};

		return {
			winner: parsed.winner,
			reasoning: parsed.reasoning,
			model: result.model,
		};
	} catch {
		return null;
	}
}

function summarizeOutput(run: CompareRunResult): string {
	const fileCount = Object.keys(run.filesChanged).length;
	const truncatedOutput = run.output.slice(-2_000);

	return [
		`Files changed: ${fileCount}`,
		`Cost: $${run.costUsd.toFixed(5)}`,
		`Duration: ${(run.durationMs / 1000).toFixed(1)}s`,
		"",
		"Last 2000 chars of output:",
		truncatedOutput,
	].join("\n");
}

// ─── Formatting helpers (for the Compare UI panel) ────────────────────────────

export function formatCompareResultSummary(result: CompareResult): string {
	const { a, b } = result;

	const cheaper = result.costDeltaUsd < 0 ? "B" : "A";
	const faster = result.timeDeltaMs < 0 ? "A" : "B";

	const lines = [
		`Task: ${result.task}`,
		"",
		`                    ${a.adapterName}/${a.modelId}   vs   ${b.adapterName}/${b.modelId}`,
		`Cost:               $${a.costUsd.toFixed(5)}              $${b.costUsd.toFixed(5)}   (${cheaper} is cheaper by $${Math.abs(result.costDeltaUsd).toFixed(5)})`,
		`Time:               ${(a.durationMs / 1000).toFixed(1)}s                  ${(b.durationMs / 1000).toFixed(1)}s   (${faster} is faster)`,
		`Tokens:             ${a.tokensUsed.promptTokens + a.tokensUsed.completionTokens}               ${b.tokensUsed.promptTokens + b.tokensUsed.completionTokens}`,
		`Files changed:      ${Object.keys(a.filesChanged).length}                  ${Object.keys(b.filesChanged).length}`,
	];

	if (result.qualityJudgment) {
		const { winner, reasoning, model } = result.qualityJudgment;
		const winnerLabel =
			winner === "tie" ? "Tie" : winner === "a" ? a.adapterName : b.adapterName;
		lines.push("");
		lines.push(`Quality (${model}): ${winnerLabel} — ${reasoning}`);
	}

	return lines.join("\n");
}
