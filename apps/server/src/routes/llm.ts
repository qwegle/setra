import { zValidator } from "@hono/zod-validator";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { tryGetCompanyId } from "../lib/company-scope.js";
import { applyKeysToEnv, getCompanySettings } from "../lib/company-settings.js";
import * as llmRepo from "../repositories/llm.repo.js";
import {
	PullModelSchema,
	TestProviderSchema,
	UpdateLlmSettingsSchema,
} from "../validators/llm.validators.js";

export const llmRoute = new Hono();

// ─── Model catalog (static) ───────────────────────────────────────────────────
export const MODEL_CATALOG = [
	// Anthropic
	{
		id: "claude-opus-4-5",
		displayName: "Claude Opus 4.5",
		provider: "anthropic",
		requiresKey: "anthropicApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 200_000,
		description: "Most capable Claude model, best for complex reasoning",
	},
	{
		id: "claude-opus-4-5:thinking:high",
		displayName: "Claude Opus 4.5 Extended Thinking",
		provider: "anthropic",
		requiresKey: "anthropicApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 200_000,
		description: "Opus 4.5 with extended thinking (16k budget)",
	},
	{
		id: "claude-sonnet-4-5",
		displayName: "Claude Sonnet 4.5",
		provider: "anthropic",
		requiresKey: "anthropicApiKey",
		reasoningTier: "medium",
		costTier: "$$",
		contextWindow: 200_000,
		description: "Balanced Claude model for daily coding tasks",
	},
	{
		id: "claude-sonnet-4-5:thinking:medium",
		displayName: "Claude Sonnet 4.5 Thinking (Medium)",
		provider: "anthropic",
		requiresKey: "anthropicApiKey",
		reasoningTier: "medium",
		costTier: "$$",
		contextWindow: 200_000,
		description: "Sonnet with extended thinking (8k budget)",
	},
	{
		id: "claude-sonnet-4-5:thinking:low",
		displayName: "Claude Sonnet 4.5 Thinking (Low)",
		provider: "anthropic",
		requiresKey: "anthropicApiKey",
		reasoningTier: "low",
		costTier: "$",
		contextWindow: 200_000,
		description: "Sonnet with extended thinking (4k budget)",
	},
	{
		id: "claude-haiku-4-5",
		displayName: "Claude Haiku 4.5",
		provider: "anthropic",
		requiresKey: "anthropicApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 200_000,
		description: "Fastest and cheapest Claude model",
	},
	// OpenAI
	{
		id: "gpt-5.4",
		displayName: "GPT-5.4 (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 200_000,
		description: "Latest OpenAI GPT-5.4 model",
	},
	{
		id: "gpt-5.3-codex",
		displayName: "GPT-5.3 Codex (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 200_000,
		description: "OpenAI Codex-optimized GPT-5.3 model",
	},
	{
		id: "gpt-5.2-codex",
		displayName: "GPT-5.2 Codex (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 200_000,
		description: "OpenAI Codex-optimized GPT-5.2 model",
	},
	{
		id: "gpt-4.1",
		displayName: "GPT-4.1 (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 128_000,
		description: "Stable GPT-4.1 model",
	},
	{
		id: "gpt-4.1-mini",
		displayName: "GPT-4.1 Mini (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "medium",
		costTier: "$$",
		contextWindow: 128_000,
		description: "Faster and cheaper GPT-4.1",
	},
	{
		id: "gpt-4o",
		displayName: "GPT-4o (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "medium",
		costTier: "$$",
		contextWindow: 128_000,
		description: "Multimodal GPT-4o",
	},
	{
		id: "o3",
		displayName: "o3 (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 200_000,
		description: "OpenAI o3 reasoning model",
	},
	{
		id: "o4-mini",
		displayName: "o4-mini (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "medium",
		costTier: "$$",
		contextWindow: 128_000,
		description: "Fast and affordable reasoning model",
	},
	{
		id: "gpt-4o-mini",
		displayName: "GPT-4o Mini (OpenAI)",
		provider: "openai",
		requiresKey: "openaiApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 128_000,
		description: "Fast and affordable GPT model",
	},
	// OpenRouter
	{
		id: "openrouter:openrouter/auto",
		displayName: "OpenRouter Auto",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "auto",
		costTier: "$$",
		contextWindow: 200_000,
		description: "Auto-route to the best available OpenRouter endpoint",
	},
	{
		id: "openrouter:deepseek/deepseek-r1-distill-qwen-32b:free",
		displayName: "DeepSeek R1 Distill Qwen 32B (Free)",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "free",
		costTier: "$",
		contextWindow: 32_000,
		description: "Free distilled R1 model",
	},
	{
		id: "openrouter:google/gemini-2.5-flash-preview-05-20:free",
		displayName: "Gemini 2.5 Flash (Free)",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "free",
		costTier: "$",
		contextWindow: 1_000_000,
		description: "Google Gemini 2.5 Flash free tier",
	},
	{
		id: "openrouter:meta-llama/llama-4-maverick:free",
		displayName: "Llama 4 Maverick (Free)",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "free",
		costTier: "$",
		contextWindow: 128_000,
		description: "Meta Llama 4 Maverick free tier",
	},
	{
		id: "openrouter:qwen/qwen3-235b-a22b:free",
		displayName: "Qwen3 235B (Free)",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "free",
		costTier: "$",
		contextWindow: 32_000,
		description: "Qwen3 235B MoE free tier",
	},
	{
		id: "openrouter:microsoft/mai-ds-r1:free",
		displayName: "Microsoft MAI DS R1 (Free)",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "free",
		costTier: "$",
		contextWindow: 64_000,
		description: "Microsoft MAI DS R1 free tier",
	},
	{
		id: "openrouter:anthropic/claude-sonnet-4-5",
		displayName: "Claude Sonnet 4.5 via OpenRouter",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "medium",
		costTier: "$$",
		contextWindow: 200_000,
		description: "Claude Sonnet 4.5 routed via OpenRouter",
	},
	{
		id: "openrouter:openai/gpt-4.1",
		displayName: "GPT-4.1 via OpenRouter",
		provider: "openrouter",
		requiresKey: "openrouterApiKey",
		reasoningTier: "high",
		costTier: "$$$",
		contextWindow: 128_000,
		description: "GPT-4.1 routed via OpenRouter",
	},
	// Groq
	{
		id: "groq:llama-3.3-70b-versatile",
		displayName: "Llama 3.3 70B (Fast)",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 131_072,
		description: "Llama 3.3 70B with ultra-fast Groq inference",
	},
	{
		id: "groq:meta-llama/llama-4-scout-17b-16e-instruct",
		displayName: "Llama 4 Scout 17B",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 131_072,
		description: "Meta Llama 4 Scout on Groq",
	},
	{
		id: "groq:groq/compound-mini",
		displayName: "Compound Mini (Agentic)",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 131_072,
		description: "Groq Compound Mini — agentic model with tool use",
	},
	{
		id: "groq:groq/compound",
		displayName: "Compound (Agentic)",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "medium",
		costTier: "$",
		contextWindow: 131_072,
		description: "Groq Compound — full agentic model",
	},
	{
		id: "groq:qwen/qwen3-32b",
		displayName: "Qwen3 32B",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "medium",
		costTier: "$",
		contextWindow: 131_072,
		description: "Qwen3 32B on Groq",
	},
	{
		id: "groq:llama-3.1-8b-instant",
		displayName: "Llama 3.1 8B (Instant)",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 131_072,
		description: "Llama 3.1 8B instant inference",
	},
	{
		id: "groq:openai/gpt-oss-120b",
		displayName: "GPT-OSS 120B",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "high",
		costTier: "$",
		contextWindow: 131_072,
		description: "OpenAI GPT-OSS 120B on Groq",
	},
	{
		id: "groq:allam-2-7b",
		displayName: "ALLaM 2 7B",
		provider: "groq",
		requiresKey: "groqApiKey",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 4_096,
		description: "ALLaM 2 7B on Groq",
	},
	// Ollama
	{
		id: "ollama:qwen2.5-coder:7b",
		displayName: "Qwen2.5 Coder 7B (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 32_000,
		description: "Local code-focused model",
	},
	{
		id: "ollama:qwen2.5:7b",
		displayName: "Qwen2.5 7B (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 32_000,
		description: "Local general-purpose Qwen model",
	},
	{
		id: "ollama:llama3.2:3b",
		displayName: "Llama 3.2 3B (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 128_000,
		description: "Tiny local Llama model",
	},
	{
		id: "ollama:llama3.2:latest",
		displayName: "Llama 3.2 (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 128_000,
		description: "Local Llama 3.2 model",
	},
	{
		id: "ollama:deepseek-r1:7b",
		displayName: "DeepSeek R1 7B (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "medium",
		costTier: "$",
		contextWindow: 32_000,
		description: "Local reasoning model",
	},
	{
		id: "ollama:mistral:latest",
		displayName: "Mistral (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 32_000,
		description: "Local Mistral model",
	},
	{
		id: "ollama:codellama:7b",
		displayName: "CodeLlama 7B (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 16_000,
		description: "Local Meta code model",
	},
	{
		id: "ollama:phi4:latest",
		displayName: "Phi-4 (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "medium",
		costTier: "$",
		contextWindow: 16_000,
		description: "Microsoft Phi-4 local model",
	},
	{
		id: "ollama:gemma3:4b",
		displayName: "Gemma3 4B (Local)",
		provider: "ollama",
		requiresKey: "ollamaHost",
		reasoningTier: "fast",
		costTier: "$",
		contextWindow: 128_000,
		description: "Google Gemma3 4B local model",
	},
] as const;

