import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { recheckAvailability } from "../lib/agent-lifecycle.js";
import {
	GOVERNANCE_APPROVAL_ACTIONS,
	getApprovalActionsFromSettings,
} from "../lib/approval-gates.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	applyKeysToEnv,
	getCompanySettings,
	setCompanySettings,
} from "../lib/company-settings.js";
import * as settingsRepo from "../repositories/settings.repo.js";
import {
	PatchSettingsSchema,
	SaveSettingsSchema,
} from "../validators/settings.validators.js";

const app = new Hono();

/**
 * The settings route is mounted under `requireCompany`, so the active
 * company id always comes from the validated middleware context. We no
 * longer trust raw `?companyId=` or `x-company-id` directly — that was a
 * cross-tenant data-disclosure bug.
 */
function resolveCid(c: Parameters<typeof getCompanyId>[0]): string {
	return getCompanyId(c);
}

// Mask a secret key — keep last 4 chars only.
function maskKey(v: unknown): string {
	if (typeof v !== "string" || v.length === 0) return "";
	if (v.length <= 6) return "•••••••";
	return `••••••••${v.slice(-4)}`;
}

// GET /api/settings — returns non-secret fields + masked previews of any saved keys
app.get("/", (c) => {
	const cid = resolveCid(c);
	const s = getCompanySettings(cid);
	const approvalActions = getApprovalActionsFromSettings(s);
	const isOfflineOnly = settingsRepo.isCompanyOfflineOnly(cid);
	return c.json({
		companyId: cid,
		isOfflineOnly,
		defaultModel: s["default_model"] ?? "claude-sonnet-4-6",
		smallModel: s["small_model"] ?? "claude-haiku-4-5",
		budget: {
			dailyUsd: s["budget_daily_usd"] ?? 10,
			perRunUsd: s["budget_per_run_usd"] ?? 2,
			alertAt: s["budget_alert_at"] ?? 0.8,
		},
		governance: {
			deployMode: s["governance_deploy_mode"] ?? "manual",
			autoApprove: s["governance_auto_approve"] ?? false,
			approvalActions,
			availableApprovalActions: GOVERNANCE_APPROVAL_ACTIONS,
			reviewRisk: s["governance_review_risk"] ?? "medium",
		},
		autonomy: {
			autoDispatchEnabled: s["auto_dispatch_enabled"] ?? true,
			maxParallelRuns:
				typeof s["max_parallel_runs"] === "number" ? s["max_parallel_runs"] : 7,
		},
		webSearchEnabled: s["web_search_enabled"] !== false,
		memory: {
			compactionEnabled: s["memory_compaction_enabled"] ?? true,
			maxChunks:
				typeof s["memory_max_chunks"] === "number"
					? s["memory_max_chunks"]
					: 400,
			keepChunks:
				typeof s["memory_keep_chunks"] === "number"
					? s["memory_keep_chunks"]
					: 80,
		},
		appearance: {
			theme:
				s["theme"] === "light" || s["theme"] === "system" ? s["theme"] : "dark",
			fontFamily:
				typeof s["font_family"] === "string" && s["font_family"].trim()
					? s["font_family"]
					: "JetBrains Mono, monospace",
			fontSize: typeof s["font_size"] === "number" ? s["font_size"] : 13,
			uiScale: typeof s["ui_scale"] === "number" ? s["ui_scale"] : 100,
			sidebarPosition: s["sidebar_position"] === "right" ? "right" : "left",
		},
		hasAnthropicKey: Boolean(s["anthropic_api_key"]),
		hasOpenaiKey: Boolean(s["openai_api_key"]),
		hasOpenrouterKey: Boolean(s["openrouter_api_key"]),
		hasGroqKey: Boolean(s["groq_api_key"]),
		hasGeminiKey: Boolean(s["gemini_api_key"]),
		hasTogetherKey: Boolean(s["together_api_key"]),
		hasTavilyKey: Boolean(s["tavily_api_key"]),
		hasBraveKey: Boolean(s["brave_api_key"]),
		hasSerperKey: Boolean(s["serper_api_key"]),
		keys: {
			anthropic: maskKey(s["anthropic_api_key"]),
			openai: maskKey(s["openai_api_key"]),
			openrouter: maskKey(s["openrouter_api_key"]),
			groq: maskKey(s["groq_api_key"]),
			gemini: maskKey(s["gemini_api_key"]),
			together: maskKey(s["together_api_key"]),
			tavily: maskKey(s["tavily_api_key"]),
			brave: maskKey(s["brave_api_key"]),
			serper: maskKey(s["serper_api_key"]),
		},
	});
});

