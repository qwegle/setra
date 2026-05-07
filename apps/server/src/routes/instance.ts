import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import { getCompanySettings } from "../lib/company-settings.js";
import * as instanceRepo from "../repositories/instance.repo.js";
import {
	ToggleFlagSchema,
	TogglePluginSchema,
	UpdateAdapterSchema,
	UpdatePluginConfigSchema,
} from "../validators/instance.validators.js";

export const instanceRoute = new Hono();

type AdapterConfig = Record<string, unknown>;

const OPENAI_COMPATIBLE_ADAPTERS = new Set([
	"openai",
	"openrouter",
	"gemini",
	"lmstudio",
	"mistral",
	"opencode",
]);

function parseAdapterConfig(raw: unknown): AdapterConfig {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		return { ...(raw as AdapterConfig) };
	}
	if (typeof raw !== "string" || raw.trim().length === 0) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? { ...(parsed as AdapterConfig) }
			: {};
	} catch {
		return {};
	}
}

function setConfigString(
	config: AdapterConfig,
	key: string,
	value: string | undefined,
): void {
	if (value === undefined) return;
	const trimmed = value.trim();
	if (trimmed) config[key] = trimmed;
	else delete config[key];
}

function maskSecret(secret: string | null): string | null {
	if (!secret) return null;
	if (secret.length <= 4) return "••••";
	return `••••${secret.slice(-4)}`;
}

