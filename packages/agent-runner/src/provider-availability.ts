/**
 * PROVIDER AVAILABILITY DETECTION
 *
 * On startup (and on-demand), setra probes which AI providers are actually
 * usable. A provider is "available" when:
 *   - CLI kind:   the binary is installed AND the API key env var is set
 *   - API kind:   the API key env var is set (no binary check needed)
 *   - Local kind: the local server (Ollama/mlx-lm/exo) responds to a health check
 *
 * This is the answer to: "User only has Claude key — why would setra try Gemini?"
 * → It won't. Smart assignment only picks from AVAILABLE providers.
 *
 * Priority order for smart auto-assignment (best quality → cheapest):
 *   claude-opus-4 → claude-sonnet-4 → gemini-2.5-pro → codex-1 → claude-haiku-4 → ollama
 *
 * The company.json "model" field behaviour:
 *   "claude-opus-4"  → use exactly this model; if unavailable, warn + fallback to best available
 *   "auto"           → pick best available (honours priority order above)
 *   "ollama:llama3"  → use Ollama with model llama3; if Ollama not running, warn + fallback
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadGovernancePolicy, validateModelChoice } from "./governance.js";
import {
	type ModelDefinition,
	PROVIDER_MAP,
	type ProviderDefinition,
} from "./registry.js";

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProviderStatus =
	| "available"
	| "no-key"
	| "no-binary"
	| "unreachable"
	| "checking";

export interface ProviderAvailability {
	providerId: string;
	displayName: string;
	status: ProviderStatus;
	/** The first model to try from this provider (derived from registry defaultModel). */
	defaultModel: string;
	/** For local providers: which models are loaded. */
	localModels?: string[];
	checkedAt: number;
}

export interface AvailabilityReport {
	providers: ProviderAvailability[];
	/** Best model to use when "auto" is requested. */
	bestAvailableModel: string;
	/** True if at least one provider is available. */
	anyAvailable: boolean;
	checkedAt: number;
}

// ─── Priority order for "auto" selection ─────────────────────────────────────

/**
 * Order of preference when user requests "auto".
 * First available provider in this list wins.
 */
const AUTO_PRIORITY: string[] = [
	"claude", // Best reasoning, caching support
	"gemini", // Strong alternative, large context
	"codex", // Good for code tasks
	"gemini-flash", // Fast + cheap
	"ollama", // Local, always free — last resort
];

const FALLBACK_MODEL = "ollama:llama3.2"; // last resort if nothing else is configured

// ─── Binary check ─────────────────────────────────────────────────────────────

async function isBinaryInstalled(name: string): Promise<boolean> {
	try {
		await execFileAsync("which", [name]);
		return true;
	} catch {
		return false;
	}
}

// ─── Local LLM health check ────────────────────────────────────────────────────

interface OllamaTagsResponse {
	models: Array<{ name: string }>;
}

async function probeLocalProvider(
	provider: ProviderDefinition,
): Promise<{ reachable: boolean; models: string[] }> {
	// Determine the base URL from the provider's env var or default
	const endpoints: Record<string, string> = {
		ollama: process.env["OLLAMA_HOST"] ?? "http://localhost:11434",
		"mlx-lm": process.env["MLX_LM_HOST"] ?? "http://127.0.0.1:8080",
		exo: process.env["EXO_HOST"] ?? "http://127.0.0.1:52415",
		lmstudio: process.env["LM_STUDIO_HOST"] ?? "http://127.0.0.1:1234",
	};

	const base = endpoints[provider.id];
	if (!base) return { reachable: false, models: [] };

	try {
		const tagsUrl =
			provider.id === "ollama" ? `${base}/api/tags` : `${base}/v1/models`;

		const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(2000) });
		if (!res.ok) return { reachable: false, models: [] };

		if (provider.id === "ollama") {
			const data = (await res.json()) as OllamaTagsResponse;
			return {
				reachable: true,
				models: data.models.map((m) => m.name),
			};
		}

		return { reachable: true, models: [] };
	} catch {
		return { reachable: false, models: [] };
	}
}

// ─── Single provider check ─────────────────────────────────────────────────────

