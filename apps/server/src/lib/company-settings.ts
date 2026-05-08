/**
 * company-settings.ts — per-company API keys and settings storage.
 *
 * STORAGE SHAPE (v2)
 * ──────────────────────────────────────────────────────────────────────
 * ~/.setra/settings.json
 * {
 *   "version": 2,
 *   "default_company_id": "abc123…",   // legacy keys live under this id
 *   "companies": {
 *     "abc123…": {
 *       "openai_api_key":     "sk-…",
 *       "anthropic_api_key":  "sk-ant-…",
 *       "gemini_api_key":     "AIza…",
 *       "openrouter_api_key": "sk-or-…",
 *       "groq_api_key":       "gsk_…",
 *       "default_model":      "gpt-4.1",
 *       "small_model":        "gpt-4o-mini",
 *       "budget_daily_usd":   10,
 *       "budget_per_run_usd": 2,
 *       "budget_alert_at":    0.8,
 *       "governance_deploy_mode":  "manual",
 *       "governance_auto_approve": false,
 *       "governance_review_risk":  "medium"
 *     }
 *   },
 *   // Top-level fallback. Anything here is used when a company has no override.
 *   "global": {
 *     "tavily_api_key": "…",
 *     "brave_api_key":  "…",
 *     "serper_api_key": "…"
 *   }
 * }
 *
 * MIGRATION (v1 → v2)
 * ──────────────────────────────────────────────────────────────────────
 * v1 stored every key flat at the root. On first load we move LLM-provider
 * keys (anthropic/openai/gemini/openrouter/groq) onto the first company in
 * the `companies` table (or queue them under "_pending_default" until a
 * company exists). Search keys (tavily/brave/serper) move to "global".
 *
 * USAGE
 * ──────────────────────────────────────────────────────────────────────
 *   getCompanyKey(companyId, "openai_api_key")
 *   setCompanyKey(companyId, "openai_api_key", "sk-…")
 *   getCompanySettings(companyId) → flat record (company override merged
 *                                   over global fallback)
 *   getDefaultCompanyId()         → the id v1 keys were migrated to,
 *                                   or the first company in DB
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import {
	deleteSecretFromHooks,
	readSecretFromHooks,
	writeSecretToHooks,
} from "@setra/infrastructure";
import { rawSqlite } from "../db/client.js";
import { decrypt, encrypt } from "./crypto.js";
import { createLogger } from "./logger.js";

export type ProviderKey =
	| "anthropic_api_key"
	| "openai_api_key"
	| "gemini_api_key"
	| "openrouter_api_key"
	| "groq_api_key";

export type GlobalKey =
	| "tavily_api_key"
	| "brave_api_key"
	| "serper_api_key"
	| "together_api_key";

export interface CompanySettings {
	anthropic_api_key?: string;
	openai_api_key?: string;
	gemini_api_key?: string;
	openrouter_api_key?: string;
	groq_api_key?: string;
	preferred_adapter?: string;
	preferred_model?: string;
	default_model?: string;
	small_model?: string;
	budget_daily_usd?: number;
	budget_per_run_usd?: number;
	budget_alert_at?: number;
	governance_deploy_mode?: string;
	governance_auto_approve?: boolean;
	governance_approval_actions?: string[];
	governance_review_risk?: string;
	web_search_enabled?: boolean;
	memory_compaction_enabled?: boolean;
	memory_max_chunks?: number;
	memory_keep_chunks?: number;
	theme?: "dark" | "light" | "system";
	font_family?: string;
	font_size?: number;
	ui_scale?: number;
	sidebar_position?: "left" | "right";
}

interface SettingsFileV2 {
	version: 2;
	default_company_id: string | null;
	companies: Record<string, Record<string, unknown>>;
	global: Record<string, unknown>;
}

const PROVIDER_KEYS: ProviderKey[] = [
	"anthropic_api_key",
	"openai_api_key",
	"gemini_api_key",
	"openrouter_api_key",
	"groq_api_key",
];

/**
 * Validate API key format per provider. Rejects obvious garbage (error
 * messages pasted in by mistake, empty strings, sentences with spaces, etc.)
 * Returns the cleaned key, or throws InvalidKeyError so the caller can show
 * a helpful UX message instead of silently persisting junk.
 */
export class InvalidKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidKeyError";
	}
}

const KEY_FORMATS: Record<
	ProviderKey,
	{ test: (v: string) => boolean; hint: string }
