/**
 * cost-tracker.ts
 *
 * Parses token usage and cost from PTY output for each supported agent type.
 *
 * FRAGILE: Each agent CLI prints cost in a different format.
 * Any agent update can silently break the parser.
 * Unit tests with fixture files are the only defense.
 * See: tests/cost-parser.test.ts, tests/fixtures/
 *
 * When a parse fails, log it but NEVER throw — the run must continue.
 * Set confidence='none' and move on. A missed cost entry is better
 * than a crashed run.
 */

export type AgentType = "claude" | "gemini" | "codex" | "custom";

export type CostParseConfidence = "high" | "low" | "none";

export interface ParsedCost {
	costUsd: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	confidence: CostParseConfidence;
}

/**
 * Strip ANSI escape codes so regexes work on raw PTY output.
 */
function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/\x1b\[[0-9;]*[mGKHFABCDJsu]/g, "");
}

/**
 * Parse a possibly comma-separated number string like "12,345" → 12345.
 */
function parseTokenCount(s: string): number {
	return Number.parseInt(s.replace(/,/g, ""), 10) || 0;
}

/**
 * Parse a dollar amount string like "$0.0523" or "0.0523" → 0.0523.
 */
function parseCostAmount(s: string): number {
	return Number.parseFloat(s.replace(/^\$/, "")) || 0;
}

// ─── Claude Code ──────────────────────────────────────────────────────────────
// Output format (claude-code, claude-opus-4, claude-sonnet-4):
//
//   Total cost:            $0.0523
//   Total duration (API):  8.457s
//   Total duration (wall): 43.201s
//   Turns:                 3
//
//   Token usage:
//     Input:               12,345
//     Output:              1,234
//     Cache read:          10,891
//     Cache write:         2,345
//
// The "Total cost:" line is always present. Token breakdown is present
// in most runs but may be absent in short runs or error exits.

const CLAUDE_COST_RE = /Total cost:\s+\$?([\d.]+)/g;
const CLAUDE_INPUT_RE = /Input:\s+([\d,]+)/;
const CLAUDE_OUTPUT_RE = /Output:\s+([\d,]+)/;
const CLAUDE_CACHE_READ_RE = /Cache read:\s+([\d,]+)/;
const CLAUDE_CACHE_WRITE_RE = /Cache write:\s+([\d,]+)/;

function parseClaude(output: string): ParsedCost | null {
	const clean = stripAnsi(output);

	// Find ALL cost occurrences — return the last one (most recent run)
	const allCostMatches = [...clean.matchAll(CLAUDE_COST_RE)];
	if (allCostMatches.length === 0) return null;

	const lastCostMatch = allCostMatches[allCostMatches.length - 1];
	if (!lastCostMatch) return null;
	const costUsd = parseCostAmount(lastCostMatch[1] ?? "0");

	// Find the token block that comes AFTER the last cost line
	const lastCostIndex = clean.lastIndexOf(lastCostMatch[0] ?? "");
	const afterLastCost = clean.slice(lastCostIndex);

	const inputMatch = afterLastCost.match(CLAUDE_INPUT_RE);
	const outputMatch = afterLastCost.match(CLAUDE_OUTPUT_RE);

	if (!inputMatch || !outputMatch) {
		// We have cost but no token breakdown — low confidence
		return {
			costUsd,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			confidence: "low",
		};
	}

	return {
		costUsd,
		inputTokens: parseTokenCount(inputMatch[1] ?? "0"),
		outputTokens: parseTokenCount(outputMatch[1] ?? "0"),
		cacheReadTokens: parseTokenCount(
			afterLastCost.match(CLAUDE_CACHE_READ_RE)?.[1] ?? "0",
		),
		cacheWriteTokens: parseTokenCount(
			afterLastCost.match(CLAUDE_CACHE_WRITE_RE)?.[1] ?? "0",
		),
		confidence: "high",
	};
}

// ─── OpenAI Codex CLI ─────────────────────────────────────────────────────────
// Output format (codex CLI, codex-mini, o4-mini):
//
//   Usage
//     prompt tokens:     1,234
//     completion tokens: 456
//     reasoning tokens:  512   (optional — o-series models only)
//     total tokens:      1,690
//     cached tokens:     891
//     cost:              $0.0156
//
// "cost:" line may also appear as "Estimated cost: $X.XX" in some versions.