async function checkProvider(
	provider: ProviderDefinition,
): Promise<ProviderAvailability> {
	const base: ProviderAvailability = {
		providerId: provider.id,
		displayName: provider.displayName,
		status: "no-key",
		defaultModel: provider.defaultModel,
		checkedAt: Date.now(),
	};

	if (provider.kind === "local") {
		const { reachable, models } = await probeLocalProvider(provider);
		return {
			...base,
			status: reachable ? "available" : "unreachable",
			localModels: models,
		};
	}

	// Check API key
	const apiKey = provider.apiKeyEnvVar
		? process.env[provider.apiKeyEnvVar]
		: undefined;
	if (!apiKey) {
		return { ...base, status: "no-key" };
	}

	if (provider.kind === "cli") {
		// Also need the binary
		const binaryMap: Record<string, string> = {
			claude: "claude",
			gemini: "gemini",
			codex: "codex",
		};
		const binary = binaryMap[provider.id] ?? provider.id;
		const installed = await isBinaryInstalled(binary);
		if (!installed) {
			return { ...base, status: "no-binary" };
		}
	}

	return { ...base, status: "available" };
}

// ─── Availability cache ────────────────────────────────────────────────────────

let _cache: AvailabilityReport | null = null;
const CACHE_TTL_MS = 30_000; // re-probe every 30 seconds

/**
 * Probe all providers and return the availability report.
 * Results are cached for 30 seconds to avoid hammering local endpoints.
 *
 * @param force  If true, bypass the cache and re-probe immediately.
 */
export async function getAvailability(
	force = false,
): Promise<AvailabilityReport> {
	if (!force && _cache && Date.now() - _cache.checkedAt < CACHE_TTL_MS) {
		return _cache;
	}

	const policy = loadGovernancePolicy();
	const providers = Object.values(PROVIDER_MAP);
	const results = await Promise.all(providers.map(checkProvider));

	// Filter by governance allowedProviders list
	const governed = results.map((r) => {
		if (
			policy.allowedProviders &&
			policy.allowedProviders.length > 0 &&
			!policy.allowedProviders.includes(r.providerId)
		) {
			return { ...r, status: "unreachable" as ProviderStatus };
		}
		return r;
	});

	const available = governed.filter((r) => r.status === "available");

	// Determine best model for "auto"
	let bestAvailableModel = FALLBACK_MODEL;
	for (const priorityId of AUTO_PRIORITY) {
		const found = available.find((r) => r.providerId === priorityId);
		if (found) {
			bestAvailableModel = found.defaultModel;
			break;
		}
	}

	_cache = {
		providers: governed,
		bestAvailableModel,
		anyAvailable: available.length > 0,
		checkedAt: Date.now(),
	};

	return _cache;
}

/**
 * Resolve a requested model string to one that is actually available.
 *
 * Rules:
 *   "auto"              → bestAvailableModel from the report
 *   "claude-opus-4"     → if claude is available, use it; else pick best available + emit warning
 *   "ollama:llama3"     → if Ollama is available, use it; else pick best available + emit warning
 *   anything else       → return as-is (user's responsibility)
 *
 * @param requested  The model string from company.json / CLI flag / settings
 * @param report     Result of getAvailability()
 * @returns          { model: string, wasDowngraded: boolean, reason?: string }
 */
export function resolveModel(
	requested: string,
	report: AvailabilityReport,
): { model: string; wasDowngraded: boolean; reason?: string } {
	// Governance policy check — runs before any availability logic
	const policy = loadGovernancePolicy();
	if (requested !== "auto") {
		const policyError = validateModelChoice(requested, policy);
		if (policyError) {
			return {
				model: report.bestAvailableModel,
				wasDowngraded: true,
				reason: policyError,
			};
		}
	}

	if (requested === "auto") {
		return { model: report.bestAvailableModel, wasDowngraded: false };
	}

	// Extract provider from model string
	const providerId = modelToProviderId(requested);
	if (!providerId) {
		return { model: requested, wasDowngraded: false };
	}

	const providerState = report.providers.find(
		(p) => p.providerId === providerId,
	);

	if (providerState?.status === "available") {
		return { model: requested, wasDowngraded: false };
	}

	// Provider not available — explain why and fall back
	const reason = providerState
		? statusToReason(providerState.status, providerId)
		: `Provider "${providerId}" is not registered`;

	return {
		model: report.bestAvailableModel,
		wasDowngraded: true,
		reason,
	};
}