> = {
	anthropic_api_key: {
		test: (v) => /^sk-ant-[\w-]{20,}$/.test(v),
		hint: "Anthropic keys start with 'sk-ant-' and are at least 28 chars.",
	},
	openai_api_key: {
		test: (v) => /^sk-(?:proj-)?[\w-]{20,}$/.test(v),
		hint: "OpenAI keys start with 'sk-' or 'sk-proj-' and are at least 23 chars.",
	},
	gemini_api_key: {
		test: (v) => /^AIza[\w-]{30,}$/.test(v),
		hint: "Google Gemini keys start with 'AIza' and are 39 chars.",
	},
	openrouter_api_key: {
		test: (v) => /^sk-or-(?:v\d-)?[\w-]{20,}$/.test(v),
		hint: "OpenRouter keys start with 'sk-or-' and are at least 26 chars.",
	},
	groq_api_key: {
		test: (v) => /^gsk_[\w-]{20,}$/.test(v),
		hint: "Groq keys start with 'gsk_' and are at least 24 chars.",
	},
};

export function validateProviderKey(key: ProviderKey, value: string): string {
	const v = value.trim();
	if (!v) return ""; // explicit clear is fine
	const fmt = KEY_FORMATS[key];
	// Hard reject sentences (spaces are never in real API keys).
	if (/\s/.test(v)) {
		throw new InvalidKeyError(`That doesn't look like an API key. ${fmt.hint}`);
	}
	if (!fmt.test(v)) {
		throw new InvalidKeyError(
			`Invalid ${key.replace("_api_key", "")} key format. ${fmt.hint}`,
		);
	}
	return v;
}

const COMPANY_SCALAR_KEYS = [
	"default_model",
	"small_model",
	"budget_daily_usd",
	"budget_per_run_usd",
	"budget_alert_at",
	"governance_deploy_mode",
	"governance_auto_approve",
	"governance_approval_actions",
	"governance_review_risk",
	"web_search_enabled",
	"memory_compaction_enabled",
	"memory_max_chunks",
	"memory_keep_chunks",
	"theme",
	"font_family",
	"font_size",
	"ui_scale",
	"sidebar_position",
] as const;

const GLOBAL_KEYS: GlobalKey[] = [
	"tavily_api_key",
	"brave_api_key",
	"serper_api_key",
	"together_api_key",
];

const PENDING_BUCKET = "_pending_default";
const SECRET_SETTING_KEYS = new Set<string>([...PROVIDER_KEYS, ...GLOBAL_KEYS]);
const log = createLogger("company-settings");

function transformSecretFields(
	value: Record<string, unknown>,
	mode: "encrypt" | "decrypt",
): Record<string, unknown> {
	const next = { ...value };
	for (const key of SECRET_SETTING_KEYS) {
		const current = next[key];
		if (typeof current === "string" && current.length > 0) {
			next[key] = mode === "encrypt" ? encrypt(current) : decrypt(current);
		}
	}
	return next;
}

function encryptSettingsFile(data: SettingsFileV2): SettingsFileV2 {
	return {
		...data,
		companies: Object.fromEntries(
			Object.entries(data.companies).map(([companyId, settings]) => [
				companyId,
				transformSecretFields(settings, "encrypt"),
			]),
		),
		global: transformSecretFields(data.global, "encrypt"),
	};
}

function decryptSettingsFile(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	if (
		raw["version"] !== 2 ||
		!raw["companies"] ||
		typeof raw["companies"] !== "object" ||
		!raw["global"] ||
		typeof raw["global"] !== "object"
	) {
		return raw;
	}
	const companies = Object.fromEntries(
		Object.entries(
			raw["companies"] as Record<string, Record<string, unknown>>,
		).map(([companyId, settings]) => [
			companyId,
			transformSecretFields(settings, "decrypt"),
		]),
	);
	return {
		...raw,
		companies,
		global: transformSecretFields(
			raw["global"] as Record<string, unknown>,
			"decrypt",
		),
	};
}

// ─── File I/O ─────────────────────────────────────────────────────────────

function settingsPath(): string {
	return join(homedir(), ".setra", "settings.json");
}

function readRaw(): Record<string, unknown> {
	const p = settingsPath();
	if (!existsSync(p)) return {};
	try {
		return decryptSettingsFile(
			JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>,
		);
	} catch {
		return {};
	}
}

function writeRaw(data: SettingsFileV2): void {
	const dir = dirname(settingsPath());
	mkdirSync(dir, { recursive: true });
	try {
		chmodSync(dir, 0o700);
	} catch {
		/* best-effort */
	}
	writeFileSync(
		settingsPath(),
		JSON.stringify(encryptSettingsFile(data), null, 2),
		"utf-8",
	);
	try {
		chmodSync(settingsPath(), 0o600);
	} catch {
		/* best-effort */
	}
}

