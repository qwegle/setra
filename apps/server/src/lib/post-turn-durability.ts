/**
 * post-turn-durability.ts — verify a run actually produced observable output.
 *
 * Mirrors WUPHF's headlessTurnCompletedDurably (headless_codex_recovery.go).
 * After every successful run, check whether the agent left any of:
 *   1. chunks   — at least one streamed message
 *   2. tool_calls — at least one structured tool invocation
 *   3. files_touched — at least one edited file in the worktree
 *
 * Without any of the above, the "success" is suspect: the agent ran for N
 * minutes, exited 0, and produced nothing observable. We flag those runs so
 * the orchestrator can decide whether to retry, escalate, or open a self-heal
 * approval. We deliberately do NOT mutate run.status here — this is an
 * advisory signal that callers compose into their existing flow.
 */

import { getRawDb } from "@setra/db";

export interface DurabilityCheckResult {
	runId: string;
	durable: boolean;
	chunkCount: number;
	toolCallCount: number;
	filesTouched: number;
	reason?: string;
}

interface RunCountersRow {
	chunkCount: number | null;
	toolCallCount: number | null;
	filesTouched: number | null;
}

/**
 * Inspect a run's evidence counters and decide whether the turn produced
 * anything durable. Cheap O(1) query — uses the denormalized columns from
 * migration 0011 and a single COUNT against chunks. Safe to call in the hot
 * completion path.
 */
export function checkPostTurnDurability(
	runId: string,
	db: ReturnType<typeof getRawDb> = getRawDb(),
): DurabilityCheckResult {
	const counters = db
		.prepare(
			`SELECT
                COALESCE((SELECT COUNT(*) FROM chunks WHERE run_id = ?), 0) AS chunkCount,
                COALESCE(tool_calls_count, 0) AS toolCallCount,
                COALESCE(files_touched_count, 0) AS filesTouched
             FROM runs
            WHERE id = ?`,
		)
		.get(runId, runId) as RunCountersRow | undefined;

	const chunkCount = counters?.chunkCount ?? 0;
	const toolCallCount = counters?.toolCallCount ?? 0;
	const filesTouched = counters?.filesTouched ?? 0;

	const durable = chunkCount > 0 || toolCallCount > 0 || filesTouched > 0;

	const result: DurabilityCheckResult = {
		runId,
		durable,
		chunkCount,
		toolCallCount,
		filesTouched,
	};
	if (!durable) {
		result.reason =
			"run produced no chunks, no tool calls, and touched no files; treating as non-durable success";
	}
	return result;
}