function modelToProviderId(model: string): string | null {
	// "ollama:llama3" → "ollama"
	if (model.startsWith("ollama:")) return "ollama";
	if (model.startsWith("mlx-lm:")) return "mlx-lm";
	if (model.startsWith("exo:")) return "exo";

	// Match by prefix from registry
	for (const [providerId, provider] of PROVIDER_MAP.entries()) {
		if (provider.models.some((m: ModelDefinition) => m.id === model))
			return providerId;
	}
	return null;
}

function statusToReason(status: ProviderStatus, providerId: string): string {
	switch (status) {
		case "no-key":
			return `No API key found for "${providerId}" (set ${PROVIDER_MAP.get(providerId)?.apiKeyEnvVar ?? "the API key env var"})`;
		case "no-binary":
			return `"${providerId}" CLI binary not installed — run: npm install -g @${providerId}/cli`;
		case "unreachable":
			return `"${providerId}" local server is not running`;
		default:
			return `"${providerId}" is not available`;
	}
}

// ─── Re-export for convenience ────────────────────────────────────────────────

export { FALLBACK_MODEL, AUTO_PRIORITY };

// ─── Deployment mode ──────────────────────────────────────────────────────────

/**
 * DEPLOYMENT MODES
 *
 * cloud   — default; uses any configured provider (cloud + local)
 * hybrid  — prefers local; falls back to cloud only when no local model handles the task
 * offline — STRICT: no cloud API calls; only local providers (ollama/mlx-lm/exo/custom)
 *           Use for: government/governance, air-gap, data-sovereign, no-internet deployments
 *
 * Set via:
 *   ~/.setra/config.json → { "deploymentMode": "offline" }
 *   env var → SETRA_DEPLOYMENT_MODE=offline
 *   CLI flag → setra run --mode offline
 *   company.json → { "deploymentMode": "offline", ... }
 *
 * When offline=true:
 *   - getAvailability() only returns local providers
 *   - resolveModel() rejects any cloud model with a clear error
 *   - NO network calls are made by agent adapters
 *   - The Ollama/mlx-lm/exo/lmstudio base URLs are configurable for on-prem servers
 */
export type DeploymentMode = "cloud" | "hybrid" | "offline";

export function getDeploymentMode(): DeploymentMode {
	const env = process.env["SETRA_DEPLOYMENT_MODE"];
	if (env === "offline" || env === "hybrid") return env;
	return "cloud";
}

export function isOfflineMode(): boolean {
	return getDeploymentMode() === "offline";
}

/** Cloud provider IDs — blocked in offline mode. */
const CLOUD_PROVIDER_IDS = new Set([
	"claude",
	"gemini",
	"codex",
	"opencode",
	"amp",
	"anthropic-api",
	"openai-api",
	"gemini-api",
]);

/**
 * Filter availability report for the current deployment mode.
 * In offline mode: removes all cloud providers from the available set.
 */
export function applyDeploymentMode(
	report: AvailabilityReport,
	mode: DeploymentMode = getDeploymentMode(),
): AvailabilityReport {
	if (mode === "cloud") return report;

	const filtered = report.providers.map((p) => {
		if (mode === "offline" && CLOUD_PROVIDER_IDS.has(p.providerId)) {
			return { ...p, status: "unreachable" as ProviderStatus };
		}
		return p;
	});

	const available = filtered.filter((p) => p.status === "available");
	let bestAvailableModel = FALLBACK_MODEL;
	for (const priorityId of [
		"ollama",
		"mlx-lm",
		"exo",
		"lmstudio",
		"custom-openai",
	]) {
		const found = available.find((r) => r.providerId === priorityId);
		if (found) {
			bestAvailableModel = found.defaultModel;
			break;
		}
	}

	return {
		providers: filtered,
		bestAvailableModel,
		anyAvailable: available.length > 0,
		checkedAt: report.checkedAt,
	};
}

// ─── Role-based smart model assignment ───────────────────────────────────────