// GET /api/settings/models — available models based on configured API keys
app.get("/models", (c) => {
	const cid = resolveCid(c);
	const s = getCompanySettings(cid);

	// In offline mode the user explicitly opted out of cloud — drop every
	// cloud-provider entry from the list so pickers (onboarding, agents,
	// settings) only show local options.
	const offline = settingsRepo.isCompanyOfflineOnly(cid);
	const CLOUD = new Set([
		"anthropic",
		"openai",
		"openrouter",
		"groq",
		"gemini",
		"together",
	]);

	type ModelEntry = {
		id: string;
		label: string;
		provider: string;
		tier: string;
	};
	const models: ModelEntry[] = [];

	// ── Cost tier legend ──────────────────────────────────────────
	// Free = $0 (community / free-tier)
	// 1x   = baseline (~$0.15/M input) — cheap mini models
	// 2x   = ~$0.30/M — fast workhorse models
	// 3x   = ~$0.50/M — balanced quality/cost
	// 4x   = ~$1/M   — strong general purpose
	// 6x   = ~$2/M   — advanced coding / reasoning
	// 8x   = ~$3/M   — frontier models
	// 10x  = ~$5/M   — premium flagship
	// 12x  = ~$8/M   — top-tier flagship
	// 16x  = ~$15/M  — reasoning / thinking models
	// Local = free (runs on your hardware via Ollama)

	// Always include OpenRouter free models (no key needed)
	if (!offline)
		models.push(
			{
				id: "openrouter:openrouter/auto",
				label: "OpenRouter Auto · Smart routing",
				provider: "openrouter",
				tier: "auto",
			},
			{
				id: "openrouter:google/gemini-2.5-flash-preview-05-20:free",
				label: "Gemini 2.5 Flash · Free",
				provider: "openrouter",
				tier: "free",
			},
			{
				id: "openrouter:qwen/qwen3-235b-a22b:free",
				label: "Qwen3 235B · Free",
				provider: "openrouter",
				tier: "free",
			},
			{
				id: "openrouter:meta-llama/llama-4-maverick:free",
				label: "Llama 4 Maverick · Free",
				provider: "openrouter",
				tier: "free",
			},
		);

	if (!offline && s["anthropic_api_key"]) {
		models.push(
			{
				id: "claude-opus-4-7",
				label: "Claude Opus 4.7 · 16x Expensive",
				provider: "anthropic",
				tier: "16x",
			},
			{
				id: "claude-sonnet-4-6",
				label: "Claude Sonnet 4.6 · 8x Premium",
				provider: "anthropic",
				tier: "8x",
			},
			{
				id: "claude-opus-4-5",
				label: "Claude Opus 4.5 · 12x Expensive",
				provider: "anthropic",
				tier: "12x",
			},
			{
				id: "claude-sonnet-4-5",
				label: "Claude Sonnet 4.5 · 6x Moderate",
				provider: "anthropic",
				tier: "6x",
			},
			{
				id: "claude-sonnet-4",
				label: "Claude Sonnet 4 · 4x Affordable",
				provider: "anthropic",
				tier: "4x",
			},
			{
				id: "claude-haiku-4-5",
				label: "Claude Haiku 4.5 · 1x Cheap",
				provider: "anthropic",
				tier: "1x",
			},
		);
	}

	if (!offline && s["openai_api_key"]) {
		models.push(
			{
				id: "gpt-5.5",
				label: "GPT-5.5 · 12x Expensive",
				provider: "openai",
				tier: "12x",
			},
			{
				id: "gpt-5.4",
				label: "GPT-5.4 · 8x Premium",
				provider: "openai",
				tier: "8x",
			},
			{
				id: "gpt-5.4-mini",
				label: "GPT-5.4 Mini · 2x Low cost",
				provider: "openai",
				tier: "2x",
			},
			{
				id: "gpt-5.3-codex",
				label: "GPT-5.3 Codex · 10x Expensive",
				provider: "openai",
				tier: "10x",
			},
			{
				id: "gpt-5.2-codex",
				label: "GPT-5.2 Codex · 8x Premium",
				provider: "openai",
				tier: "8x",
			},
			{
				id: "gpt-4.1",
				label: "GPT-4.1 · 4x Affordable",
				provider: "openai",
				tier: "4x",
			},
			{
				id: "gpt-4.1-mini",
				label: "GPT-4.1 Mini · 1x Cheap",
				provider: "openai",
				tier: "1x",
			},
			{
				id: "gpt-4o",
				label: "GPT-4o · 4x Affordable",
				provider: "openai",
				tier: "4x",
			},
			{
				id: "o3",
				label: "o3 · 16x Expensive",
				provider: "openai",
				tier: "16x",
			},
			{
				id: "o4-mini",
				label: "o4-mini · 3x Low cost",
				provider: "openai",
				tier: "3x",
			},
			{
				id: "gpt-4o-mini",
				label: "GPT-4o Mini · 1x Cheapest",
				provider: "openai",
				tier: "1x",
			},
		);
	}

	if (!offline && s["gemini_api_key"]) {
		models.push(
			{
				id: "gemini-2.5-pro",
				label: "Gemini 2.5 Pro · 6x Moderate",
				provider: "gemini",
				tier: "6x",
			},
			{
				id: "gemini-2.5-flash",
				label: "Gemini 2.5 Flash · 1x Cheap",
				provider: "gemini",
				tier: "1x",
			},
			{
				id: "gemini-2.0-flash",
				label: "Gemini 2.0 Flash · 1x Cheapest",
				provider: "gemini",
				tier: "1x",
			},
		);
	}

	if (!offline && s["openrouter_api_key"]) {
		models.push(
			{
				id: "openrouter:anthropic/claude-opus-4-7",
				label: "Claude Opus 4.7 via OR · 16x Expensive",
				provider: "openrouter",
				tier: "16x",
			},
			{
				id: "openrouter:openai/gpt-5.4",
				label: "GPT-5.4 via OR · 8x Premium",
				provider: "openrouter",
				tier: "8x",
			},
			{
				id: "openrouter:google/gemini-2.5-pro",
				label: "Gemini 2.5 Pro via OR · 6x Moderate",
				provider: "openrouter",
				tier: "6x",
			},
			{
				id: "openrouter:deepseek/deepseek-v3.2",
				label: "DeepSeek V3.2 via OR · 2x Low cost",
				provider: "openrouter",
				tier: "2x",
			},
			{
				id: "openrouter:meta-llama/llama-4-maverick",
				label: "Llama 4 Maverick via OR · 2x Low cost",
				provider: "openrouter",
				tier: "2x",
			},
			{
				id: "openrouter:x-ai/grok-4.3",
				label: "Grok 4.3 via OR · 6x Moderate",
				provider: "openrouter",
				tier: "6x",
			},
		);
	}

	if (!offline && s["groq_api_key"]) {
		models.push(
			{
				id: "groq:llama-3.3-70b-versatile",
				label: "Llama 3.3 70B · Groq Free",
				provider: "groq",
				tier: "free",
			},
			{
				id: "groq:qwen-qwq-32b",
				label: "Qwen QwQ 32B · Groq Free",
				provider: "groq",
				tier: "free",
			},
			{
				id: "groq:deepseek-r1-distill-llama-70b",
				label: "DeepSeek R1 70B · Groq Free",
				provider: "groq",
				tier: "free",
			},
		);
	}

	// Always include Ollama local models (free — runs on your hardware)
	models.push(
		{
			id: "ollama:kimi-k2.6",
			label: "Kimi K2.6 · Local Free",
			provider: "ollama",
			tier: "local",
		},
		{
			id: "ollama:qwen3.5",
			label: "Qwen 3.5 · Local Free",
			provider: "ollama",
			tier: "local",
		},
		{
			id: "ollama:llama3.2:latest",
			label: "Llama 3.2 · Local Free",
			provider: "ollama",
			tier: "local",
		},
		{
			id: "ollama:qwen2.5-coder:7b",
			label: "Qwen 2.5 Coder 7B · Local Free",
			provider: "ollama",
			tier: "local",
		},
		{
			id: "ollama:deepseek-r1:7b",
			label: "DeepSeek R1 7B · Local Free",
			provider: "ollama",
			tier: "local",
		},
		{
			id: "ollama:glm-5.1",
			label: "GLM 5.1 · Local Free",
			provider: "ollama",
			tier: "local",
		},
		{
			id: "ollama:minimax-m2.7",
			label: "MiniMax M2.7 · Local Free",
			provider: "ollama",
			tier: "local",
		},
	);

	// Honor the user's saved choice. Only fall back to a provider-specific
	// default when nothing has been saved yet — never silently overwrite a
	// saved id, otherwise the picker becomes un-changeable.
	const savedDefault = s["default_model"] as string | undefined;
	let defaultModel: string;
	if (savedDefault && savedDefault.length > 0) {
		defaultModel = savedDefault;
	} else if (!offline && s["anthropic_api_key"]) {
		defaultModel = "claude-sonnet-4-5";
	} else if (!offline && s["openai_api_key"]) {
		defaultModel = "gpt-4o";
	} else if (offline) {
		defaultModel = "ollama:llama3.2:latest";
	} else {
		defaultModel = "openrouter:openrouter/auto";
	}

	// Final safety net: if offline, drop any cloud entries that slipped through
	// (e.g. a stale default_model id).
	const filtered = offline
		? models.filter((m) => !CLOUD.has(m.provider))
		: models;
	if (offline && !filtered.some((m) => m.id === defaultModel)) {
		defaultModel = filtered[0]?.id ?? "ollama:llama3.2:latest";
	}

	return c.json({ models: filtered, defaultModel });
});

