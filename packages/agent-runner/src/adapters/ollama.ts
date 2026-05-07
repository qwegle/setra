/**
 * OllamaAdapter — local models via Ollama's OpenAI-compatible API.
 *
 * Ollama runs entirely on the user's machine. No API key, no cost.
 * This is setra's "zero cost" mode for experimentation and offline use.
 *
 * Architecture:
 *   - Ollama exposes an OpenAI-compatible API at http://localhost:11434/v1
 *   - We call it directly (no CLI binary needed) via the openai SDK
 *   - Available models are discovered dynamically from GET /api/tags
 *   - The runner uses the same __api__ path as AnthropicApiAdapter
 *
 * The Ollama adapter has TWO modes:
 *   1. Direct API (default) — calls http://localhost:11434/v1 directly
 *   2. CLI wrapper — wraps `ollama run <model>` for interactive use
 *
 * setra uses mode 1 (API) for agent runs so we get structured output.
 */

import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

// ─── Ollama health & discovery ────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";

export interface OllamaModel {
	name: string;
	size: number;
	modified_at: string;
	digest: string;
}

export interface OllamaTagsResponse {
	models: OllamaModel[];
}

/**
 * Check if Ollama is running and reachable.
 * Times out in 2s so it doesn't block startup.
 */
export async function checkOllamaHealth(): Promise<boolean> {
	try {
		const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
			signal: AbortSignal.timeout(2000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * List all models pulled in the local Ollama instance.
 * Returns [] if Ollama is not running.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
	try {
		const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return [];
		const data = (await res.json()) as OllamaTagsResponse;
		return data.models ?? [];
	} catch {
		return [];
	}
}

/**
 * Pull a model from the Ollama registry.
 * Streams progress. Resolves when the pull is complete.
 */
export async function pullOllamaModel(
	modelName: string,
	onProgress?: (status: string) => void,
): Promise<void> {
	const res = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: modelName, stream: true }),
	});

	if (!res.ok || !res.body) {
		throw new Error(`Failed to pull model "${modelName}": ${res.statusText}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		const lines = decoder.decode(value).split("\n").filter(Boolean);
		for (const line of lines) {
			try {
				const event = JSON.parse(line) as { status?: string };
				if (event.status) onProgress?.(event.status);
			} catch {
				// Non-JSON line, skip
			}
		}
	}
}

// ─── OllamaAdapter ────────────────────────────────────────────────────────────

export class OllamaAdapter implements AgentAdapter {
	readonly name = "ollama" as const;
	readonly displayName = "Ollama (local, free)";

	/**
	 * The static list is the setra-recommended set shown in the UI.
	 * The actual available models are discovered dynamically at runtime.
	 * The runner merges this list with the live /api/tags response.
	 */
	readonly supportsModels = [
		"llama3.2",
		"llama3.2:1b",
		"llama3.1:8b",
		"qwen2.5-coder:7b",
		"deepseek-coder-v2",
	] as const;

	readonly defaultModel = "llama3.2";

	async isAvailable(): Promise<boolean> {
		return checkOllamaHealth();
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = run.model !== "auto" ? run.model : this.defaultModel;

		return {
			cmd: "__api__",
			args: [this.name, model, run.task],
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
				// Expose Ollama base URL for any sub-processes that need it
				OLLAMA_HOST: OLLAMA_BASE_URL,
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

	parseCostUSD(_output: string): number | null {
		// Ollama is always free — cost is always zero.
		return 0;
	}

	detectRateLimit(output: string): boolean {
		// Ollama can be resource-constrained (OOM, VRAM exhausted)
		return (
			/out\s+of\s+memory/i.test(output) ||
			/CUDA\s+out\s+of\s+memory/i.test(output) ||
			/model\s+not\s+found/i.test(output) ||
			/connection\s+refused/i.test(output)
		);
	}

	detectCompletion(output: string): boolean {
		return /__done__/.test(output);
	}
}

// ─── Single-turn helper for small-model tasks ─────────────────────────────────

export interface OllamaCallResult {
	content: string;
	usage: TokenUsage;
	costUsd: 0;
}

/**
 * Call Ollama's OpenAI-compatible /v1/chat/completions for a single turn.
 * Used by small-model.ts as the free fallback when no API keys are available.
 */
export async function callOllamaOnce(
	model: string,
	systemPrompt: string,
	userMessage: string,
	maxTokens = 256,
): Promise<OllamaCallResult> {
	const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		signal: AbortSignal.timeout(30_000),
		body: JSON.stringify({
			model,
			max_tokens: maxTokens,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userMessage },
			],
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Ollama API error ${res.status}: ${body}`);
	}

	const data = (await res.json()) as {
		choices: Array<{ message: { content: string } }>;
		usage?: { prompt_tokens: number; completion_tokens: number };
	};

	const content = data.choices[0]?.message?.content ?? "";
	const usage: TokenUsage = {
		promptTokens: data.usage?.prompt_tokens ?? 0,
		completionTokens: data.usage?.completion_tokens ?? 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};

	return { content, usage, costUsd: 0 };
}

export const ollamaAdapter = new OllamaAdapter();