/**
 * ROLE-BASED MODEL ASSIGNMENT
 *
 * setra assigns models based on the agent's role and the user's budget preference.
 * Three budget modes:
 *   best       — best quality regardless of price (architect uses opus, etc.)
 *   balanced   — quality/cost balance (default)
 *   economy    — cheapest available; local SLMs preferred
 *
 * Role → tier mapping (balanced mode):
 *   coordinator / architect / lead  → large  (needs full reasoning)
 *   backend / frontend / fullstack  → medium (daily coding tasks)
 *   qa / docs / reviewer            → small  (can use cheaper models)
 *   devops / security               → medium (important but not creative)
 *   local / offline                 → ollama:qwen2.5-coder:7b (free, good at code)
 */
export type BudgetMode = "best" | "balanced" | "economy";

/** Canonical role → tier mapping. Add more roles as needed. */
const ROLE_TIER_MAP: Record<string, ModelTierHint> = {
	// Leadership / strategic
	coordinator: { best: "large", balanced: "large", economy: "medium" },
	architect: { best: "large", balanced: "large", economy: "medium" },
	lead: { best: "large", balanced: "large", economy: "medium" },
	pm: { best: "large", balanced: "medium", economy: "small" },
	// Engineering
	backend: { best: "large", balanced: "medium", economy: "small" },
	frontend: { best: "large", balanced: "medium", economy: "small" },
	fullstack: { best: "large", balanced: "medium", economy: "small" },
	devops: { best: "large", balanced: "medium", economy: "small" },
	security: { best: "large", balanced: "medium", economy: "medium" },
	// Quality / support
	qa: { best: "medium", balanced: "small", economy: "small" },
	tester: { best: "medium", balanced: "small", economy: "small" },
	docs: { best: "medium", balanced: "small", economy: "small" },
	reviewer: { best: "medium", balanced: "small", economy: "small" },
	// Research
	researcher: { best: "large", balanced: "large", economy: "medium" },
	analyst: { best: "large", balanced: "medium", economy: "small" },
};

interface ModelTierHint {
	best: "large" | "medium" | "small";
	balanced: "large" | "medium" | "small";
	economy: "large" | "medium" | "small";
}

const DEFAULT_TIER_HINT: ModelTierHint = {
	best: "large",
	balanced: "medium",
	economy: "small",
};

/**
 * Given an agent role and budget mode, return the recommended model
 * from the available providers.
 *
 * This is called when company.json uses "model": "auto" (or omits "model").
 */
export function assignModelForRole(
	role: string,
	budgetMode: BudgetMode,
	report: AvailabilityReport,
): string {
	const tierHint = ROLE_TIER_MAP[role.toLowerCase()] ?? DEFAULT_TIER_HINT;
	const targetTier = tierHint[budgetMode];

	// Cloud tier → model priority map
	const tierModels: Record<string, string[]> = {
		large: [
			"claude-opus-4",
			"claude-sonnet-4-5",
			"gemini-2.5-pro",
			"gpt-4o",
			"codex-1",
			"qwen2.5-coder:32b",
			"llama3.3:70b",
		],
		medium: [
			"claude-sonnet-4",
			"gemini-2.0-flash",
			"gpt-4o-mini",
			"qwen2.5-coder:14b",
			"llama3.1:8b",
		],
		small: [
			"claude-haiku-4",
			"gemini-flash-2.0",
			"phi4",
			"qwen2.5-coder:7b",
			"mistral:7b",
			"llama3.2",
		],
	};

	const candidates = tierModels[targetTier] ?? tierModels["medium"]!;

	for (const candidate of candidates) {
		const resolved = resolveModel(candidate, report);
		if (!resolved.wasDowngraded) return candidate;
	}

	// Nothing matched — return best available
	return report.bestAvailableModel;
}

/**
 * Returns a user-friendly message shown when no cloud API keys are configured.
 */
export function getNoKeyMessage(): string {
	return (
		"No cloud API keys found. setra will use local models (Ollama).\n" +
		"To use cloud models: setra init --provider anthropic\n" +
		"Or install local models: setra models install ollama && setra models pull qwen2.5-coder:7b"
	);
}

