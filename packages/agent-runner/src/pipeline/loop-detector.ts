/**
 * loop-detector.ts — in-run tool-call loop detection.
 *
 * Detects when an agent is stuck in a repetitive pattern (the same tool
 * call with the same arguments repeated, or the same error returned N
 * times in a row) and signals that the caller should inject a "you are
 * stuck — replan" system turn into the conversation.
 *
 * Usage:
 *
 *   const detector = new LoopDetector({ windowSize: 6, repeatThreshold: 3 });
 *   for each tool call:
 *     const signal = detector.record(toolName, args, errorMessage);
 *     if (signal.shouldReplan) inject system turn with signal.reason;
 *
 * The detector is intentionally cheap: O(1) per record() call and bounded
 * memory (the last N calls in a ring buffer).
 */

import { createHash } from "node:crypto";

export interface LoopDetectorOptions {
	/** Size of the sliding window of tool calls to keep. Default 8. */
	windowSize?: number;
	/** Repeats of the same call within the window that trigger a replan. Default 3. */
	repeatThreshold?: number;
	/** Consecutive errors that trigger a replan regardless of repetition. Default 3. */
	consecutiveErrorThreshold?: number;
}

export interface LoopSignal {
	shouldReplan: boolean;
	reason: string;
	kind: "repeat" | "error_streak" | "none";
}

interface CallRecord {
	hash: string;
	toolName: string;
	hadError: boolean;
}

function hashCall(toolName: string, args: unknown): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(args ?? {}, Object.keys(args ?? {}).sort());
	} catch {
		serialized = String(args);
	}
	return createHash("sha1")
		.update(`${toolName}|${serialized}`)
		.digest("hex");
}

export class LoopDetector {
	private buffer: CallRecord[] = [];
	private readonly windowSize: number;
	private readonly repeatThreshold: number;
	private readonly consecutiveErrorThreshold: number;
	private consecutiveErrors = 0;
	private hasFlagged = false;

	constructor(opts: LoopDetectorOptions = {}) {
		this.windowSize = Math.max(2, opts.windowSize ?? 8);
		this.repeatThreshold = Math.max(2, opts.repeatThreshold ?? 3);
		this.consecutiveErrorThreshold = Math.max(
			2,
			opts.consecutiveErrorThreshold ?? 3,
		);
	}

	/**
	 * Record a tool call. Returns a LoopSignal describing whether the agent
	 * appears stuck. The signal fires at most once per detector instance.
	 */
	record(
		toolName: string,
		args: unknown,
		errorMessage?: string | null,
	): LoopSignal {
		const hadError = Boolean(errorMessage);
		const hash = hashCall(toolName, args);
		this.buffer.push({ hash, toolName, hadError });
		if (this.buffer.length > this.windowSize) this.buffer.shift();

		if (hadError) this.consecutiveErrors += 1;
		else this.consecutiveErrors = 0;

		if (this.hasFlagged)
			return { shouldReplan: false, reason: "", kind: "none" };

		if (this.consecutiveErrors >= this.consecutiveErrorThreshold) {
			this.hasFlagged = true;
			return {
				shouldReplan: true,
				kind: "error_streak",
				reason: `You have hit ${this.consecutiveErrors} tool errors in a row. Stop and re-evaluate: state the root cause in one sentence, then try a different approach (different tool, different arguments, or ask for help via post_issue_comment).`,
			};
		}

		const counts = new Map<string, number>();
		for (const rec of this.buffer) {
			counts.set(rec.hash, (counts.get(rec.hash) ?? 0) + 1);
		}
		for (const [, count] of counts) {
			if (count >= this.repeatThreshold) {
				this.hasFlagged = true;
				return {
					shouldReplan: true,
					kind: "repeat",
					reason: `You have called \`${toolName}\` with the same arguments ${count} times in the last ${this.buffer.length} steps. You are stuck in a loop. Stop and re-plan: explain why the call is not progressing, then take a different action.`,
				};
			}
		}

		return { shouldReplan: false, reason: "", kind: "none" };
	}

	/**
	 * Reset after a replan has been injected and consumed. The detector
	 * will start watching again from a clean slate.
	 */
	reset(): void {
		this.buffer = [];
		this.consecutiveErrors = 0;
		this.hasFlagged = false;
	}
}
