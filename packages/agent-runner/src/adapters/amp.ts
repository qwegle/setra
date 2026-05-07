/**
 * AmpAdapter — wraps the Sourcegraph Amp CLI (`amp` binary).
 *
 * Amp is Sourcegraph's AI coding agent. It routes through Sourcegraph's
 * model gateway so users don't need their own API keys.
 *
 * Amp CLI reference flags (approximate — verify against `amp --help`):
 *   --task <text>             Task description
 *   --model <id>              Model selection
 *   --accept-all              Auto-accept all suggested changes (CI mode)
 *   --json                    JSON output for parsing
 */

import { execFileSync } from "child_process";
import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

const AMP_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota/i,
	/too\s+many\s+requests/i,
] as const;

const AMP_COMPLETION_PATTERNS: readonly RegExp[] = [
	/✓\s+(?:done|complete)/i,
	/task\s+completed/i,
	/"status"\s*:\s*"(?:complete|done|success)"/i,
] as const;

const AMP_TOKENS_LINE = /tokens?:\s*(\d+)/i;
const AMP_COST_LINE = /cost:\s+\$([\d.]+)/i;

export class AmpAdapter implements AgentAdapter {
	readonly name = "amp" as const;
	readonly displayName = "Amp (Sourcegraph)";
	readonly supportsModels = ["claude-sonnet-4-5", "claude-opus-4-5"] as const;
	readonly defaultModel = "claude-sonnet-4-5";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["amp"], { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);

		const args: string[] = [
			"--task",
			run.task,
			"--model",
			model,
			"--accept-all",
		];

		args.push(...this.buildMcpArgs(mcpConfigPath));

		if (run.systemPromptAppend) {
			args.push(...this.buildSystemPromptArgs(run.systemPromptAppend));
		}

		return {
			cmd: "amp",
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
		return ["--system-prompt", systemPrompt];
	}

	buildMcpArgs(mcpConfigPath: string): string[] {
		// Amp may use a different flag — check `amp --help` when integrating.
		return ["--mcp-config", mcpConfigPath];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const match = AMP_TOKENS_LINE.exec(output);
		if (!match) return null;
		const total = Number.parseInt(match[1] ?? "0", 10);
		// Amp doesn't split prompt/completion in its summary line.
		// Best-effort: attribute 80% to prompt (typical for coding tasks).
		return {
			promptTokens: Math.round(total * 0.8),
			completionTokens: Math.round(total * 0.2),
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
	}

	parseCostUSD(output: string): number | null {
		const match = AMP_COST_LINE.exec(output);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return AMP_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	detectCompletion(output: string): boolean {
		return AMP_COMPLETION_PATTERNS.some((p) => p.test(output));
	}

	private resolveModel(modelId: string): string {
		if (!this.supportsModels.includes(modelId as never))
			return this.defaultModel;
		return modelId;
	}
}

export const ampAdapter = new AmpAdapter();
