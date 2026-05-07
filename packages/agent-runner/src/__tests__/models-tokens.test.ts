import { describe, expect, it } from "vitest";
import {
	MODEL_PRICING,
	estimateTokenCost,
	getCostMultiplier,
} from "../models-tokens.js";

describe("models-tokens", () => {
	it("estimateTokenCost returns the expected cost for known models", () => {
		expect(
			estimateTokenCost("openai", "gpt-4o-mini", 100_000, 50_000),
		).toBeCloseTo(0.045, 8);
		expect(
			estimateTokenCost("anthropic", "claude-haiku-4-5", 500_000, 250_000),
		).toBeCloseTo(1.4, 8);
	});

	it("getCostMultiplier returns the expected pricing tier", () => {
		expect(getCostMultiplier("openai", "gpt-5.4-mini")).toBe("2x");
		expect(getCostMultiplier("openrouter", "openrouter/auto")).toBe("Free");
		expect(getCostMultiplier("ollama", "qwen3.5")).toBe("Local");
	});

	it("falls back to baseline pricing for unknown models", () => {
		expect(
			estimateTokenCost("unknown", "mystery-model", 1_000_000, 500_000),
		).toBeCloseTo(0.45, 8);
		expect(getCostMultiplier("unknown", "mystery-model")).toBe("1x");
	});

	it("keeps pricing values numeric and non-negative, with positive paid tiers", () => {
		for (const models of Object.values(MODEL_PRICING)) {
			for (const pricing of Object.values(models)) {
				expect(Number.isFinite(pricing.inputPer1M)).toBe(true);
				expect(Number.isFinite(pricing.outputPer1M)).toBe(true);
				expect(pricing.inputPer1M).toBeGreaterThanOrEqual(0);
				expect(pricing.outputPer1M).toBeGreaterThanOrEqual(0);
				if (pricing.inputPer1M > 0 || pricing.outputPer1M > 0) {
					expect(pricing.inputPer1M).toBeGreaterThan(0);
					expect(pricing.outputPer1M).toBeGreaterThan(0);
				}
			}
		}
	});
});
