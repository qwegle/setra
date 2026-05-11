/**
 * CodexAdapter — wraps the OpenAI Codex CLI (`codex exec` subcommand).
 *
 * Verified flags for codex-cli v0.128+:
 *   exec                                      Non-interactive subcommand
 *   -m, --model <id>                          Any OpenAI model (gpt-4o, gpt-5.5, o3, …)
 *   --dangerously-bypass-approvals-and-sandbox Skip all confirmations (full-auto equivalent)
 *   -C <dir>                                  Working directory
 *   --skip-git-repo-check                     Allow running outside a git repo
 *   --color never                             No ANSI color in output
 *
 * Note: --approval-mode, --quiet, and --mcp-config do NOT exist in v0.128.
 * MCP servers must be pre-configured in ~/.codex/config.toml.
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
	/cost:\s+\$[\d.]+/i,
] as const;

// eslint-disable-next-line no-control-regex
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const CODEX_COST_RE = /cost:\s+\$?([\d.]+)/i;
const CODEX_PROMPT_TOKENS_RE = /prompt tokens:\s+([\d,]+)/i;
const CODEX_COMPLETION_TOKENS_RE = /completion tokens:\s+([\d,]+)/i;
const CODEX_CACHED_TOKENS_RE = /cached tokens:\s+([\d,]+)/i;

export class CodexAdapter implements AgentAdapter {
	readonly name = "codex" as const;
	readonly displayName = "Codex CLI (OpenAI)";
	// Open-ended: codex supports any OpenAI model; we pass the ID through as-is.
	readonly supportsModels = [] as const;
	readonly defaultModel = "gpt-4o";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["codex"], { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = run.model?.trim() || this.defaultModel;

		// codex exec -m <model> --dangerously-bypass-approvals-and-sandbox
		//   --skip-git-repo-check --color never -C <cwd> <task>
		const args: string[] = [
			"exec",
			"-m",
			model,
			"--dangerously-bypass-approvals-and-sandbox",
			"--skip-git-repo-check",
			"--color",
			"never",
		];

		if (plot.worktreePath) {
			args.push("-C", plot.worktreePath);
		}

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
			// cwd still set so shell inherits it; -C is the codex-level override
			cwd: plot.worktreePath,
		};
	}

	buildSystemPromptArgs(systemPrompt: string): string[] {
		// codex exec supports --instructions for system-level context
		return ["--instructions", systemPrompt];
	}

	// MCP is configured globally in ~/.codex/config.toml — no CLI flag in v0.128
	buildMcpArgs(_mcpConfigPath: string): string[] {
		return [];
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
			cacheWriteTokens: 0,
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
}

export const codexAdapter = new CodexAdapter();