// Free OpenRouter models list (hardcoded for offline display)
const OPENROUTER_FREE_MODELS = MODEL_CATALOG.filter(
	(m) => m.provider === "openrouter" && m.reasoningTier === "free",
);
// Groq models list
const GROQ_MODELS = MODEL_CATALOG.filter((m) => m.provider === "groq");

// ─── In-memory pull job tracker ───────────────────────────────────────────────
const pullJobs = new Map<
	string,
	{ progress: number; status: "pulling" | "done" | "error"; model: string }
>();

// ─── Catalog endpoint ─────────────────────────────────────────────────────────
llmRoute.get("/catalog", (c) => {
	return c.json(MODEL_CATALOG);
});

// ─── Active model status (for top bar pill) ───────────────────────────────────
llmRoute.get("/status", async (c) => {
	// Public route — read header directly since requireCompany middleware doesn't run here.
	let cid = tryGetCompanyId(c) ?? c.req.header("x-company-id") ?? null;
	// Fallback: if no company header, use the first (and often only) company.
	if (!cid) {
		try {
			const row = getRawDb()
				.prepare("SELECT id FROM companies LIMIT 1")
				.get() as { id: string } | undefined;
			if (row) cid = row.id;
		} catch {
			/* ignore */
		}
	}
	if (cid) applyKeysToEnv(cid);

	const settings = cid ? getCompanySettings(cid) : {};

	// CLI adapters (codex, claude) don't need API keys — check binary availability
	const preferredAdapter = (settings as Record<string, unknown>).preferred_adapter as string | undefined;
	const preferredModel = (settings as Record<string, unknown>).preferred_model as string | undefined;
	const cliAdapters: Record<string, string> = {
		codex: "codex",
		codex_local: "codex",
		claude: "claude",
		claude_local: "claude",
		gemini: "gemini",
		gemini_local: "gemini",
	};
	const cliCmd = preferredAdapter ? cliAdapters[preferredAdapter.toLowerCase()] : undefined;
	if (cliCmd) {
		const { spawnSync } = await import("node:child_process");
		const which = spawnSync("which", [cliCmd], { encoding: "utf8" });
		const available = which.status === 0 && !!which.stdout?.trim();
		const displayModel = preferredModel || (cliCmd === "codex" ? "gpt-5.5" : "auto");
		return c.json({
			modelId: displayModel,
			modelName: displayModel,
			provider: cliCmd,
			configured: available,
			live: available,
		});
	}

	const defaultModelId = settings.default_model || null;
	const model = defaultModelId
		? (MODEL_CATALOG.find((m) => m.id === defaultModelId) ?? null)
		: null;

	const provider = model?.provider ?? null;
	const keyEnvByProvider: Record<string, string> = {
		anthropic: "ANTHROPIC_API_KEY",
		openai: "OPENAI_API_KEY",
		gemini: "GEMINI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		groq: "GROQ_API_KEY",
		together: "TOGETHER_API_KEY",
	};
	const keyEnv = provider ? keyEnvByProvider[provider] : undefined;

	let keyConfigured = !!(keyEnv && process.env[keyEnv]);
	if (provider === "ollama") {
		// Actually probe Ollama instead of assuming it's available
		const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";
		try {
			const res = await fetch(`${ollamaUrl}/api/tags`, {
				signal: AbortSignal.timeout(2000),
			});
			keyConfigured = res.ok;
		} catch {
			keyConfigured = false;
		}
	}

	return c.json({
		modelId: defaultModelId,
		modelName: model?.displayName ?? null,
		provider,
		configured: keyConfigured,
		live: !!(defaultModelId && keyConfigured),
	});
});

