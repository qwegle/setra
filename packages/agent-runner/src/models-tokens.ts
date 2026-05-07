// Last updated: 2026-05-05

export interface ModelTokenPricing {
	inputPer1M: number;
	outputPer1M: number;
}

export type ModelContextWindowRegistry = Record<string, Record<string, number>>;
export type ModelPricingRegistry = Record<
	string,
	Record<string, ModelTokenPricing>
>;
export type BudgetModelSuggestion = {
	provider: string;
	model: string;
	inputPer1M: number;
};

const INPUT_COST_BASELINE = 0.15;
const FALLBACK_MODEL_PRICING: ModelTokenPricing = {
	inputPer1M: INPUT_COST_BASELINE,
	outputPer1M: 0.6,
};
const COST_MULTIPLIERS = [1, 2, 4, 6, 8, 10, 12, 16] as const;
const LOCAL_PROVIDERS = new Set(["ollama"]);

export const MODEL_CONTEXT_WINDOWS: ModelContextWindowRegistry = {
	openai: {
		"gpt-5.5": 1_000_000,
		"gpt-5.4": 1_000_000,
		"gpt-5.4-mini": 1_000_000,
		"gpt-5.3-codex": 200_000,
		"gpt-5.2-codex": 200_000,
		"gpt-4.1": 1_000_000,
		"gpt-4.1-mini": 1_000_000,
		"gpt-4o": 128_000,
		"gpt-4o-mini": 128_000,
		o3: 200_000,
		"o4-mini": 200_000,
	},
	anthropic: {
		"claude-opus-4-7": 200_000,
		"claude-opus-4-5": 200_000,
		"claude-sonnet-4-6": 200_000,
		"claude-sonnet-4-5": 200_000,
		"claude-sonnet-4": 200_000,
		"claude-haiku-4-5": 200_000,
	},
	google: {
		"gemini-2.5-pro": 1_000_000,
		"gemini-2.5-flash": 1_000_000,
		"gemini-2.0-flash": 1_000_000,
	},
	groq: {
		"llama-3.3-70b-versatile": 128_000,
		"qwen-qwq-32b": 128_000,
		"deepseek-r1-distill-llama-70b": 128_000,
	},
	openrouter: {
		"openrouter/auto": 128_000,
		"google/gemini-2.5-flash-preview-05-20:free": 1_000_000,
		"qwen/qwen3-235b-a22b:free": 128_000,
		"meta-llama/llama-4-maverick:free": 128_000,
		"anthropic/claude-opus-4-7": 200_000,
		"openai/gpt-5.4": 1_000_000,
		"google/gemini-2.5-pro": 1_000_000,
		"deepseek/deepseek-v3.2": 128_000,
		"meta-llama/llama-4-maverick": 1_000_000,
		"x-ai/grok-4.3": 128_000,
	},
	ollama: {
		"kimi-k2.6": 128_000,
		"qwen3.5": 128_000,
		"llama3.2:latest": 128_000,
		"qwen2.5-coder:7b": 32_000,
		"deepseek-r1:7b": 64_000,
		"glm-5.1": 128_000,
		"minimax-m2.7": 128_000,
	},
};

export const MODEL_PRICING: ModelPricingRegistry = {
	openai: {
		"gpt-5.5": { inputPer1M: 10, outputPer1M: 30 },
		"gpt-5.4": { inputPer1M: 5, outputPer1M: 15 },
		"gpt-5.4-mini": { inputPer1M: 0.3, outputPer1M: 1.2 },
		"gpt-5.3-codex": { inputPer1M: 6, outputPer1M: 18 },
		"gpt-5.2-codex": { inputPer1M: 4, outputPer1M: 12 },
		"gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
		"gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
		"gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
		"gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
		o3: { inputPer1M: 10, outputPer1M: 40 },
		"o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
	},
	anthropic: {
		"claude-opus-4-7": { inputPer1M: 15, outputPer1M: 75 },
		"claude-opus-4-5": { inputPer1M: 15, outputPer1M: 75 },
		"claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
		"claude-sonnet-4-5": { inputPer1M: 3, outputPer1M: 15 },
		"claude-sonnet-4": { inputPer1M: 3, outputPer1M: 15 },
		"claude-haiku-4-5": { inputPer1M: 0.8, outputPer1M: 4 },
	},
	google: {
		"gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
		"gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
		"gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
	},
	groq: {
		"llama-3.3-70b-versatile": { inputPer1M: 0, outputPer1M: 0 },
		"qwen-qwq-32b": { inputPer1M: 0, outputPer1M: 0 },
		"deepseek-r1-distill-llama-70b": { inputPer1M: 0, outputPer1M: 0 },
	},
	openrouter: {
		"openrouter/auto": { inputPer1M: 0, outputPer1M: 0 },
		"google/gemini-2.5-flash-preview-05-20:free": {
			inputPer1M: 0,
			outputPer1M: 0,
		},
		"qwen/qwen3-235b-a22b:free": { inputPer1M: 0, outputPer1M: 0 },
		"meta-llama/llama-4-maverick:free": { inputPer1M: 0, outputPer1M: 0 },
		"anthropic/claude-opus-4-7": { inputPer1M: 15, outputPer1M: 75 },
		"openai/gpt-5.4": { inputPer1M: 5, outputPer1M: 15 },
		"google/gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
		"deepseek/deepseek-v3.2": { inputPer1M: 0.27, outputPer1M: 1.1 },
		"meta-llama/llama-4-maverick": { inputPer1M: 0.22, outputPer1M: 0.88 },
		"x-ai/grok-4.3": { inputPer1M: 3, outputPer1M: 15 },
	},
	ollama: {
		"kimi-k2.6": { inputPer1M: 0, outputPer1M: 0 },
		"qwen3.5": { inputPer1M: 0, outputPer1M: 0 },
		"llama3.2:latest": { inputPer1M: 0, outputPer1M: 0 },
		"qwen2.5-coder:7b": { inputPer1M: 0, outputPer1M: 0 },
		"deepseek-r1:7b": { inputPer1M: 0, outputPer1M: 0 },
		"glm-5.1": { inputPer1M: 0, outputPer1M: 0 },
		"minimax-m2.7": { inputPer1M: 0, outputPer1M: 0 },
	},
};