// POST /api/settings — save settings; applies API keys to process.env immediately
app.post("/", zValidator("json", SaveSettingsSchema), async (c) => {
	const cid = resolveCid(c);
	const body = c.req.valid("json");

	const targetCid = cid;
	const patch: Record<string, unknown> = {};

	// Treat masked previews (the strings we return from GET /api/settings) as
	// "no change" so the SettingsPage hydrating its inputs from /api/settings
	// and saving without edits doesn't clobber the real key with a mask.
	const isMaskedPreview = (v: string): boolean =>
		v.includes("•") || v.includes("\u2022");
	const setKey = (field: string, value: string | undefined): void => {
		if (value === undefined) return;
		const trimmed = value.trim();
		if (trimmed.length > 0 && isMaskedPreview(trimmed)) return;
		patch[field] = trimmed;
	};

	setKey("anthropic_api_key", body.anthropicApiKey);
	setKey("openai_api_key", body.openaiApiKey);
	setKey("openrouter_api_key", body.openrouterApiKey);
	setKey("groq_api_key", body.groqApiKey);
	setKey("gemini_api_key", body.geminiApiKey);
	setKey("together_api_key", body.togetherApiKey);
	setKey("tavily_api_key", body.tavilyApiKey);
	setKey("brave_api_key", body.braveApiKey);
	setKey("serper_api_key", body.serperApiKey);
	if (body.webSearchEnabled !== undefined)
		patch["web_search_enabled"] = body.webSearchEnabled;
	if (body.defaultModel) patch["default_model"] = body.defaultModel;
	if (body.smallModel) patch["small_model"] = body.smallModel;
	if (body.budget) {
		if (body.budget.dailyUsd !== undefined)
			patch["budget_daily_usd"] = body.budget.dailyUsd;
		if (body.budget.perRunUsd !== undefined)
			patch["budget_per_run_usd"] = body.budget.perRunUsd;
		if (body.budget.alertAt !== undefined)
			patch["budget_alert_at"] = body.budget.alertAt;
	}
	if (body.governance) {
		if (body.governance.deployMode !== undefined)
			patch["governance_deploy_mode"] = body.governance.deployMode;
		if (body.governance.autoApprove !== undefined)
			patch["governance_auto_approve"] = body.governance.autoApprove;
		if (body.governance.approvalActions !== undefined)
			patch["governance_approval_actions"] = body.governance.approvalActions;
		if (body.governance.reviewRisk !== undefined)
			patch["governance_review_risk"] = body.governance.reviewRisk;
	}
	if (body.autonomy) {
		if (body.autonomy.autoDispatchEnabled !== undefined)
			patch["auto_dispatch_enabled"] = body.autonomy.autoDispatchEnabled;
		if (body.autonomy.maxParallelRuns !== undefined)
			patch["max_parallel_runs"] = body.autonomy.maxParallelRuns;
	}
	if (body.memory) {
		if (body.memory.compactionEnabled !== undefined)
			patch["memory_compaction_enabled"] = body.memory.compactionEnabled;
		if (body.memory.maxChunks !== undefined)
			patch["memory_max_chunks"] = body.memory.maxChunks;
		if (body.memory.keepChunks !== undefined)
			patch["memory_keep_chunks"] = body.memory.keepChunks;
	}
	if (body.appearance) {
		if (body.appearance.theme !== undefined)
			patch["theme"] = body.appearance.theme;
		if (body.appearance.fontFamily !== undefined)
			patch["font_family"] = body.appearance.fontFamily;
		if (body.appearance.fontSize !== undefined)
			patch["font_size"] = body.appearance.fontSize;
		if (body.appearance.uiScale !== undefined)
			patch["ui_scale"] = body.appearance.uiScale;
		if (body.appearance.sidebarPosition !== undefined)
			patch["sidebar_position"] = body.appearance.sidebarPosition;
	}

	setCompanySettings(targetCid, patch);
	applyKeysToEnv(targetCid);

	// Re-check awaiting_key agents for THIS company now that a key may have
	// been saved. recheckAvailability flips them to 'idle' with a freshly
	// resolved adapter+model when a provider is now configured. SSE notifies
	// the UI.
	let recheck;
	try {
		recheck = recheckAvailability(targetCid);
	} catch {
		recheck = { examined: 0, activated: 0, agents: [] };
	}

	return c.json({ ok: true, companyId: targetCid, recheck });
});

