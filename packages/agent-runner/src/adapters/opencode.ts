/**
 * OpenCodeAdapter — wraps the OpenCode CLI (`opencode` binary).
 *
 * OpenCode is an OpenAI-compatible CLI that works with any endpoint.
 * Model is configured via OPENAI_BASE_URL + OPENAI_API_KEY env vars
 * or via --model flag.
 *
 * OpenCode CLI reference flags:
 *   run <task>                Run a task non-interactively
 *   --model <id>              Model identifier
 *   --quiet                   Minimal output
 */

import { execFileSync } from "child_process";
import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

const OPENCODE_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota\s+exceeded/i,
	/too\s+many\s+requests/i,
] as const;

const OPENCODE_COMPLETION_PATTERNS: readonly RegExp[] = [
	/\[done\]/i,
	/completed/i,
	/prompt_tokens/i,
] as const;

const OPENCODE_TOKENS_LINE =
	/prompt_tokens[=:\s]+(\d+).*?completion_tokens[=:\s]+(\d+)/i;
const OPENCODE_COST_LINE = /cost[=:\s]+\$([\d.]+)/i;

export class OpenCodeAdapter implements AgentAdapter {
	readonly name = "opencode" as const;
	readonly displayName = "OpenCode CLI";
	// OpenCode accepts any OpenAI-compatible model. We list common ones
	// but the user can type any model ID in the model selector.
	readonly supportsModels = ["gpt-4o", "gpt-4o-mini", "o1", "custom"] as const;
	readonly defaultModel = "gpt-4o";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["opencode"], { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, mcpConfigPath: string): SpawnOptions {
		const model = run.model !== "auto" ? run.model : this.defaultModel;

		const args: string[] = ["run", "--model", model];

		args.push(...this.buildMcpArgs(mcpConfigPath));

		if (run.systemPromptAppend) {
			args.push(...this.buildSystemPromptArgs(run.systemPromptAppend));
		}

		args.push(run.task);

		const env: Record<string, string | undefined> = {
			SETRA_PLOT_ID: plot.id,
			SETRA_RUN_ID: run.id,
			SETRA_AGENT: this.name,
			SETRA_MODEL: model,
		};

		// Pass through the custom base URL if the user has configured one.
		if (process.env["OPENAI_BASE_URL"]) {
			env["OPENAI_BASE_URL"] = process.env["OPENAI_BASE_URL"];
		}

		return { cmd: "opencode", args, env, cwd: plot.worktreePath };
	}

	buildSystemPromptArgs(systemPrompt: string): string[] {
		return ["--system", systemPrompt];
	}

	buildMcpArgs(mcpConfigPath: string): string[] {
		return ["--mcp-config", mcpConfigPath];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const match = OPENCODE_TOKENS_LINE.exec(output);
		if (!match) return null;
		return {
			promptTokens: Number.parseInt(match[1] ?? "0", 10),
			completionTokens: Number.parseInt(match[2] ?? "0", 10),
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
	}

	parseCostUSD(output: string): number | null {
		const match = OPENCODE_COST_LINE.exec(output);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return OPENCODE_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	detectCompletion(output: string): boolean {
		return OPENCODE_COMPLETION_PATTERNS.some((p) => p.test(output));
	}
}

export const opencodeAdapter = new OpenCodeAdapter();
