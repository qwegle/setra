import { MODEL_PRICING, type ModelTokenPricing } from "@setra/agent-runner";

export const DEFAULT_MODEL_PRICING: ModelTokenPricing = {
	inputPer1M: 0.15,
	outputPer1M: 0.6,
};

function normalizeModel(model: string): string {
	return model.trim().replace(/^models\//i, "");
}

function findPricingInRegistry(
	registry: Record<string, ModelTokenPricing>,
	model: string,
): ModelTokenPricing | null {
	const exact = registry[model];
	if (exact) return exact;

	const normalized = model.toLowerCase();
	const lowered = registry[normalized];
	if (lowered) return lowered;

	for (const [candidate, pricing] of Object.entries(registry)) {
		if (candidate.toLowerCase() === normalized) {
			return pricing;
		}
	}

	return null;
}

export function getCanonicalModelPricing(
	model: string,
): ModelTokenPricing | null {
	const normalized = normalizeModel(model);
	const candidates = [normalized];

	if (normalized.includes("/")) {
		candidates.push(normalized.split("/").slice(1).join("/"));
	}

	for (const registry of Object.values(MODEL_PRICING)) {
		for (const candidate of candidates) {
			const pricing = findPricingInRegistry(registry, candidate);
			if (pricing) return pricing;
		}
	}

	return null;
}

export function estimateCanonicalModelCost(
	model: string,
	promptTokens: number,
	completionTokens: number,
	fallbackPricing: ModelTokenPricing = DEFAULT_MODEL_PRICING,
): number {
	const pricing = getCanonicalModelPricing(model) ?? fallbackPricing;
	return (
		(promptTokens / 1_000_000) * pricing.inputPer1M +
		(completionTokens / 1_000_000) * pricing.outputPer1M
	);
}
