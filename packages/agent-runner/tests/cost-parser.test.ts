/**
 * cost-parser.test.ts
 *
 * Unit tests for parseCostFromPtyOutput().
 *
 * IMPORTANT: These tests use real fixture files from tests/fixtures/.
 * The fixtures are the ground truth — if an agent CLI changes its output
 * format, update the fixture AND the regex in cost-tracker.ts together.
 *
 * To add a new agent: create tests/fixtures/{agent}-pty-output.txt,
 * add a describe block here, and implement the parser in cost-tracker.ts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCostFromPtyOutput } from "../src/cost-tracker.js";

function fixture(name: string): string {
	return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

// ─── Claude Code ──────────────────────────────────────────────────────────────

describe("Claude Code cost parser", () => {
	it("parses a complete run with cache hits", () => {
		const result = parseCostFromPtyOutput(
			"claude",
			fixture("claude-pty-output.txt"),
		);
		expect(result).toEqual({
			costUsd: 0.0523,
			inputTokens: 12345,
			outputTokens: 1234,
			cacheReadTokens: 10891,
			cacheWriteTokens: 2345,
			confidence: "high",
		});
	});

	it("parses a cold run with no cache", () => {
		const result = parseCostFromPtyOutput(
			"claude",
			fixture("claude-pty-cold.txt"),
		);
		expect(result).toEqual({
			costUsd: 0.1847,
			inputTokens: 45000,
			outputTokens: 3200,
			cacheReadTokens: 0,
			cacheWriteTokens: 45000,
			confidence: "high",
		});
	});

	it("returns the LAST cost block when multiple runs appear in the same PTY output", () => {
		const combined =
			fixture("claude-pty-output.txt") +
			"\n" +
			fixture("claude-pty-second-run.txt");
		const result = parseCostFromPtyOutput("claude", combined);
		// Must return the second run's cost, not the first
		expect(result?.costUsd).toBe(0.0089);
		expect(result?.inputTokens).toBe(2100);
	});

	it("returns null gracefully when no cost info is in the output", () => {
		const result = parseCostFromPtyOutput(
			"claude",
			"Hello from Claude\nNo cost here\n",
		);
		expect(result).toBeNull();
	});

	it("sets confidence=low when only the cost line is found (no token breakdown)", () => {
		const result = parseCostFromPtyOutput(
			"claude",
			fixture("claude-pty-cost-only.txt"),
		);
		expect(result?.confidence).toBe("low");
		expect(result?.costUsd).toBe(0.0147);
		expect(result?.inputTokens).toBe(0);
	});

	it("strips ANSI escape codes before parsing", () => {
		const withAnsi =
			"\x1b[32m  Total cost:\x1b[0m            \x1b[1m$0.0523\x1b[0m\n";
		const result = parseCostFromPtyOutput("claude", withAnsi);
		expect(result?.costUsd).toBe(0.0523);
	});

	it("parses comma-separated large token counts", () => {
		const output = [
			"  Total cost:            $1.2345",
			"  Token usage:",
			"    Input:               1,234,567",
			"    Output:              89,012",
			"    Cache read:          1,100,000",
			"    Cache write:         134,567",
		].join("\n");
		const result = parseCostFromPtyOutput("claude", output);
		expect(result?.inputTokens).toBe(1234567);
		expect(result?.outputTokens).toBe(89012);
		expect(result?.cacheReadTokens).toBe(1100000);
	});

	it("parses a zero-cost run (local model or fully cached)", () => {
		const output = [
			"  Total cost:            $0.0000",
			"  Token usage:",
			"    Input:               500",
			"    Output:              100",
			"    Cache read:          480",
			"    Cache write:         20",
		].join("\n");
		const result = parseCostFromPtyOutput("claude", output);
		expect(result?.costUsd).toBe(0);
		expect(result?.confidence).toBe("high");
	});

	it("does not misparse a number in unrelated output as a cost", () => {
		const misleading =
			"The function returned 0.0523 which is a valid probability\n";
		const result = parseCostFromPtyOutput("claude", misleading);
		expect(result).toBeNull();
	});
});

// ─── OpenAI Codex CLI ─────────────────────────────────────────────────────────

describe("Codex CLI cost parser", () => {
	it("parses a standard Codex usage block", () => {
		const result = parseCostFromPtyOutput(
			"codex",
			fixture("codex-pty-output.txt"),
		);
		expect(result).toEqual({
			costUsd: 0.0156,
			inputTokens: 1234,
			outputTokens: 456,
			cacheReadTokens: 891,
			cacheWriteTokens: 0, // Codex does not break out cache writes
			confidence: "high",
		});
	});

	it("parses Codex output that includes reasoning tokens (o-series)", () => {
		const result = parseCostFromPtyOutput(
			"codex",
			fixture("codex-pty-reasoning.txt"),
		);
		expect(result?.inputTokens).toBe(3400);
		expect(result?.outputTokens).toBe(780);
		expect(result?.cacheReadTokens).toBe(2100);
		expect(result?.confidence).toBe("high");
		// reasoning tokens are not tracked separately in our schema — they're in inputTokens
	});

	it("returns null when Codex exits with an error and no usage block", () => {
		const result = parseCostFromPtyOutput(
			"codex",
			"Error: rate limit exceeded\nTry again later.\n",
		);
		expect(result).toBeNull();
	});

	it('is case-insensitive for "cost:" keyword', () => {
		const output =
			"COST: $0.0099\nprompt tokens: 800\ncompletion tokens: 200\n";
		const result = parseCostFromPtyOutput("codex", output);
		expect(result?.costUsd).toBe(0.0099);
	});
});

// ─── Gemini CLI ───────────────────────────────────────────────────────────────

describe("Gemini CLI cost parser", () => {
	it("parses a standard Gemini usage footer", () => {
		const result = parseCostFromPtyOutput(
			"gemini",
			fixture("gemini-pty-output.txt"),
		);
		expect(result).toEqual({
			costUsd: 0.0023,
			inputTokens: 4500,
			outputTokens: 1178,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			confidence: "high",
		});
	});

	it("parses Gemini 2.5 Flash output with thinking tokens", () => {
		const result = parseCostFromPtyOutput(
			"gemini",
			fixture("gemini-pty-thinking.txt"),
		);
		expect(result?.inputTokens).toBe(6100);
		expect(result?.outputTokens).toBe(2134);
		expect(result?.costUsd).toBe(0.0031);
		expect(result?.confidence).toBe("high");
		// thinking tokens are not tracked in our schema (not separately billed)
	});

	it('falls back to confidence=low when only "Estimated cost" line is found', () => {
		const result = parseCostFromPtyOutput(
			"gemini",
			"Estimated cost: $0.0023\n",
		);
		expect(result?.confidence).toBe("low");
		expect(result?.costUsd).toBe(0.0023);
		expect(result?.inputTokens).toBe(0);
	});

	it("returns null when Gemini produces no cost output (cancelled early)", () => {
		const result = parseCostFromPtyOutput("gemini", "Interrupted by user.\n");
		expect(result).toBeNull();
	});
});

// ─── Custom agent ─────────────────────────────────────────────────────────────

describe("custom agent cost parser", () => {
	it("returns null for custom agent type (no parser defined)", () => {
		const result = parseCostFromPtyOutput("custom", "whatever output\n");
		expect(result).toBeNull();
	});
});

// ─── Unknown agent type ───────────────────────────────────────────────────────

describe("unknown agent type", () => {
	it("throws a descriptive error", () => {
		expect(() =>
			parseCostFromPtyOutput("gpt-5" as never, "output"),
		).toThrowError(/unknown agent type/i);
	});
});