function resolveAdapterApiKey(
	id: string,
	config: AdapterConfig,
	settings: Record<string, unknown>,
): string | null {
	if (typeof config.apiKey === "string" && config.apiKey.trim().length > 0) {
		return config.apiKey.trim();
	}

	const keyField =
		id === "claude"
			? "anthropic_api_key"
			: id === "openai"
				? "openai_api_key"
				: id === "openrouter"
					? "openrouter_api_key"
					: id === "gemini"
						? "gemini_api_key"
						: null;
	if (!keyField) return null;

	const value = settings[keyField];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function resolveAdapterBaseUrl(id: string, config: AdapterConfig): string {
	if (typeof config.baseUrl === "string" && config.baseUrl.trim().length > 0) {
		return config.baseUrl.trim();
	}

	switch (id) {
		case "claude":
			return "https://api.anthropic.com";
		case "openrouter":
			return "https://openrouter.ai/api/v1";
		case "ollama":
			return "http://localhost:11434";
		case "lmstudio":
			return "http://localhost:1234/v1";
		case "gemini":
			return "https://generativelanguage.googleapis.com/v1beta/openai";
		default:
			return "https://api.openai.com/v1";
	}
}

function resolveAdapterModel(id: string, config: AdapterConfig): string {
	if (
		typeof config.defaultModel === "string" &&
		config.defaultModel.trim().length > 0
	) {
		return config.defaultModel.trim();
	}

	switch (id) {
		case "claude":
			return "claude-3-5-haiku-latest";
		case "openrouter":
			return "openai/gpt-4o-mini";
		case "gemini":
			return "gemini-2.0-flash";
		default:
			return "gpt-4o-mini";
	}
}

function isVersionedApiBase(baseUrl: string): boolean {
	try {
		return /\/v\d[^/]*\/?$/.test(new URL(baseUrl).pathname);
	} catch {
		return /\/v\d[^/]*\/?$/.test(baseUrl);
	}
}

function joinApiUrl(baseUrl: string, suffix: string): string {
	const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	return new URL(suffix.replace(/^\//, ""), normalizedBase).toString();
}

function computeAdapterConfigured(
	id: string,
	config: AdapterConfig,
	settings: Record<string, unknown>,
): boolean {
	if (id === "ollama") return Boolean(resolveAdapterBaseUrl(id, config));
	if (id === "claude" || OPENAI_COMPATIBLE_ADAPTERS.has(id)) {
		return Boolean(resolveAdapterApiKey(id, config, settings));
	}
	return Object.keys(config).length > 0;
}

async function readErrorText(res: Response): Promise<string> {
	const text = await res.text().catch(() => res.statusText);
	return text.slice(0, 300) || res.statusText;
}

async function testAdapterConnection(
	id: string,
	config: AdapterConfig,
	settings: Record<string, unknown>,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
	const startedAt = Date.now();
	const timeoutMs = 8000;

	try {
		if (id === "ollama") {
			const baseUrl = resolveAdapterBaseUrl(id, config);
			const res = await fetch(joinApiUrl(baseUrl, "api/tags"), {
				method: "GET",
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) {
				return {
					ok: false,
					latencyMs: Date.now() - startedAt,
					error: `Ollama responded with ${res.status}: ${await readErrorText(res)}`,
				};
			}
			return { ok: true, latencyMs: Date.now() - startedAt };
		}

		if (id === "claude") {
			const apiKey = resolveAdapterApiKey(id, config, settings);
			if (!apiKey) {
				return {
					ok: false,
					latencyMs: 0,
					error: "Missing Anthropic API key",
				};
			}

			const baseUrl = resolveAdapterBaseUrl(id, config);
			const endpoint = joinApiUrl(
				baseUrl,
				isVersionedApiBase(baseUrl) ? "messages" : "v1/messages",
			);
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: resolveAdapterModel(id, config),
					max_tokens: 1,
					messages: [{ role: "user", content: "ping" }],
				}),
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) {
				return {
					ok: false,
					latencyMs: Date.now() - startedAt,
					error: `Anthropic responded with ${res.status}: ${await readErrorText(res)}`,
				};
			}
			return { ok: true, latencyMs: Date.now() - startedAt };
		}

		if (OPENAI_COMPATIBLE_ADAPTERS.has(id)) {
			const apiKey = resolveAdapterApiKey(id, config, settings);
			if (!apiKey) {
				return {
					ok: false,
					latencyMs: 0,
					error: "Missing API key",
				};
			}

			const baseUrl = resolveAdapterBaseUrl(id, config);
			const endpoint = joinApiUrl(
				baseUrl,
				isVersionedApiBase(baseUrl)
					? "chat/completions"
					: "v1/chat/completions",
			);
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			};
			if (id === "openrouter") {
				headers["HTTP-Referer"] = "https://setra.local";
				headers["X-Title"] = "setra";
			}
			const res = await fetch(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: resolveAdapterModel(id, config),
					messages: [{ role: "user", content: "ping" }],
					max_tokens: 1,
				}),
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!res.ok) {
				return {
					ok: false,
					latencyMs: Date.now() - startedAt,
					error: `${id} responded with ${res.status}: ${await readErrorText(res)}`,
				};
			}
			return { ok: true, latencyMs: Date.now() - startedAt };
		}

		return {
			ok: false,
			latencyMs: 0,
			error: `Adapter ${id} does not support connection testing yet`,
		};
	} catch (err) {
		return {
			ok: false,
			latencyMs: Date.now() - startedAt,
			error: err instanceof Error ? err.message : "Connection test failed",
		};
	}
}

// ─── Adapters ─────────────────────────────────────────────────────────────────

instanceRoute.get("/adapters", async (c) => {
	await instanceRepo.seedAdapters();
	const companyId = getCompanyId(c);
	const settings = getCompanySettings(companyId);
	const rows = await instanceRepo.listAdapters();
	return c.json(
		rows.map((row) => {
			const config = parseAdapterConfig(row.config);
			return {
				id: row.id,
				name: row.name,
				isConfigured: Boolean(row.isConfigured),
				status: row.isConfigured ? "ok" : "unconfigured",
				models:
					typeof config.defaultModel === "string" &&
					config.defaultModel.trim().length > 0
						? [config.defaultModel.trim()]
						: [],
				apiKeyHint: maskSecret(resolveAdapterApiKey(row.id, config, settings)),
				baseUrl: resolveAdapterBaseUrl(row.id, config),
			};
		}),
	);
});

