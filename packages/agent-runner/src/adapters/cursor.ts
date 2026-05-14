/**
 * CursorAdapter — wraps the Cursor CLI (`cursor-agent` binary, installed via
 * `curl https://cursor.com/install -fsS | bash`).
 *
 * Cursor CLI reference flags (verified against cursor-agent v0.4+):
 *   --print                        Non-interactive mode (one-shot)
 *   --output-format text|json      Output format
 *   --model <id>                   auto | gpt-5 | claude-sonnet-4 | claude-opus-4 | …
 *   --force                        Skip permission prompts (CI mode)
 *   -C / --cwd <dir>               Working directory
 *
 * Note: Cursor's CLI handles its own auth via `cursor-agent login`. We never
 * pass an API key. If the user is not logged in, isAvailable() still returns
 * true (binary is on PATH); the run will fail with a clear "not logged in"
 * message which the operator surfaces via the standard error pipeline.
 */

import { execFileSync } from "child_process";
import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export const CURSOR_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota\s+exceeded/i,
	/too\s+many\s+requests/i,
	/usage\s+limit\s+reached/i,
] as const;

const CURSOR_COMPLETION_PATTERNS: readonly RegExp[] = [
	/Task\s+complete\./i,
	/Done\.\s*$/m,
] as const;

// eslint-disable-next-line no-control-regex
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const CURSOR_TOKENS_RE = /tokens:\s+input\s+([\d,]+)\s*\/\s*output\s+([\d,]+)/i;
const CURSOR_COST_RE = /cost:\s+\$?([\d.]+)/i;

export class CursorAdapter implements AgentAdapter {
	readonly name = "cursor" as const;
	readonly displayName = "Cursor CLI";
	// Cursor accepts a closed set of routed-model aliases; "auto" is preferred.
	readonly supportsModels = [
		"auto",
		"gpt-5",
		"claude-sonnet-4",
		"claude-opus-4",
	] as const;
	readonly defaultModel = "auto";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["cursor-agent"], { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);

		const args: string[] = [
			"--print",
			"--output-format",
			"text",
			"--force",
			"--model",
			model,
		];

		if (plot.worktreePath) {
			args.push("--cwd", plot.worktreePath);
		}

		if (run.systemPromptAppend) {
			args.push(...this.buildSystemPromptArgs(run.systemPromptAppend));
		}

		args.push(run.task);

		return {
			cmd: "cursor-agent",
			args,
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
			},
			cwd: plot.worktreePath,
		};
	}

	buildSystemPromptArgs(systemPrompt: string): string[] {
		// Cursor CLI prepends the prompt as a system message via --system flag
		return ["--system", systemPrompt];
	}

	// MCP is configured globally in ~/.cursor/mcp.json — no CLI flag.
	buildMcpArgs(_mcpConfigPath: string): string[] {
		return [];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const clean = output.replace(STRIP_ANSI_RE, "");
		const match = CURSOR_TOKENS_RE.exec(clean);
		if (!match) return null;

		const parseNum = (s: string | undefined) =>
			Number.parseInt((s ?? "0").replace(/,/g, ""), 10);

		return {
			promptTokens: parseNum(match[1]),
			completionTokens: parseNum(match[2]),
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
	}

	parseCostUSD(output: string): number | null {
		const clean = output.replace(STRIP_ANSI_RE, "");
		const match = CURSOR_COST_RE.exec(clean);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return CURSOR_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	detectCompletion(output: string): boolean {
		return CURSOR_COMPLETION_PATTERNS.some((p) => p.test(output));
	}

	private resolveModel(modelId: string | null | undefined): string {
		const m = (modelId ?? "").trim();
		if (!m || !this.supportsModels.includes(m as never)) return this.defaultModel;
		return m;
	}
}

export const cursorAdapter = new CursorAdapter();
