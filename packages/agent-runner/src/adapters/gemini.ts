/**
 * GeminiAdapter — wraps the Gemini CLI (`gemini` binary).
 *
 * The Gemini CLI is Google's official coding agent CLI.
 * It supports MCP via a config file and accepts tasks as positional args.
 *
 * Gemini CLI reference flags:
 *   -p / --prompt <text>      Non-interactive task input
 *   --model <id>              gemini-2.5-pro | gemini-2.5-flash
 *   --yolo                    Auto-approve all tool calls (CI mode)
 *   --sandbox                 Run tools inside a sandbox
 *   --mcp-config <path>       MCP server config file (if supported)
 *   --debug                   Debug output (verbose)
 */

import { execFileSync } from "child_process";
import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export const GEMINI_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota\s+exceeded/i,
	/resource\s+exhausted/i,
	/RESOURCE_EXHAUSTED/,
	/too\s+many\s+requests/i,
	/try\s+again\s+in\s+\d+/i,
] as const;

const GEMINI_COMPLETION_PATTERNS: readonly RegExp[] = [
	/✓\s+All\s+\d+\s+tests\s+passed/i,
	/Implementation\s+complete/i,
	/Estimated\s+cost:/i, // The cost line is always last in Gemini's output
] as const;

// Real Gemini CLI output format (see tests/fixtures/gemini-pty-output.txt):
//   Tokens used:    5,678 (input: 4,500 / output: 1,178)
//   Estimated cost: $0.0023
// eslint-disable-next-line no-control-regex
const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const GEMINI_TOKENS_RE =
	/Tokens used:\s+[\d,]+\s+\(input:\s+([\d,]+)\s*\/\s*output:\s+([\d,]+)\)/i;
const GEMINI_COST_RE = /Estimated cost:\s+\$?([\d.]+)/i;

export class GeminiAdapter implements AgentAdapter {
	readonly name = "gemini" as const;
	readonly displayName = "Gemini CLI (Google)";
	readonly supportsModels = ["gemini-2.5-pro", "gemini-2.5-flash"] as const;
	readonly defaultModel = "gemini-2.5-pro";

	async isAvailable(): Promise<boolean> {
		try {
			execFileSync("which", ["gemini"], { stdio: "pipe" });
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
			"--yolo", // Auto-approve: setra manages approvals via its own system
		];

		args.push(...this.buildMcpArgs(mcpConfigPath));

		if (run.systemPromptAppend) {
			args.push(...this.buildSystemPromptArgs(run.systemPromptAppend));
		}

		// Task as positional argument
		args.push(run.task);

		return {
			cmd: "gemini",
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
		// Gemini CLI uses --system-prompt flag
		return ["--system-prompt", systemPrompt];
	}

	buildMcpArgs(mcpConfigPath: string): string[] {
		return ["--mcp-config", mcpConfigPath];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const clean = output.replace(STRIP_ANSI_RE, "");
		const match = GEMINI_TOKENS_RE.exec(clean);
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
		const match = GEMINI_COST_RE.exec(clean);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return GEMINI_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	detectCompletion(output: string): boolean {
		return GEMINI_COMPLETION_PATTERNS.some((p) => p.test(output));
	}

	private resolveModel(modelId: string): string {
		if (!this.supportsModels.includes(modelId as never))
			return this.defaultModel;
		return modelId;
	}
}

export const geminiAdapter = new GeminiAdapter();
