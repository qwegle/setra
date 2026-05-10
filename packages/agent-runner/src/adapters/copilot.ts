/**
 * CopilotAdapter — wraps the GitHub Copilot CLI (`copilot` binary).
 *
 * The Copilot CLI exposes a one-shot mode suitable for non-interactive
 * orchestration. Common flags:
 *   -p, --prompt <text>        Prompt to run (positional also accepted)
 *   --model <id>               claude-opus-4.7 | claude-sonnet-4.6 | gpt-5.4 | ...
 *   --allow-all-tools          Skip per-tool approval (paired with sandboxed run dirs)
 *   --no-color                 Disable ANSI colour codes
 *
 * Authentication: the user must run `copilot auth login` once. The adapter
 * invokes `copilot auth status` for availability detection so a missing
 * subscription, expired token, or unauthenticated install all fail in the
 * same channel as a missing binary.
 */

import { execFileSync } from "node:child_process";
import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export const COPILOT_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota\s+exceeded/i,
	/too\s+many\s+requests/i,
	/usage\s+limit/i,
	/premium\s+request/i,
] as const;

const COPILOT_COMPLETION_PATTERNS: readonly RegExp[] = [
	/Total tokens used/i,
	/Session ended\./i,
	/^>\s*Done\s*$/im,
] as const;

const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const COPILOT_PROMPT_TOKENS_RE = /prompt\s+tokens?:\s+([\d,]+)/i;
const COPILOT_COMPLETION_TOKENS_RE = /completion\s+tokens?:\s+([\d,]+)/i;
const COPILOT_TOTAL_TOKENS_RE = /total\s+tokens?:\s+([\d,]+)/i;

export class CopilotAdapter implements AgentAdapter {
	readonly name = "copilot" as const;
	readonly displayName = "GitHub Copilot CLI";
	readonly supportsModels = [
		"auto",
		"claude-opus-4.7",
		"claude-opus-4.6",
		"claude-sonnet-4.6",
		"claude-sonnet-4.5",
		"gpt-5.4",
		"gpt-5.3-codex",
		"gpt-4.1",
	] as const;
	readonly defaultModel = "claude-sonnet-4.6";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["copilot"], { stdio: "pipe" });
		} catch {
			return false;
		}
		try {
			execFileSync("copilot", ["auth", "status"], {
				stdio: "pipe",
				timeout: 5000,
			});
			return true;
		} catch {
			// Binary present but unauthenticated. Surface as "not available" so
			// the dispatcher avoids spawning runs that will block on a login
			// prompt; the UI tells the operator to run `copilot auth login`.
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);
		const args: string[] = ["--no-color", "--allow-all-tools"];
		if (model !== "auto") {
			args.push("--model", model);
		}
		args.push(...this.buildMcpArgs(mcpConfigPath));
		if (run.systemPromptAppend) {
			args.push(...this.buildSystemPromptArgs(run.systemPromptAppend));
		}
		args.push("-p", run.task);
		return {
			cmd: "copilot",
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
		// Copilot CLI exposes --system-prompt on recent builds; older builds fall
		// back silently when the flag is unknown so we always emit it.
		return ["--system-prompt", systemPrompt];
	}

	buildMcpArgs(mcpConfigPath: string): string[] {
		return ["--mcp-config", mcpConfigPath];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const clean = output.replace(STRIP_ANSI_RE, "");
		const parseNum = (s: string | undefined) =>
			Number.parseInt((s ?? "0").replace(/,/g, ""), 10);
		const promptMatch = COPILOT_PROMPT_TOKENS_RE.exec(clean);
		const completionMatch = COPILOT_COMPLETION_TOKENS_RE.exec(clean);
		if (promptMatch && completionMatch) {
			return {
				promptTokens: parseNum(promptMatch[1]),
				completionTokens: parseNum(completionMatch[1]),
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			};
		}
		// Fallback: only the total is reported in some Copilot CLI versions.
		const totalMatch = COPILOT_TOTAL_TOKENS_RE.exec(clean);
		if (totalMatch) {
			return {
				promptTokens: 0,
				completionTokens: parseNum(totalMatch[1]),
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			};
		}
		return null;
	}

	parseCostUSD(_output: string): number | null {
		// Copilot CLI bills against a flat subscription; no per-run cost is
		// emitted to stdout. Cost reporting flows through usage:premium counters
		// in the billing surface, not through this adapter.
		return null;
	}

	detectRateLimit(output: string): boolean {
		return COPILOT_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	detectCompletion(output: string): boolean {
		return COPILOT_COMPLETION_PATTERNS.some((p) => p.test(output));
	}

	private resolveModel(modelId: string): string {
		if (!this.supportsModels.includes(modelId as never)) {
			return this.defaultModel;
		}
		return modelId;
	}
}

export const copilotAdapter = new CopilotAdapter();