// ─── Providers list ───────────────────────────────────────────────────────────
llmRoute.get("/providers", async (c) => {
	const settings = await getSettings();
	const ollamaUrl = settings?.ollamaUrl ?? "http://localhost:11434";

	// Apply per-company keys so the configured flags reflect THIS company.
	const cid = tryGetCompanyId(c) ?? c.req.header("x-company-id") ?? null;
	if (cid) applyKeysToEnv(cid);

	const providers = [
		{
			id: "anthropic",
			name: "Anthropic",
			keyEnv: "ANTHROPIC_API_KEY",
			configured: !!process.env["ANTHROPIC_API_KEY"],
		},
		{
			id: "openai",
			name: "OpenAI",
			keyEnv: "OPENAI_API_KEY",
			configured: !!process.env["OPENAI_API_KEY"],
		},
		{
			id: "openrouter",
			name: "OpenRouter",
			keyEnv: "OPENROUTER_API_KEY",
			configured: !!process.env["OPENROUTER_API_KEY"],
		},
		{
			id: "groq",
			name: "Groq",
			keyEnv: "GROQ_API_KEY",
			configured: !!process.env["GROQ_API_KEY"],
		},
		{
			id: "together",
			name: "Together AI",
			keyEnv: "TOGETHER_API_KEY",
			configured: !!process.env["TOGETHER_API_KEY"],
		},
		{
			id: "ollama",
			name: `Ollama (${ollamaUrl})`,
			keyEnv: "",
			configured: false, // will be probed below
		},
	];

	// Probe Ollama availability (fast timeout)
	try {
		const res = await fetch(`${ollamaUrl}/api/tags`, {
			signal: AbortSignal.timeout(2000),
		});
		const ollamaEntry = providers.find((p) => p.id === "ollama");
		if (ollamaEntry) ollamaEntry.configured = res.ok;
	} catch {
		// Ollama not reachable — leave configured: false
	}

	return c.json(providers);
});