// PATCH /api/settings — partial update (used by Electron sync; never sends secrets)
app.patch("/", zValidator("json", PatchSettingsSchema), async (c) => {
	const cid = resolveCid(c);
	const body = c.req.valid("json");

	const targetCid = cid;
	const patch: Record<string, unknown> = {};
	if (body.defaultModel) patch["default_model"] = body.defaultModel;
	if (body.smallModel) patch["small_model"] = body.smallModel;
	if (body.webSearchEnabled !== undefined)
		patch["web_search_enabled"] = body.webSearchEnabled;
	if (body.autonomy) {
		if (body.autonomy.autoDispatchEnabled !== undefined)
			patch["auto_dispatch_enabled"] = body.autonomy.autoDispatchEnabled;
		if (body.autonomy.maxParallelRuns !== undefined)
			patch["max_parallel_runs"] = body.autonomy.maxParallelRuns;
	}
	if (body.governance) {
		if (body.governance.deployMode !== undefined)
			patch["governance_deploy_mode"] = body.governance.deployMode;
		if (body.governance.autoApprove !== undefined)
			patch["governance_auto_approve"] = body.governance.autoApprove;
		if (body.governance.approvalActions !== undefined)
			patch["governance_approval_actions"] = body.governance.approvalActions;
		if (body.governance.reviewRisk !== undefined)
			patch["governance_review_risk"] = body.governance.reviewRisk;
	}
	if (body.memory) {
		if (body.memory.compactionEnabled !== undefined)
			patch["memory_compaction_enabled"] = body.memory.compactionEnabled;
		if (body.memory.maxChunks !== undefined)
			patch["memory_max_chunks"] = body.memory.maxChunks;
		if (body.memory.keepChunks !== undefined)
			patch["memory_keep_chunks"] = body.memory.keepChunks;
	}
	if (body.appearance) {
		if (body.appearance.theme !== undefined)
			patch["theme"] = body.appearance.theme;
		if (body.appearance.fontFamily !== undefined)
			patch["font_family"] = body.appearance.fontFamily;
		if (body.appearance.fontSize !== undefined)
			patch["font_size"] = body.appearance.fontSize;
		if (body.appearance.uiScale !== undefined)
			patch["ui_scale"] = body.appearance.uiScale;
		if (body.appearance.sidebarPosition !== undefined)
			patch["sidebar_position"] = body.appearance.sidebarPosition;
	}

	setCompanySettings(targetCid, patch);
	return c.json({ ok: true, companyId: targetCid });
});

export default app;
