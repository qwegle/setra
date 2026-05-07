/**
 * CustomOpenAiAdapter — any OpenAI-compatible endpoint.
 *
 * Configured in Settings → Agents → Custom:
 *   - Base URL (e.g. https://api.together.xyz/v1)
 *   - API Key (stored in OS keychain, not DB)
 *   - Model ID (user-provided string)
 *
 * This covers: Together AI, Groq, Fireworks, Mistral, LM Studio,
 * and any local server that speaks the OpenAI API.
 */

import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export interface CustomOpenAiConfig {
	baseUrl: string;
	modelId: string;
	/** Display name shown in the model selector. */
	label: string;
}

export class CustomOpenAiAdapter implements AgentAdapter {
	readonly name = "custom-openai" as const;
	readonly displayName: string;
	readonly supportsModels: readonly string[];
	readonly defaultModel: string;

	private readonly config: CustomOpenAiConfig;

	constructor(config: CustomOpenAiConfig) {
		this.config = config;
		this.displayName = config.label;
		this.supportsModels = [config.modelId];
		this.defaultModel = config.modelId;
	}

	async isAvailable(): Promise<boolean> {
		// Check that the configured base URL is reachable and an API key is set.
		const hasKey =
			!!process.env["OPENAI_API_KEY"] || !!process.env["CUSTOM_OPENAI_API_KEY"];
		if (!hasKey) return false;

		try {
			const res = await fetch(`${this.config.baseUrl}/models`, {
				signal: AbortSignal.timeout(3000),
				headers: {
					Authorization: `Bearer ${process.env["CUSTOM_OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? ""}`,
				},
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = run.model !== "auto" ? run.model : this.config.modelId;

		return {
			cmd: "__api__",
			args: [this.name, model, run.task],
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
				OPENAI_BASE_URL: this.config.baseUrl,
			},
			cwd: plot.worktreePath,
		};
	}

	buildSystemPromptArgs(_systemPrompt: string): string[] {
		return [];
	}

	buildMcpArgs(_mcpConfigPath: string): string[] {
		return [];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const match =
			/__usage__\s+prompt=(\d+)\s+completion=(\d+)\s+cache_read=(\d+)\s+cache_write=(\d+)/.exec(
				output,
			);
		if (!match) return null;
		return {
			promptTokens: Number.parseInt(match[1] ?? "0", 10),
			completionTokens: Number.parseInt(match[2] ?? "0", 10),
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
	}

	parseCostUSD(output: string): number | null {
		const match = /__cost__\s+([\d.]+)/.exec(output);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return (
			/rate[\s_-]?limit/i.test(output) ||
			/\b429\b/.test(output) ||
			/quota\s+exceeded/i.test(output)
		);
	}

	detectCompletion(output: string): boolean {
		return /__done__/.test(output);
	}
}

export const customOpenAiAdapter = new CustomOpenAiAdapter({
	baseUrl: process.env["OPENAI_BASE_URL"] ?? "http://localhost:8080/v1",
	modelId: process.env["CUSTOM_MODEL_ID"] ?? "custom",
	label: "Custom OpenAI-compatible",
});