const CODEX_COST_RE = /cost:\s+\$?([\d.]+)/i;
const CODEX_PROMPT_TOKENS_RE = /prompt tokens:\s+([\d,]+)/i;
const CODEX_COMPLETION_TOKENS_RE = /completion tokens:\s+([\d,]+)/i;
const CODEX_CACHED_TOKENS_RE = /cached tokens:\s+([\d,]+)/i;

function parseCodex(output: string): ParsedCost | null {
	const clean = stripAnsi(output);

	const costMatch = clean.match(CODEX_COST_RE);
	if (!costMatch) return null;

	const promptMatch = clean.match(CODEX_PROMPT_TOKENS_RE);
	const completionMatch = clean.match(CODEX_COMPLETION_TOKENS_RE);
	const cachedMatch = clean.match(CODEX_CACHED_TOKENS_RE);

	if (!promptMatch || !completionMatch) {
		return {
			costUsd: parseCostAmount(costMatch[1] ?? "0"),
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			confidence: "low",
		};
	}

	return {
		costUsd: parseCostAmount(costMatch[1] ?? "0"),
		inputTokens: parseTokenCount(promptMatch[1] ?? "0"),
		outputTokens: parseTokenCount(completionMatch[1] ?? "0"),
		cacheReadTokens: parseTokenCount(cachedMatch?.[1] ?? "0"),
		cacheWriteTokens: 0, // Codex CLI does not report cache write tokens separately
		confidence: "high",
	};
}

// ─── Gemini CLI ───────────────────────────────────────────────────────────────
// Output format (gemini-2.5-pro, gemini-2.5-flash):
//
//   Model:          gemini-2.5-pro
//   Tokens used:    5,678 (input: 4,500 / output: 1,178)
//   Estimated cost: $0.0023
//
// Flash variant with thinking tokens:
//   Tokens used:    8,234 (input: 6,100 / output: 2,134)
//   Thinking tokens: 1,450
//   Estimated cost: $0.0031

const GEMINI_COST_RE = /Estimated cost:\s+\$?([\d.]+)/i;
const GEMINI_TOKENS_RE =
	/Tokens used:\s+[\d,]+\s+\(input:\s+([\d,]+)\s*\/\s*output:\s+([\d,]+)\)/i;

function parseGemini(output: string): ParsedCost | null {
	const clean = stripAnsi(output);

	const costMatch = clean.match(GEMINI_COST_RE);
	if (!costMatch) return null;

	const tokensMatch = clean.match(GEMINI_TOKENS_RE);

	if (!tokensMatch) {
		return {
			costUsd: parseCostAmount(costMatch[1] ?? "0"),
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			confidence: "low",
		};
	}

	return {
		costUsd: parseCostAmount(costMatch[1] ?? "0"),
		inputTokens: parseTokenCount(tokensMatch[1] ?? "0"),
		outputTokens: parseTokenCount(tokensMatch[2] ?? "0"),
		cacheReadTokens: 0, // Gemini CLI does not expose cache tokens yet
		cacheWriteTokens: 0,
		confidence: "high",
	};
}

// ─── Public API ───────────────────────────────────────────────────────────────

const parsers: Record<AgentType, (output: string) => ParsedCost | null> = {
	claude: parseClaude,
	codex: parseCodex,
	gemini: parseGemini,
	custom: () => null, // custom agents: no cost parsing; user must configure their own
};

/**
 * Parse cost and token usage from PTY output for a given agent type.
 *
 * Returns null if no cost information found in the output.
 * Never throws — log and return null on any error.
 *
 * @param agentType - The agent adapter type
 * @param ptyOutput - Raw PTY output (may contain ANSI escape codes)
 */
export function parseCostFromPtyOutput(
	agentType: AgentType,
	ptyOutput: string,
): ParsedCost | null {
	const parser = parsers[agentType];
	if (!parser) {
		throw new Error(
			`parseCostFromPtyOutput: unknown agent type '${agentType}'`,
		);
	}

	try {
		return parser(ptyOutput);
	} catch (err) {
		// Never crash a run because of a cost parse failure.
		// The cost_confidence column handles this: set to 'none' in the caller.
		console.warn(`[cost-tracker] Failed to parse cost for ${agentType}:`, err);
		return null;
	}
}
