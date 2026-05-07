/**
 * AnthropicApiAdapter — calls the Anthropic API directly via SDK.
 *
 * No CLI binary required. Useful when:
 *   - Claude Code CLI is not installed
 *   - Needing fine-grained control over the conversation
 *   - Running setra-native agents (see setra-native/index.ts)
 *
 * This adapter is also the foundation for the small-model pattern
 * (see small-model.ts) which uses claude-haiku-4-5-20251001.
 *
 * NOTE: This adapter does NOT spawn a PTY process. It calls the API
 * and streams the response as simulated PTY output. The local-pty runner
 * must detect that this adapter kind === 'api' and use a different code path.
 * For Phase 1, mark this adapter as available but document the runner
 * limitation.
 */

import type { AgentAdapter } from "../adapter.js";
import { assertEgressAllowed } from "../network-gate.js";
import { isOfflineMode } from "../provider-availability.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

export const ANTHROPIC_API_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/overloaded/i,
	/quota\s+exceeded/i,
	/too\s+many\s+requests/i,
] as const;

export class AnthropicApiAdapter implements AgentAdapter {
	readonly name = "anthropic-api" as const;
	readonly displayName = "Anthropic API (direct)";
	readonly supportsModels = [
		"claude-opus-4-5",
		"claude-sonnet-4-5",
		"claude-haiku-4-5",
		"claude-haiku-4-5-20251001",
	] as const;
	readonly defaultModel = "claude-sonnet-4-5";

	async isAvailable(): Promise<boolean> {
		return !!process.env["ANTHROPIC_API_KEY"];
	}

	/**
	 * For API adapters the "command" is a sentinel that the runner intercepts.
	 * The runner checks adapter.name === 'anthropic-api' and calls the SDK
	 * instead of spawning a subprocess.
	 *
	 * We still return a SpawnOptions so the interface is consistent — the runner
	 * uses cmd === '__api__' as the signal to use the API path.
	 */
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
		// API adapters don't use CLI args — system prompt is set in the API call.
		return [];
	}

	buildMcpArgs(_mcpConfigPath: string): string[] {
		// API adapters use MCP tool definitions, not a config file path.
		return [];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		// The API runner injects a structured summary line for parsing:
		// "__usage__ prompt=1000 completion=234 cache_read=800 cache_write=0"
		const match =
			/__usage__\s+prompt=(\d+)\s+completion=(\d+)\s+cache_read=(\d+)\s+cache_write=(\d+)/.exec(
				output,
			);
		if (!match) return null;
		return {
			promptTokens: Number.parseInt(match[1] ?? "0", 10),
			completionTokens: Number.parseInt(match[2] ?? "0", 10),
			cacheReadTokens: Number.parseInt(match[3] ?? "0", 10),
			cacheWriteTokens: Number.parseInt(match[4] ?? "0", 10),
		};
	}

	parseCostUSD(output: string): number | null {
		// "__cost__ 0.01234"
		const match = /__cost__\s+([\d.]+)/.exec(output);
		if (!match) return null;
		const cost = Number.parseFloat(match[1] ?? "NaN");
		return isNaN(cost) ? null : cost;
	}

	detectRateLimit(output: string): boolean {
		return ANTHROPIC_API_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
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

// ─── Direct API call helpers (used by small-model.ts and setra-native) ────────

export interface AnthropicMessage {
	role: "user" | "assistant";
	content: string;
}

export interface AnthropicCallResult {
	content: string;
	usage: TokenUsage;
	costUsd: number;
}

/**
 * Minimal Anthropic SDK call without the full agent loop.
 * Used by small-model.ts for cheap single-turn tasks (branch naming, titles).
 * Costs are logged to the ledger by the caller.
 */
export async function callAnthropicOnce(
	model: string,
	systemPrompt: string,
	userMessage: string,
	maxTokens = 256,
): Promise<AnthropicCallResult> {
	// Dynamic import so the SDK is optional — missing SDK throws a clear error.
	const { default: Anthropic } = await import("@anthropic-ai/sdk").catch(() => {
		throw new Error(
			"ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. " +
				"Run: pnpm add @anthropic-ai/sdk",
		);
	});

	// Block cloud egress in offline mode before instantiating the SDK.
	assertEgressAllowed(
		process.env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com",
		isOfflineMode() ? "offline" : "online",
	);

	const client = new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] });

	const response = await client.messages.create({
		model,
		max_tokens: maxTokens,
		system: systemPrompt,
		messages: [{ role: "user", content: userMessage }],
	});

	const content =
		response.content[0]?.type === "text" ? response.content[0].text : "";

	const usage: TokenUsage = {
		promptTokens: response.usage.input_tokens,
		completionTokens: response.usage.output_tokens,
		// cache fields are in the usage object but not in the SDK's static types yet
		cacheReadTokens:
			(response.usage as unknown as Record<string, number>)[
				"cache_read_input_tokens"
			] ?? 0,
		cacheWriteTokens:
			(response.usage as unknown as Record<string, number>)[
				"cache_creation_input_tokens"
			] ?? 0,
	};

	// Compute cost using registry pricing (haiku prices)
	const { estimateCost } = await import("../registry.js");
	const costUsd =
		estimateCost(
			model,
			usage.promptTokens,
			usage.completionTokens,
			usage.cacheReadTokens,
			usage.cacheWriteTokens,
		) ?? 0;

	return { content, usage, costUsd };
}

export const anthropicApiAdapter = new AnthropicApiAdapter();
