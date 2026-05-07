/**
 * settings.ts — IPC handlers for persisting app settings in SQLite.
 *
 * Keys stored in app_settings:
 *   anthropic_api_key, openai_api_key, gemini_api_key
 *   default_model, tavily_api_key, brave_api_key
 *   web_search_provider ("tavily" | "brave" | "none")
 *   budget_default_usd (default per-plot budget cap, 0 = unlimited)
 *
 * On app start, all keys are loaded into process.env so agent adapters
 * can read them as standard env vars.
 *
 * Settings are also synced to ~/.setra/settings.json so the companion
 * server process (apps/server) can read the same values.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDb } from "@setra/db";
import * as schema from "@setra/db/schema";
import { eq } from "drizzle-orm";
import { ipcMain } from "electron";

// Map from our settings key → env var name injected for agents
const KEY_TO_ENV: Record<string, string> = {
	anthropic_api_key: "ANTHROPIC_API_KEY",
	openai_api_key: "OPENAI_API_KEY",
	gemini_api_key: "GEMINI_API_KEY",
	tavily_api_key: "TAVILY_API_KEY",
	brave_api_key: "BRAVE_SEARCH_API_KEY",
	web_search_provider: "WEB_SEARCH_PROVIDER",
	ollama_host: "OLLAMA_HOST",
	openrouter_api_key: "OPENROUTER_API_KEY",
	groq_api_key: "GROQ_API_KEY",
	github_token: "GITHUB_TOKEN",
};

const SETTINGS_JSON_PATH = join(homedir(), ".setra", "settings.json");

/** Read ~/.setra/settings.json (returns {} if missing/corrupt) */
function readSettingsJson(): Record<string, string> {
	try {
		if (!existsSync(SETTINGS_JSON_PATH)) return {};
		return JSON.parse(readFileSync(SETTINGS_JSON_PATH, "utf-8")) as Record<
			string,
			string
		>;
	} catch {
		return {};
	}
}

/** Sync a key→value map into ~/.setra/settings.json, merging with existing */
function syncToSettingsJson(patch: Record<string, string>): void {
	try {
		mkdirSync(join(homedir(), ".setra"), { recursive: true });
		const current = readSettingsJson();
		const merged = { ...current, ...patch };
		writeFileSync(SETTINGS_JSON_PATH, JSON.stringify(merged, null, 2), "utf-8");
	} catch (err) {
		console.warn("[settings] failed to sync settings.json:", err);
	}
}

/**
 * Called once at startup — loads all settings from SQLite into process.env
 * AND syncs them to ~/.setra/settings.json for the server process.
 */
export function loadSettingsIntoEnv(): void {
	try {
		const db = getDb();
		const rows = db.select().from(schema.appSettings).all();
		const patch: Record<string, string> = {};
		for (const row of rows) {
			const envKey = KEY_TO_ENV[row.key];
			if (envKey && row.value) {
				process.env[envKey] = row.value;
			}
			// All known keys (even empty) go to settings.json so server sees them
			patch[row.key] = row.value;
		}
		syncToSettingsJson(patch);
		console.log(`[settings] loaded ${rows.length} settings into env`);
	} catch (err) {
		console.warn("[settings] failed to load settings:", err);
	}
}

/**
 * Get the live env vars that should be injected when spawning agent processes.
 * Returns a partial Record of env var name → value.
 */
export function getAgentEnvOverrides(): Record<string, string> {
	const overrides: Record<string, string> = {};
	for (const envKey of Object.values(KEY_TO_ENV)) {
		const val = process.env[envKey];
		if (val) overrides[envKey] = val;
	}
	return overrides;
}

export function registerSettingsHandlers(): void {
	// settings:get — returns all settings as a key→value map
	ipcMain.handle("settings:get", async () => {
		const db = getDb();
		const rows = db.select().from(schema.appSettings).all();
		const map: Record<string, string> = {};
		for (const row of rows) map[row.key] = row.value;
		return map;
	});

	// settings:set — upsert a single key
	ipcMain.handle("settings:set", async (_e, key: string, value: string) => {
		const db = getDb();
		db.insert(schema.appSettings)
			.values({ key, value })
			.onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
			.run();
		// Update process.env live so next agent spawn picks it up
		const envKey = KEY_TO_ENV[key];
		if (envKey) {
			if (value) process.env[envKey] = value;
			else delete process.env[envKey];
		}
		// Sync to settings.json so the server process sees the update immediately
		syncToSettingsJson({ [key]: value });
		return { ok: true };
	});

	// settings:set-many — upsert multiple keys at once
	ipcMain.handle(
		"settings:set-many",
		async (_e, entries: Record<string, string>) => {
			const db = getDb();
			for (const [key, value] of Object.entries(entries)) {
				db.insert(schema.appSettings)
					.values({ key, value })
					.onConflictDoUpdate({
						target: schema.appSettings.key,
						set: { value },
					})
					.run();
				const envKey = KEY_TO_ENV[key];
				if (envKey) {
					if (value) process.env[envKey] = value;
					else delete process.env[envKey];
				}
			}
			// Sync all at once to settings.json
			syncToSettingsJson(entries);
			return { ok: true };
		},
	);

	// settings:delete — remove a key
	ipcMain.handle("settings:delete", async (_e, key: string) => {
		const db = getDb();
		db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
		const envKey = KEY_TO_ENV[key];
		if (envKey) delete process.env[envKey];
		// Remove from settings.json so the server process no longer sees the key
		try {
			const current = readSettingsJson();
			delete current[key];
			mkdirSync(join(homedir(), ".setra"), { recursive: true });
			writeFileSync(
				SETTINGS_JSON_PATH,
				JSON.stringify(current, null, 2),
				"utf-8",
			);
		} catch (err) {
			console.warn("[settings] failed to remove key from settings.json:", err);
		}
		return { ok: true };
	});
}