function firstCompanyId(): string | null {
	try {
		const row = rawSqlite
			.prepare("SELECT id FROM companies ORDER BY created_at ASC LIMIT 1")
			.get() as { id: string } | undefined;
		return row?.id ?? null;
	} catch {
		return null;
	}
}

// ─── Migration ────────────────────────────────────────────────────────────

/**
 * Convert any legacy state into v2. Idempotent — running this on an already-v2
 * file returns it unchanged.
 *
 *   Case A: file is already v2          → return as-is
 *   Case B: file has flat v1 keys       → bucket provider keys under the
 *                                         first company id (or _pending if
 *                                         no companies exist yet)
 *   Case C: file is empty / missing     → return empty v2
 */
function ensureV2(): SettingsFileV2 {
	const raw = readRaw();

	if (
		raw["version"] === 2 &&
		raw["companies"] &&
		typeof raw["companies"] === "object"
	) {
		const file = raw as unknown as SettingsFileV2;
		file.global ??= {};
		// Auto-purge corrupted provider keys (sentences pasted by mistake, etc.)
		// so users never have to recover the settings file manually.
		let purged = 0;
		for (const [cid, settings] of Object.entries(file.companies)) {
			if (!settings || typeof settings !== "object") continue;
			for (const k of PROVIDER_KEYS) {
				const v = (settings as Record<string, unknown>)[k];
				if (typeof v !== "string" || v === "") continue;
				try {
					validateProviderKey(k, v);
				} catch {
					delete (settings as Record<string, unknown>)[k];
					log.warn("auto-purged corrupted provider key", {
						companyId: cid,
						key: k,
					});
					purged++;
				}
			}
		}
		if (purged > 0) writeRaw(file);
		return file;
	}

	// Build a v2 file from whatever flat keys exist.
	const file: SettingsFileV2 = {
		version: 2,
		default_company_id: null,
		companies: {},
		global: {},
	};

	const targetCompanyId = firstCompanyId() ?? PENDING_BUCKET;
	file.default_company_id =
		targetCompanyId === PENDING_BUCKET ? null : targetCompanyId;

	const companyBucket: Record<string, unknown> = {};
	for (const k of PROVIDER_KEYS)
		if (raw[k] !== undefined) companyBucket[k] = raw[k];
	for (const k of COMPANY_SCALAR_KEYS)
		if (raw[k] !== undefined) companyBucket[k] = raw[k];

	if (Object.keys(companyBucket).length > 0) {
		file.companies[targetCompanyId] = companyBucket;
	}

	for (const k of GLOBAL_KEYS)
		if (raw[k] !== undefined) file.global[k] = raw[k];

	// Only persist if we actually had keys to migrate (avoid creating an empty file).
	const hadAnything =
		Object.keys(companyBucket).length > 0 ||
		Object.keys(file.global).length > 0;
	if (hadAnything || Object.keys(raw).length > 0) {
		writeRaw(file);
	}

	return file;
}

/**
 * Adopt the pending-default bucket (legacy keys held in limbo because no
 * companies existed yet) onto a real company id. Called when a company is
 * first created.
 */
export function adoptPendingDefault(companyId: string): void {
	const file = ensureV2();
	if (!file.companies[PENDING_BUCKET]) {
		if (!file.default_company_id) {
			file.default_company_id = companyId;
			writeRaw(file);
		}
		return;
	}
	file.companies[companyId] = {
		...(file.companies[companyId] ?? {}),
		...file.companies[PENDING_BUCKET],
	};
	delete file.companies[PENDING_BUCKET];
	if (!file.default_company_id) file.default_company_id = companyId;
	writeRaw(file);
}

// ─── Public read API ──────────────────────────────────────────────────────

export function getDefaultCompanyId(): string | null {
	const file = ensureV2();
	if (file.default_company_id) return file.default_company_id;
	return firstCompanyId();
}

/**
 * Resolve a companyId, falling back to the default. Returns null only when
 * there are no companies at all.
 */
function resolveCompanyId(companyId: string | null | undefined): string | null {
	if (companyId) return companyId;
	return getDefaultCompanyId();
}

/**
 * Read a single key for a company. Looks at:
 *   1. companies[companyId][key]
 *   2. global[key]                       (search keys)
 *   3. process.env (last resort)
 */
export function getCompanyKey(
	companyId: string | null | undefined,
	key: string,
): string | undefined {
	const file = ensureV2();
	const cid = resolveCompanyId(companyId);
	const hooked = readSecretFromHooks(cid, key);
	if (typeof hooked === "string" && hooked.length > 0) return hooked;
	if (cid) {
		const v = file.companies[cid]?.[key];
		if (typeof v === "string" && v.length > 0) return v;
	}
	const g = file.global[key];
	if (typeof g === "string" && g.length > 0) return g;
	return undefined;
}