// ─── Provider connectivity test ───────────────────────────────────────────────
llmRoute.post(
	"/providers/:provider/test",
	zValidator("json", TestProviderSchema),
	async (c) => {
		const provider = c.req.param("provider");
		const settings = await getSettings();

		// Apply per-company keys so process.env reflects this company's secrets.
		const cid = tryGetCompanyId(c) ?? c.req.header("x-company-id") ?? null;
		if (cid) applyKeysToEnv(cid);

		// Optional inline key for "test before save" UX. If absent, fall back to env.
		const body = c.req.valid("json");
		const inlineKey = body.apiKey?.trim();

		try {
			switch (provider) {
				case "ollama": {
					const url = settings?.ollamaUrl ?? "http://localhost:11434";
					const r = await fetch(`${url}/api/tags`, {
						signal: AbortSignal.timeout(3_000),
					});
					return c.json({ ok: r.ok, provider });
				}
				case "openrouter": {
					const key = inlineKey || process.env["OPENROUTER_API_KEY"];
					if (!key) return c.json({ ok: false, provider, error: "No API key" });
					const r = await fetch("https://openrouter.ai/api/v1/models", {
						headers: { Authorization: `Bearer ${key}` },
						signal: AbortSignal.timeout(5_000),
					});
					if (!r.ok)
						return c.json({ ok: false, provider, error: `HTTP ${r.status}` });
					const data = (await r.json().catch(() => ({}))) as {
						data?: { id: string }[];
					};
					return c.json({ ok: true, provider, model: data.data?.[0]?.id });
				}
				case "groq": {
					const key = inlineKey || process.env["GROQ_API_KEY"];
					if (!key) return c.json({ ok: false, provider, error: "No API key" });
					const r = await fetch("https://api.groq.com/openai/v1/models", {
						headers: { Authorization: `Bearer ${key}` },
						signal: AbortSignal.timeout(5_000),
					});
					if (!r.ok)
						return c.json({ ok: false, provider, error: `HTTP ${r.status}` });
					const data = (await r.json().catch(() => ({}))) as {
						data?: { id: string }[];
					};
					return c.json({ ok: true, provider, model: data.data?.[0]?.id });
				}
				case "openai": {
					const key = inlineKey || process.env["OPENAI_API_KEY"];
					if (!key) return c.json({ ok: false, provider, error: "No API key" });
					const r = await fetch("https://api.openai.com/v1/models", {
						headers: { Authorization: `Bearer ${key}` },
						signal: AbortSignal.timeout(5_000),
					});
					if (!r.ok) {
						const txt = await r.text().catch(() => "");
						return c.json({
							ok: false,
							provider,
							error: `HTTP ${r.status}: ${txt.slice(0, 120)}`,
						});
					}
					const data = (await r.json().catch(() => ({}))) as {
						data?: { id: string }[];
					};
					const ids = (data.data ?? []).map((m) => m.id);
					const preferred =
						ids.find((id) => id.startsWith("gpt-") || id.startsWith("o")) ??
						ids[0];
					return c.json({ ok: true, provider, model: preferred });
				}
				case "anthropic": {
					const key = inlineKey || process.env["ANTHROPIC_API_KEY"];
					if (!key) return c.json({ ok: false, provider, error: "No API key" });
					const r = await fetch("https://api.anthropic.com/v1/messages", {
						method: "POST",
						headers: {
							"x-api-key": key,
							"anthropic-version": "2023-06-01",
							"content-type": "application/json",
						},
						body: JSON.stringify({
							model: "claude-haiku-4-5",
							max_tokens: 1,
							messages: [{ role: "user", content: "ping" }],
						}),
						signal: AbortSignal.timeout(8_000),
					});
					if (r.ok)
						return c.json({ ok: true, provider, model: "claude-haiku-4-5" });
					if (r.status === 400)
						return c.json({ ok: true, provider, model: "claude-haiku-4-5" });
					const txt = await r.text().catch(() => "");
					return c.json({
						ok: false,
						provider,
						error: `HTTP ${r.status}: ${txt.slice(0, 120)}`,
					});
				}
				case "gemini": {
					const key =
						inlineKey ||
						process.env["GEMINI_API_KEY"] ||
						process.env["GOOGLE_API_KEY"];
					if (!key) return c.json({ ok: false, provider, error: "No API key" });
					const r = await fetch(
						`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
						{ signal: AbortSignal.timeout(5_000) },
					);
					if (!r.ok) {
						const txt = await r.text().catch(() => "");
						return c.json({
							ok: false,
							provider,
							error: `HTTP ${r.status}: ${txt.slice(0, 120)}`,
						});
					}
					const data = (await r.json().catch(() => ({}))) as {
						models?: { name: string }[];
					};
					return c.json({ ok: true, provider, model: data.models?.[0]?.name });
				}
				default:
					return c.json(
						{ ok: false, provider, error: "Provider test not supported" },
						400,
					);
			}
		} catch (err) {
			return c.json({ ok: false, provider, error: String(err) });
		}
	},
);

// ─── Provider model list ──────────────────────────────────────────────────────
llmRoute.get("/providers/:provider/models", async (c) => {
	const provider = c.req.param("provider");

	switch (provider) {
		case "ollama": {
			const settings = await getSettings();
			const url = settings?.ollamaUrl ?? "http://localhost:11434";
			try {
				const r = await fetch(`${url}/api/tags`, {
					signal: AbortSignal.timeout(3_000),
				});
				if (!r.ok) return c.json([]);
				const data = (await r.json()) as {
					models?: { name: string; size?: number }[];
				};
				return c.json(
					(data.models ?? []).map((m) => ({
						id: `ollama:${m.name}`,
						name: m.name,
						size: m.size ?? 0,
					})),
				);
			} catch {
				return c.json([]);
			}
		}
		case "openrouter":
			return c.json(OPENROUTER_FREE_MODELS);
		case "groq": {
			const key = process.env["GROQ_API_KEY"];
			if (!key) return c.json(GROQ_MODELS);
			try {
				const r = await fetch("https://api.groq.com/openai/v1/models", {
					headers: { Authorization: `Bearer ${key}` },
					signal: AbortSignal.timeout(5_000),
				});
				if (!r.ok) return c.json(GROQ_MODELS);
				const data = (await r.json().catch(() => ({}))) as {
					data?: { id: string; owned_by?: string; context_window?: number }[];
				};
				if (!data.data?.length) return c.json(GROQ_MODELS);
				// Filter out non-chat models (whisper, TTS, guard, safeguard)
				const SKIP = /whisper|orpheus|prompt-guard|safeguard/i;
				const chatModels = data.data.filter((m) => !SKIP.test(m.id));
				return c.json(
					chatModels.map((m) => ({
						id: `groq:${m.id}`,
						displayName: m.id,
						provider: "groq",
						requiresKey: "groqApiKey",
						reasoningTier: "fast" as const,
						costTier: "$" as const,
						contextWindow: m.context_window ?? 8_192,
						description: `${m.owned_by ?? "Groq"} — ${m.id}`,
					})),
				);
			} catch {
				return c.json(GROQ_MODELS);
			}
		}
		default:
			return c.json(MODEL_CATALOG.filter((m) => m.provider === provider));
	}
});

llmRoute.get("/models", async (c) => {
	try {
		const settings = await getSettings();
		const ollamaUrl = settings?.ollamaUrl ?? "http://localhost:11434";

		const res = await fetch(`${ollamaUrl}/api/tags`, {
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) return c.json([]);
		const data = (await res.json()) as {
			models?: { name: string; size?: number; modified_at?: string }[];
		};
		const models = (data.models ?? []).map((m) => ({
			id: m.name,
			name: m.name,
			provider: "ollama",
			size: m.size ?? 0,
			modifiedAt: m.modified_at ?? null,
		}));
		return c.json(models);
	} catch {
		return c.json([]);
	}
});

llmRoute.post(
	"/models/pull",
	zValidator("json", PullModelSchema),
	async (c) => {
		const body = c.req.valid("json");

		const jobId = crypto.randomUUID();
		pullJobs.set(jobId, { progress: 0, status: "pulling", model: body.name });

		// Fire-and-forget pull request
		void (async () => {
			try {
				const settings = await getSettings();
				const ollamaUrl = settings?.ollamaUrl ?? "http://localhost:11434";
				const res = await fetch(`${ollamaUrl}/api/pull`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: body.name, stream: false }),
					signal: AbortSignal.timeout(300_000),
				});
				pullJobs.set(jobId, {
					progress: 100,
					status: res.ok ? "done" : "error",
					model: body.name,
				});
			} catch {
				pullJobs.set(jobId, { progress: 0, status: "error", model: body.name });
			}
		})();

		return c.json({ jobId }, 202);
	},
);

llmRoute.delete("/models/:name", async (c) => {
	try {
		const settings = await getSettings();
		const ollamaUrl = settings?.ollamaUrl ?? "http://localhost:11434";
		const modelName = c.req.param("name");
		await fetch(`${ollamaUrl}/api/delete`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: modelName }),
			signal: AbortSignal.timeout(10_000),
		});
		return c.json({ ok: true });
	} catch {
		return c.json({ error: "failed to delete" }, 500);
	}
});

llmRoute.get("/pull-progress/:jobId", (c) => {
	const job = pullJobs.get(c.req.param("jobId"));
	if (!job) return c.json({ error: "not found" }, 404);
	return c.json(job);
});

llmRoute.get("/settings", async (c) => {
	const settings = await llmRepo.getSettings();
	return c.json(
		settings ?? {
			id: "default",
			ollamaUrl: "http://localhost:11434",
			lmstudioUrl: "http://localhost:1234",
			defaultOfflineModel: "llama3.2",
			maxConcurrentPulls: 2,
			defaultModel: "claude-sonnet-4-5",
			defaultReasoningTier: "auto",
			budgetAlertPercent: 80,
		},
	);
});

llmRoute.patch(
	"/settings",
	zValidator("json", UpdateLlmSettingsSchema),
	async (c) => {
		const body = c.req.valid("json");

		const updates: {
			ollamaUrl?: string;
			lmstudioUrl?: string;
			defaultOfflineModel?: string;
			maxConcurrentPulls?: number;
			defaultModel?: string;
			defaultReasoningTier?: string;
			budgetAlertPercent?: number;
			openrouterApiKey?: string;
			groqApiKey?: string;
			togetherApiKey?: string;
		} = {};
		if (body.ollamaUrl !== undefined) updates.ollamaUrl = body.ollamaUrl;
		if (body.lmstudioUrl !== undefined) updates.lmstudioUrl = body.lmstudioUrl;
		if (body.defaultOfflineModel !== undefined)
			updates.defaultOfflineModel = body.defaultOfflineModel;
		if (body.maxConcurrentPulls !== undefined)
			updates.maxConcurrentPulls = body.maxConcurrentPulls;
		if (body.defaultModel !== undefined)
			updates.defaultModel = body.defaultModel;
		if (body.defaultReasoningTier !== undefined)
			updates.defaultReasoningTier = body.defaultReasoningTier;
		if (body.budgetAlertPercent !== undefined)
			updates.budgetAlertPercent = body.budgetAlertPercent;
		if (body.openrouterApiKey !== undefined)
			updates.openrouterApiKey = body.openrouterApiKey;
		if (body.groqApiKey !== undefined) updates.groqApiKey = body.groqApiKey;
		if (body.togetherApiKey !== undefined)
			updates.togetherApiKey = body.togetherApiKey;

		const updated = await llmRepo.updateSettings(updates);
		return c.json(updated);
	},
);

async function getSettings() {
	return llmRepo.getSettings();
}
