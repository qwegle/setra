/**
 * CodexAdapter — wraps the OpenAI Codex CLI (`codex` binary).
 *
 * Codex CLI reference flags:
 *   --model <id>              gpt-4o | gpt-4o-mini | o1
 *   --approval-mode <mode>    "auto" | "suggest" | "full-auto"
 *   --quiet                   Suppress non-essential output
 *   --mcp-config <path>       MCP config (if supported by version)
 *   <task>                    Positional task argument
 */

import { execFileSync } from "child_process";
import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export const CODEX_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota\s+exceeded/i,
	/too\s+many\s+requests/i,
	/insufficient_quota/i,
	/billing/i,
] as const;

const CODEX_COMPLETION_PATTERNS: readonly RegExp[] = [
	/Task\s+complete\./i,
	/cost:\s+\$[\d.]+/i, // The cost line is always last in Codex's Usage block
] as const;

// Real Codex CLI output format (see tests/fixtures/codex-pty-output.txt):
//   Usage
//     prompt tokens:     1,234
//     completion tokens: 456
//     total tokens:      1,690
//     cached tokens:     891
//     cost:              $0.0156
// eslint-disable-next-line no-control-regex
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const CODEX_COST_RE = /cost:\s+\$?([\d.]+)/i;
const CODEX_PROMPT_TOKENS_RE = /prompt tokens:\s+([\d,]+)/i;
const CODEX_COMPLETION_TOKENS_RE = /completion tokens:\s+([\d,]+)/i;
const CODEX_CACHED_TOKENS_RE = /cached tokens:\s+([\d,]+)/i;

export class CodexAdapter implements AgentAdapter {
	readonly name = "codex" as const;
	readonly displayName = "Codex CLI (OpenAI)";
	readonly supportsModels = ["gpt-4o", "gpt-4o-mini", "o1"] as const;
	readonly defaultModel = "gpt-4o";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["codex"], { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);

		const args: string[] = [
			"--model",
			model,
			"--approval-mode",
			"full-auto",
			"--quiet",
		];

		args.push(...this.buildMcpArgs(mcpConfigPath));

		if (run.systemPromptAppend) {
			args.push(...this.buildSystemPromptArgs(run.systemPromptAppend));
		}

		args.push(run.task);

		return {
			cmd: "codex",
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
		return ["--instructions", systemPrompt];
	}

	buildMcpArgs(mcpConfigPath: string): string[] {
		return ["--mcp-config", mcpConfigPath];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const clean = output.replace(STRIP_ANSI_RE, "");
		const parseNum = (s: string | undefined) =>
			Number.parseInt((s ?? "0").replace(/,/g, ""), 10);

		const promptMatch = CODEX_PROMPT_TOKENS_RE.exec(clean);
		const completionMatch = CODEX_COMPLETION_TOKENS_RE.exec(clean);
		if (!promptMatch || !completionMatch) return null;

		return {
			promptTokens: parseNum(promptMatch[1]),
			completionTokens: parseNum(completionMatch[1]),
			cacheReadTokens: parseNum(CODEX_CACHED_TOKENS_RE.exec(clean)?.[1]),
			cacheWriteTokens: 0, // Codex CLI does not report cache writes
		};
	}

	parseCostUSD(output: string): number | null {
		const clean = output.replace(STRIP_ANSI_RE, "");
		const match = CODEX_COST_RE.exec(clean);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return CODEX_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	detectCompletion(output: string): boolean {
		return CODEX_COMPLETION_PATTERNS.some((p) => p.test(output));
	}

	private resolveModel(modelId: string): string {
		if (!this.supportsModels.includes(modelId as never))
			return this.defaultModel;
		return modelId;
	}
}

export const codexAdapter = new CodexAdapter();
