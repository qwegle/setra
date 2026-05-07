/**
 * OpenAiApiAdapter — calls the OpenAI API directly via SDK.
 * Also used for any OpenAI-compatible endpoint (Together, Groq, etc.)
 * by setting OPENAI_BASE_URL.
 */

import type { AgentAdapter } from "../adapter.js";
import { assertEgressAllowed } from "../network-gate.js";
import { isOfflineMode } from "../provider-availability.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export class OpenAiApiAdapter implements AgentAdapter {
	readonly name = "openai-api" as const;
	readonly displayName = "OpenAI API (direct)";
	readonly supportsModels = ["gpt-4o", "gpt-4o-mini", "o1"] as const;
	readonly defaultModel = "gpt-4o";

	async isAvailable(): Promise<boolean> {
		return !!process.env["OPENAI_API_KEY"];
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);
		return {
			cmd: "__api__",
			args: [this.name, model, run.task],
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
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
			/quota\s+exceeded/i.test(output) ||
			/insufficient_quota/i.test(output)
		);
	}

	detectCompletion(output: string): boolean {
		return /__done__/.test(output);
	}

	private resolveModel(modelId: string): string {
		if (!this.supportsModels.includes(modelId as never))
			return this.defaultModel;
		return modelId;
	}
}

// ─── Single-turn helper (used by small-model.ts) ──────────────────────────────

export interface OpenAiCallResult {
	content: string;
	usage: TokenUsage;
	costUsd: number;
}

export interface OpenAiCallOptions {
	baseUrl?: string;
	apiKey?: string;
}

export async function callOpenAiOnce(
	model: string,
	systemPrompt: string,
	userMessage: string,
	maxTokens = 256,
	opts: OpenAiCallOptions = {},
): Promise<OpenAiCallResult> {
	const { default: OpenAI } = await import("openai").catch(() => {
		throw new Error(
			"OPENAI_API_KEY is set but the openai package is not installed. " +
				"Run: pnpm add openai",
		);
	});

	const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
	const baseURL = opts.baseUrl ?? process.env["OPENAI_BASE_URL"];

	const client = new OpenAI({
		apiKey,
		baseURL,
	});

	// Block cloud egress in offline mode before any actual HTTP call.
	assertEgressAllowed(
		baseURL ?? "https://api.openai.com",
		isOfflineMode() ? "offline" : "online",
	);

	const response = await client.chat.completions.create({
		model,
		max_tokens: maxTokens,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userMessage },
		],
	});

	const content = response.choices[0]?.message?.content ?? "";
	const u = response.usage;

	const usage: TokenUsage = {
		promptTokens: u?.prompt_tokens ?? 0,
		completionTokens: u?.completion_tokens ?? 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};

	const { estimateCost } = await import("../registry.js");
	const costUsd =
		estimateCost(model, usage.promptTokens, usage.completionTokens) ?? 0;

	return { content, usage, costUsd };
}

export const openAiApiAdapter = new OpenAiApiAdapter();
