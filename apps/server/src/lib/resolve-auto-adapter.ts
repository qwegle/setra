/**
 * Server-side "auto" adapter+model resolver.
 *
 * STRATEGY: cost-first selection from CONNECTED providers only.
 *
 * "Connected" = the user has either saved an API key in
 * ~/.setra/settings.json OR exported the corresponding env var. We don't
 * probe the network here (that's done lazily by the runtime when a run
 * actually starts). If a key is set but the provider is unreachable, the
 * runtime fallback chain (packages/agent-runner/fallback-chain.ts) re-routes
 * to the next connected provider, so this resolver only has to answer
 * "which provider should we *try* first?"
 *
 * Within that connected set we pick the CHEAPEST viable model so token
 * burn stays low for the default 'auto' path. Users who want the best
 * quality model can still set adapter/model explicitly per-agent.
 *
 * Priority (cheapest → most expensive, free tiers first):
 *   1. OpenRouter (free model: deepseek-r1)            ≈ $0
 *   2. Groq      (llama-3.3-70b, fastest paid)         ≈ $0.05/M tok
 *   3. Gemini    (gemini-2.5-flash, NOT pro)           ≈ $0.075/M tok
 *   4. OpenAI    (gpt-4o-mini, NOT gpt-4.1)            ≈ $0.15/M tok
 *   5. Anthropic (claude-haiku-4-5, NOT sonnet/opus)   ≈ $0.80/M tok
 *
 * Returns null adapter when nothing is configured — callers should set the
 * agent into 'awaiting_key' status until a key is saved.
 */

import { isOfflineForCompany } from "../repositories/runtime.repo.js";
import { isCloudAdapter, normalizeAdapterId } from "./adapter-policy.js";
import { getCompanySettings } from "./company-settings.js";

export type AdapterId =
	| "anthropic-api"
	| "openai-api"
	| "gemini-api"
	| "claude_local"
	| "codex_local"
	| "gemini_local"
	| "openrouter"
	| "groq"
	| "ollama";

export interface ResolvedAdapter {
	adapter: AdapterId | null;
	model: string | null;
	reason: string;
}

interface SettingsLike {
	anthropic_api_key?: unknown;
	openai_api_key?: unknown;
	gemini_api_key?: unknown;
	openrouter_api_key?: unknown;
	groq_api_key?: unknown;
	preferred_adapter?: unknown;
	preferred_model?: unknown;
}

function readSettings(companyId: string | null | undefined): SettingsLike {
	return getCompanySettings(companyId) as SettingsLike;
}

/**
 * Smart tier picker.
 *
 * Strategy: cheap when fine, expensive when needed. The CHEAPEST connected
 * model is the *router* — given a task description it returns one of:
 *   - "trivial"  → use the cheapest tier
 *   - "standard" → use a mid-tier model (gemini-pro, sonnet, gpt-4.1)
 *   - "complex"  → use a top-tier model (claude-opus, gpt-4-turbo)
 *
 * Per-provider tier ladder (cheapest → most expensive):
 */
export interface TieredModels {
	trivial: string;
	standard: string;
	complex: string;
}

function canonicalAdapter(adapter: string): AdapterId {
	const normalized = normalizeAdapterId(adapter);
	if (
		normalized === "anthropic-api" ||
		normalized === "openai-api" ||
		normalized === "gemini-api"
	)
		return normalized;
	if (
		normalized === "openrouter" ||
		normalized === "groq" ||
		normalized === "ollama"
	)
		return normalized;
	return adapter as AdapterId;
}

export const TIER_LADDER: Record<AdapterId, TieredModels> = {
	openrouter: {
		trivial: "openrouter/auto",
		standard: "meta-llama/llama-4-maverick",
		complex: "anthropic/claude-opus-4",
	},
	groq: {
		trivial: "llama-3.1-8b-instant",
		standard: "llama-3.3-70b-versatile",
		complex: "llama-3.3-70b-versatile",
	},
	"gemini-api": {
		trivial: "gemini-2.5-flash-lite",
		standard: "gemini-2.5-flash",
		complex: "gemini-2.5-pro",
	},
	"openai-api": {
		trivial: "gpt-4o-mini",
		standard: "gpt-4.1-mini",
		complex: "gpt-5.4",
	},
	"anthropic-api": {
		trivial: "claude-haiku-4-5",
		standard: "claude-sonnet-4-5",
		complex: "claude-opus-4-5",
	},
	gemini_local: {
		trivial: "gemini-2.5-flash-lite",
		standard: "gemini-2.5-flash",
		complex: "gemini-2.5-pro",
	},
	codex_local: {
		trivial: "gpt-4o-mini",
		standard: "gpt-4.1-mini",
		complex: "gpt-5.4",
	},
	claude_local: {
		trivial: "claude-haiku-4-5",
		standard: "claude-sonnet-4-5",
		complex: "claude-opus-4-5",
	},
	ollama: {
		trivial: "llama3.2:3b",
		standard: "llama3.1:8b",
		complex: "llama3.1:70b",
	},
};