/**
 * Return the merged settings record for a company (company override wins
 * over global fallback). Includes scalar settings (budget, governance)
 * alongside keys.
 */
export function getCompanySettings(
	companyId: string | null | undefined,
): Record<string, unknown> {
	const file = ensureV2();
	const cid = resolveCompanyId(companyId);
	// When no companies exist at all, fall back to the _pending_default bucket
	// so a fresh install can still round-trip settings before onboarding.
	const bucket = cid
		? (file.companies[cid] ?? {})
		: (file.companies[PENDING_BUCKET] ?? {});
	return {
		...file.global,
		...bucket,
		...Object.fromEntries(
			[...PROVIDER_KEYS, ...GLOBAL_KEYS]
				.map((key) => [key, readSecretFromHooks(cid, key)])
				.filter(
					(entry): entry is [string, string] =>
						typeof entry[1] === "string" && entry[1].length > 0,
				),
		),
	};
}

/**
 * Return the raw settings file (used by routes that need to enumerate all
 * companies, e.g. costs page).
 */
export function getAllSettings(): SettingsFileV2 {
	return ensureV2();
}

// ─── Public write API ─────────────────────────────────────────────────────

/**
 * Write a partial set of fields onto a company. Provider keys, scalar
 * settings, and budget/governance all go here. Search keys (brave/tavily/
 * serper) automatically route to `global` instead since they're not
 * provider-specific.
 */
export function setCompanySettings(
	companyId: string | null | undefined,
	patch: Record<string, unknown>,
): void {
	const file = ensureV2();
	const cid = resolveCompanyId(companyId) ?? PENDING_BUCKET;

	file.companies[cid] ??= {};
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) continue;
		// Validate provider keys — rejects pasted error messages, malformed strings.
		if ((PROVIDER_KEYS as string[]).includes(k) && typeof v === "string") {
			const cleaned = validateProviderKey(k as ProviderKey, v);
			// Empty string explicitly clears; otherwise store the cleaned (validated) value.
			if (cleaned === "") {
				deleteSecretFromHooks(cid === PENDING_BUCKET ? null : cid, k);
				delete file.companies[cid][k];
			} else {
				writeSecretToHooks(cid === PENDING_BUCKET ? null : cid, k, cleaned);
				file.companies[cid][k] = cleaned;
			}
			continue;
		}
		if ((GLOBAL_KEYS as string[]).includes(k)) {
			if (typeof v === "string" && v.trim().length === 0) {
				deleteSecretFromHooks(cid === PENDING_BUCKET ? null : cid, k);
			} else if (typeof v === "string") {
				writeSecretToHooks(cid === PENDING_BUCKET ? null : cid, k, v);
			}
			file.global[k] = v;
		} else {
			file.companies[cid][k] = v;
		}
	}
	if (!file.default_company_id && cid !== PENDING_BUCKET) {
		file.default_company_id = cid;
	}
	writeRaw(file);
}

/**
 * Drop a company's settings entirely. Called when a company is deleted.
 */
export function deleteCompanySettings(companyId: string): void {
	const file = ensureV2();
	if (!file.companies[companyId]) return;
	delete file.companies[companyId];
	if (file.default_company_id === companyId) {
		file.default_company_id = firstCompanyId();
	}
	writeRaw(file);
}

/**
 * Apply a company's API keys to process.env so child processes (agent
 * runtimes) inherit them. Called by routes that are about to spawn a run.
 */
export function applyKeysToEnv(companyId: string | null | undefined): void {
	const s = getCompanySettings(companyId);
	if (typeof s["anthropic_api_key"] === "string")
		process.env["ANTHROPIC_API_KEY"] = s["anthropic_api_key"];
	if (typeof s["openai_api_key"] === "string")
		process.env["OPENAI_API_KEY"] = s["openai_api_key"];
	if (typeof s["gemini_api_key"] === "string")
		process.env["GEMINI_API_KEY"] = s["gemini_api_key"];
	if (typeof s["openrouter_api_key"] === "string")
		process.env["OPENROUTER_API_KEY"] = s["openrouter_api_key"];
	if (typeof s["groq_api_key"] === "string")
		process.env["GROQ_API_KEY"] = s["groq_api_key"];
	if (typeof s["tavily_api_key"] === "string")
		process.env["TAVILY_API_KEY"] = s["tavily_api_key"];
	if (typeof s["brave_api_key"] === "string")
		process.env["BRAVE_SEARCH_API_KEY"] = s["brave_api_key"];
	if (typeof s["serper_api_key"] === "string")
		process.env["SERPER_API_KEY"] = s["serper_api_key"];
}