function findCaseInsensitiveMatch<T>(
	registry: Record<string, T>,
	key: string,
): T | null {
	const exactMatch = registry[key];
	if (exactMatch !== undefined) {
		return exactMatch;
	}

	const normalizedKey = key.trim().toLowerCase();
	const normalizedMatch = registry[normalizedKey];
	if (normalizedMatch !== undefined) {
		return normalizedMatch;
	}

	for (const [candidate, value] of Object.entries(registry)) {
		if (candidate.toLowerCase() === normalizedKey) {
			return value;
		}
	}

	return null;
}

function getProviderRegistry<T>(
	registry: Record<string, Record<string, T>>,
	provider: string,
): Record<string, T> | null {
	return findCaseInsensitiveMatch(registry, provider);
}

/**
 * Returns the context window size for a provider/model pair in tokens.
 */
export function getContextWindow(
	provider: string,
	model: string,
): number | null {
	const providerRegistry = getProviderRegistry(MODEL_CONTEXT_WINDOWS, provider);
	if (!providerRegistry) {
		return null;
	}

	return findCaseInsensitiveMatch(providerRegistry, model);
}

/**
 * Returns the input and output pricing for a provider/model pair.
 */
export function getModelPricing(
	provider: string,
	model: string,
): ModelTokenPricing | null {
	const providerRegistry = getProviderRegistry(MODEL_PRICING, provider);
	if (!providerRegistry) {
		return null;
	}

	return findCaseInsensitiveMatch(providerRegistry, model);
}

/**
 * Estimates the USD cost for a request using input and output token counts.
 */
export function estimateTokenCost(
	provider: string,
	model: string,
	inputTokens: number,
	outputTokens: number,
): number | null {
	if (inputTokens < 0 || outputTokens < 0) {
		return null;
	}

	const pricing = getModelPricing(provider, model) ?? FALLBACK_MODEL_PRICING;

	return (
		(inputTokens / 1_000_000) * pricing.inputPer1M +
		(outputTokens / 1_000_000) * pricing.outputPer1M
	);
}

/**
 * Returns a pricing tier label relative to the $0.15/M input baseline.
 */
export function getCostMultiplier(provider: string, model: string): string {
	const normalizedProvider = provider.trim().toLowerCase();
	if (LOCAL_PROVIDERS.has(normalizedProvider)) {
		return "Local";
	}

	const pricing = getModelPricing(provider, model);
	if (!pricing) {
		return "1x";
	}

	if (pricing.inputPer1M === 0 && pricing.outputPer1M === 0) {
		return "Free";
	}

	const ratio = pricing.inputPer1M / INPUT_COST_BASELINE;
	for (const multiplier of COST_MULTIPLIERS) {
		if (ratio <= multiplier) {
			return `${multiplier}x`;
		}
	}

	return "16x";
}

/**
 * Returns every model whose input price is at or below the supplied budget.
 */
export function suggestModelForBudget(
	maxCostPer1MInput: number,
): Array<BudgetModelSuggestion> {
	const suggestions: BudgetModelSuggestion[] = [];

	for (const [provider, models] of Object.entries(MODEL_PRICING)) {
		for (const [model, pricing] of Object.entries(models)) {
			if (pricing.inputPer1M <= maxCostPer1MInput) {
				suggestions.push({
					provider,
					model,
					inputPer1M: pricing.inputPer1M,
				});
			}
		}
	}

	return suggestions.sort((left, right) => {
		if (left.inputPer1M !== right.inputPer1M) {
			return left.inputPer1M - right.inputPer1M;
		}
		if (left.provider !== right.provider) {
			return left.provider.localeCompare(right.provider);
		}
		return left.model.localeCompare(right.model);
	});
}