instanceRoute.patch(
	"/adapters/:id",
	zValidator("json", UpdateAdapterSchema),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const companyId = getCompanyId(c);
		const settings = getCompanySettings(companyId);

		const existing = await instanceRepo.getAdapterWithAllFields(id);
		if (!existing) return c.json({ error: "not found" }, 404);

		const config = parseAdapterConfig(existing.config);
		if (body.config !== undefined) {
			Object.assign(config, parseAdapterConfig(body.config));
		}
		setConfigString(config, "apiKey", body.apiKey);
		setConfigString(config, "baseUrl", body.baseUrl);
		setConfigString(config, "defaultModel", body.defaultModel);

		const updates: Record<string, unknown> = {
			updatedAt: new Date().toISOString(),
		};
		if (body.enabled !== undefined) updates.enabled = body.enabled;
		if (
			body.config !== undefined ||
			body.apiKey !== undefined ||
			body.baseUrl !== undefined ||
			body.defaultModel !== undefined
		) {
			updates.config = JSON.stringify(config);
		}
		updates.isConfigured =
			body.isConfigured ?? computeAdapterConfigured(id, config, settings);

		const updated = await instanceRepo.updateAdapter(id, updates);
		return c.json(updated);
	},
);

// POST /adapters/:id/test — no body. Skipping zValidator.
instanceRoute.post("/adapters/:id/test", async (c) => {
	const id = c.req.param("id");
	const companyId = getCompanyId(c);
	const settings = getCompanySettings(companyId);
	const existing = await instanceRepo.getAdapterWithAllFields(id);
	if (!existing) return c.json({ error: "not found" }, 404);

	const config = parseAdapterConfig(existing.config);
	return c.json(await testAdapterConnection(id, config, settings));
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

instanceRoute.get("/plugins", async (c) => {
	const rows = await instanceRepo.listPlugins();
	return c.json(rows);
});

instanceRoute.post(
	"/plugins/:id/toggle",
	zValidator("json", TogglePluginSchema),
	async (c) => {
		const id = c.req.param("id");
		const existing = await instanceRepo.getPluginById(id);
		if (!existing) return c.json({ error: "not found" }, 404);

		const updated = await instanceRepo.togglePlugin(id, existing.enabled);
		return c.json(updated);
	},
);

instanceRoute.put(
	"/plugins/:id/config",
	zValidator("json", UpdatePluginConfigSchema),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = await instanceRepo.getPluginById(id);
		if (!existing) return c.json({ error: "not found" }, 404);

		const updated = await instanceRepo.updatePluginConfig(
			id,
			JSON.stringify(body.config),
		);
		return c.json(updated);
	},
);

// POST /plugins/:id/install — no body. Skipping zValidator.
instanceRoute.post("/plugins/:id/install", async (c) => {
	const id = c.req.param("id");
	const existing = await instanceRepo.getPluginById(id);
	if (!existing) return c.json({ error: "not found" }, 404);

	const updated = await instanceRepo.installPlugin(id);
	return c.json(updated);
});

instanceRoute.delete("/plugins/:id/uninstall", async (c) => {
	const id = c.req.param("id");
	const existing = await instanceRepo.getPluginById(id);
	if (!existing) return c.json({ error: "not found" }, 404);

	const updated = await instanceRepo.uninstallPlugin(id);
	return c.json(updated);
});

// ─── Feature Flags ────────────────────────────────────────────────────────────

instanceRoute.get("/flags", async (c) => {
	const rows = await instanceRepo.listFeatureFlags();
	return c.json(rows);
});

instanceRoute.post(
	"/flags/:id",
	zValidator("json", ToggleFlagSchema),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const { flag, created } = await instanceRepo.upsertFeatureFlag(
			id,
			body.enabled,
		);
		return c.json(flag, created ? 201 : 200);
	},
);