/**
 * Smart model resolution with automatic local fallback.
 *
 * If the requested model's provider has no API key configured AND
 * Ollama is running locally with at least one model pulled,
 * automatically fall back to the best available local model.
 *
 * Priority: requested → available cloud → local Ollama → error
 */
export async function resolveModelWithFallback(
	requested: string | null | undefined,
	options?: {
		preferLocal?: boolean;
		taskComplexity?: "low" | "medium" | "high";
		notifyFallback?: (from: string, to: string, reason: string) => void;
	},
): Promise<{
	model: string;
	provider: string;
	isFallback: boolean;
	fallbackReason?: string;
}> {
	const report = await getAvailability();

	// Normalise requested
	const req = !requested || requested === "auto" ? "auto" : requested;

	// If preferLocal: force Ollama
	if (options?.preferLocal) {
		const ollamaProvider = report.providers.find(
			(p) => p.providerId === "ollama",
		);
		if (ollamaProvider?.status === "available") {
			const complexity = options.taskComplexity ?? "medium";
			const localModel = pickLocalModel(
				ollamaProvider.localModels ?? [],
				complexity,
			);
			if (localModel) {
				return { model: localModel, provider: "ollama", isFallback: false };
			}
		}
	}

	// Try requested model first
	if (req !== "auto") {
		const resolved = resolveModel(req, report);
		if (!resolved.wasDowngraded) {
			const provider = modelToProvider(req);
			return { model: resolved.model, provider, isFallback: false };
		}
	}

	// Check if any cloud provider is available
	if (report.anyAvailable) {
		const model =
			req === "auto"
				? report.bestAvailableModel
				: resolveModel(req, report).model;
		const provider = modelToProvider(model);
		const isFallback = req !== "auto";
		if (isFallback && options?.notifyFallback) {
			options.notifyFallback(
				req,
				model,
				`Provider not available; using ${provider}`,
			);
		}
		return {
			model,
			provider,
			isFallback,
			...(isFallback ? { fallbackReason: `Fell back from ${req}` } : {}),
		};
	}

	// No cloud provider available — try Ollama
	const ollamaBase = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
	try {
		const res = await fetch(`${ollamaBase}/api/tags`, {
			signal: AbortSignal.timeout(2000),
		});
		if (res.ok) {
			const data = (await res.json()) as { models: Array<{ name: string }> };
			const models = data.models.map((m) => m.name);
			if (models.length > 0) {
				const complexity = options?.taskComplexity ?? "medium";
				const localModel = pickLocalModel(models, complexity);
				const chosen = localModel ?? models[0]!;
				const fallbackReason =
					"No cloud API keys configured; using local Ollama";
				options?.notifyFallback?.(req, chosen, fallbackReason);
				return {
					model: chosen,
					provider: "ollama",
					isFallback: true,
					fallbackReason,
				};
			}
		}
	} catch {
		// Ollama not running
	}

	// Nothing available
	throw new Error(
		"No models available. Run `setra models install ollama` or set an API key.\n" +
			getNoKeyMessage(),
	);
}

function pickLocalModel(
	available: string[],
	complexity: "low" | "medium" | "high",
): string | undefined {
	const preferences: Record<"low" | "medium" | "high", string[]> = {
		high: ["qwen2.5-coder:14b", "deepseek-r1:14b", "qwen2.5-coder:7b", "phi4"],
		medium: ["qwen2.5-coder:7b", "phi4", "qwen2.5-coder:14b", "llama3.1"],
		low: ["qwen2.5-coder:1.5b", "phi4-mini", "qwen2.5-coder:7b", "llama3.2"],
	};
	for (const pref of preferences[complexity]) {
		const found = available.find((m) => m.startsWith(pref) || m === pref);
		if (found) return found;
	}
	return available[0];
}

function modelToProvider(model: string): string {
	if (model.startsWith("ollama")) return "ollama";
	if (model.startsWith("claude")) return "anthropic";
	if (
		model.startsWith("gpt") ||
		model.startsWith("o1") ||
		model.startsWith("o3") ||
		model.startsWith("o4")
	)
		return "openai";
	if (model.startsWith("gemini")) return "google";
	if (model.startsWith("grok")) return "xai";
	return "unknown";
}