export type Complexity = "trivial" | "standard" | "complex";

/**
 * Pick a model tier on the resolved adapter. Callers either pass a
 * pre-classified complexity (e.g. router output) or "auto" which means
 * "let the runtime classify with the cheapest model first".
 */
export function pickTierModel(
	adapter: AdapterId,
	complexity: Complexity,
): string {
	return TIER_LADDER[canonicalAdapter(adapter)][complexity];
}

function hasKey(envName: string, settingsValue: unknown): boolean {
	if (typeof settingsValue === "string" && settingsValue.length > 0)
		return true;
	const env = process.env[envName];
	return typeof env === "string" && env.length > 0;
}

/**
 * Cost-ordered list of (provider check, adapter id, cheapest-model). The
 * first one whose key is configured wins.
 *
 * The model column is intentionally the CHEAPEST viable model for each
 * provider — auto means "be frugal". Users picking a specific provider
 * keep full control of the model.
 */
const COST_PRIORITY: Array<{
	envVar: string;
	settingsKey: keyof SettingsLike;
	adapter: AdapterId;
	cheapestModel: string;
	reason: string;
}> = [
	{
		envVar: "OPENROUTER_API_KEY",
		settingsKey: "openrouter_api_key",
		adapter: "openrouter",
		cheapestModel: "openrouter/auto",
		reason: "auto:cheapest-connected:openrouter-auto",
	},
	{
		envVar: "GROQ_API_KEY",
		settingsKey: "groq_api_key",
		adapter: "groq",
		cheapestModel: "llama-3.3-70b-versatile",
		reason: "auto:cheapest-connected:groq",
	},
	{
		envVar: "GEMINI_API_KEY",
		settingsKey: "gemini_api_key",
		adapter: "gemini-api",
		cheapestModel: "gemini-2.5-flash",
		reason: "auto:cheapest-connected:gemini-flash",
	},
	{
		envVar: "OPENAI_API_KEY",
		settingsKey: "openai_api_key",
		adapter: "openai-api",
		cheapestModel: "gpt-4o-mini",
		reason: "auto:cheapest-connected:openai-mini",
	},
	{
		envVar: "ANTHROPIC_API_KEY",
		settingsKey: "anthropic_api_key",
		adapter: "anthropic-api",
		cheapestModel: "claude-haiku-4-5",
		reason: "auto:cheapest-connected:claude-haiku",
	},
];

/**
 * Resolve adapter='auto' (or null/undefined) into a concrete adapter+model
 * pair drawn from currently-CONNECTED providers, picking the cheapest
 * configured option.
 *
 * If adapter is already a concrete id, returns it (with the requested model
 * unchanged or null if none requested).
 */
export function resolveAutoAdapter(
	requestedAdapter?: string | null,
	requestedModel?: string | null,
	companyId?: string | null,
): ResolvedAdapter {
	const a = (requestedAdapter ?? "auto").toLowerCase();

	if (a !== "auto" && a !== "") {
		const offline = isOfflineForCompany(companyId ?? null);
		if (offline && isCloudAdapter(a)) {
			return {
				adapter: null,
				model: requestedModel ?? null,
				reason: "offline:cloud-adapter-blocked",
			};
		}
		// Treat "auto" model string as unset — caller should use adapter default
		const resolvedModel =
			requestedModel && requestedModel !== "auto" ? requestedModel : null;
		return {
			adapter: canonicalAdapter(a),
			model: resolvedModel,
			reason: "explicit-adapter",
		};
	}

	const s = readSettings(companyId);
	const offline = isOfflineForCompany(companyId ?? null);
	if (offline) {
		return {
			adapter: "ollama",
			model: requestedModel || "qwen2.5-coder:7b",
			reason: "auto:offline-local-only",
		};
	}

	// Global preferred adapter — set by the user in Settings → "Default Agent Adapter".
	// Overrides the cost-priority auto-selection so every hired agent uses this adapter.
	const preferredAdapter =
		typeof s.preferred_adapter === "string" && s.preferred_adapter.trim()
			? s.preferred_adapter.trim()
			: null;
	if (preferredAdapter) {
		const preferredModel =
			(requestedModel && requestedModel !== "auto" ? requestedModel : null) ||
			(typeof s.preferred_model === "string" && s.preferred_model.trim()
				? s.preferred_model.trim()
				: null);
		return {
			adapter: canonicalAdapter(preferredAdapter),
			model: preferredModel,
			reason: "auto:global-preferred-adapter",
		};
	}

	for (const entry of COST_PRIORITY) {
		if (hasKey(entry.envVar, s[entry.settingsKey])) {
			return {
				adapter: entry.adapter,
				// Honour an explicit per-agent model override; otherwise pick the
				// cheapest viable model on this provider.
				model: requestedModel || entry.cheapestModel,
				reason: entry.reason,
			};
		}
	}

	return {
		adapter: null,
		model: requestedModel ?? null,
		reason: "auto:no-keys-configured",
	};
}
