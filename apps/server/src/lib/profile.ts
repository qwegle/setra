/**
 * profile.ts — Setra operator profile.
 *
 * Stores a small, non-secret JSON file at ~/.setra/profile.json describing
 * the human operator's preferences, working style, and durable context that
 * helps agents act in line with how this operator works.
 *
 * Two integration points:
 *
 *   1. `buildOperatorProfileSection(...)` is injected into the system prompt
 *      by prompt-builder.ts so every agent sees a stable Operator Profile
 *      block.
 *
 *   2. `distillProfileFromRun(...)` is called from run-lifecycle.ts after a
 *      successful run completes. It scans the run summary + tool calls for
 *      durable, non-secret facts and merges them into the profile.
 *
 * The profile file never contains secrets, API keys, tokens, or PII beyond
 * what the operator has chosen to surface (e.g. display name, preferred
 * working hours, tone preference). Untrusted strings (run transcripts) are
 * scrubbed before they are written.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface SetraProfile {
	version: 1;
	displayName?: string;
	tone?: "casual" | "neutral" | "formal";
	timezone?: string;
	workingHours?: string;
	preferredCli?: string;
	preferences: string[];
	style: string[];
	context: string[];
	updatedAt: string;
}

const PROFILE_PATH = join(homedir(), ".setra", "profile.json");
const MAX_FACTS_PER_BUCKET = 20;
const MAX_FACT_LENGTH = 200;

const SECRET_PATTERNS = [
	/sk-[A-Za-z0-9_-]{16,}/g,
	/AIza[0-9A-Za-z_-]{20,}/g,
	/ghp_[A-Za-z0-9]{20,}/g,
	/github_pat_[A-Za-z0-9_]{20,}/g,
	/AKIA[0-9A-Z]{12,}/g,
	/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
	/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

function scrubSecrets(input: string): string {
	let out = input;
	for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
	return out;
}

function emptyProfile(): SetraProfile {
	return {
		version: 1,
		preferences: [],
		style: [],
		context: [],
		updatedAt: new Date().toISOString(),
	};
}

export function loadProfile(): SetraProfile {
	if (!existsSync(PROFILE_PATH)) return emptyProfile();
	try {
		const raw = readFileSync(PROFILE_PATH, "utf-8");
		const parsed = JSON.parse(raw) as Partial<SetraProfile>;
		const out: SetraProfile = {
			version: 1,
			preferences: Array.isArray(parsed.preferences) ? parsed.preferences : [],
			style: Array.isArray(parsed.style) ? parsed.style : [],
			context: Array.isArray(parsed.context) ? parsed.context : [],
			updatedAt: parsed.updatedAt ?? new Date().toISOString(),
		};
		if (parsed.displayName) out.displayName = parsed.displayName;
		if (parsed.tone) out.tone = parsed.tone;
		if (parsed.timezone) out.timezone = parsed.timezone;
		if (parsed.workingHours) out.workingHours = parsed.workingHours;
		if (parsed.preferredCli) out.preferredCli = parsed.preferredCli;
		return out;
	} catch {
		return emptyProfile();
	}
}

export function saveProfile(profile: SetraProfile): void {
	mkdirSync(dirname(PROFILE_PATH), { recursive: true });
	writeFileSync(
		PROFILE_PATH,
		JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }, null, 2),
		"utf-8",
	);
}

function dedupeBucket(existing: string[], incoming: string[]): string[] {
	const seen = new Set(existing.map((s) => s.toLowerCase()));
	const out = [...existing];
	for (const raw of incoming) {
		const fact = scrubSecrets(raw).trim().slice(0, MAX_FACT_LENGTH);
		if (fact.length < 8) continue;
		const key = fact.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(fact);
	}
	while (out.length > MAX_FACTS_PER_BUCKET) out.shift();
	return out;
}

export interface ProfileUpdate {
	preferences?: string[];
	style?: string[];
	context?: string[];
	displayName?: string;
	tone?: SetraProfile["tone"];
	timezone?: string;
	workingHours?: string;
	preferredCli?: string;
}

export function updateProfile(update: ProfileUpdate): SetraProfile {
	const profile = loadProfile();
	if (update.displayName) profile.displayName = update.displayName;
	if (update.tone) profile.tone = update.tone;
	if (update.timezone) profile.timezone = update.timezone;
	if (update.workingHours) profile.workingHours = update.workingHours;
	if (update.preferredCli) profile.preferredCli = update.preferredCli;
	if (update.preferences)
		profile.preferences = dedupeBucket(profile.preferences, update.preferences);
	if (update.style) profile.style = dedupeBucket(profile.style, update.style);
	if (update.context)
		profile.context = dedupeBucket(profile.context, update.context);
	saveProfile(profile);
	return profile;
}

/**
 * Build the Operator Profile section injected into system prompts.
 * Returns "" when the profile is effectively empty so we don't pad prompts
 * with a useless heading.
 */
export function buildOperatorProfileSection(): string {
	const p = loadProfile();
	const lines: string[] = [];

	const header: string[] = [];
	if (p.displayName) header.push(`Name: ${p.displayName}`);
	if (p.timezone) header.push(`Timezone: ${p.timezone}`);
	if (p.workingHours) header.push(`Working hours: ${p.workingHours}`);
	if (p.tone) header.push(`Preferred tone: ${p.tone}`);
	if (p.preferredCli) header.push(`Preferred CLI: ${p.preferredCli}`);
	if (header.length > 0) lines.push(header.join(" · "));

	if (p.preferences.length > 0) {
		lines.push("");
		lines.push("Preferences:");
		for (const f of p.preferences) lines.push(`- ${f}`);
	}
	if (p.style.length > 0) {
		lines.push("");
		lines.push("Working style:");
		for (const f of p.style) lines.push(`- ${f}`);
	}
	if (p.context.length > 0) {
		lines.push("");
		lines.push("Durable context:");
		for (const f of p.context) lines.push(`- ${f}`);
	}

	if (lines.length === 0) return "";

	return `## Operator Profile\n${lines.join("\n")}\n\nFollow these preferences when they apply. Do not override explicit instructions in the current task.`;
}

/**
 * Distill non-secret facts from a completed run transcript and merge them
 * into the profile. Heuristic-based (no LLM call) so it runs cheaply on
 * every successful run.
 *
 * Inputs are scrubbed for obvious secrets before storage.
 */
export function distillProfileFromRun(input: {
	summary: string | null;
	userMessages: string[];
}): ProfileUpdate {
	const update: ProfileUpdate = {};
	const text = [input.summary ?? "", ...input.userMessages].join("\n");
	if (!text.trim()) return update;

	const preferences: string[] = [];
	const style: string[] = [];
	const context: string[] = [];

	const lines = text.split(/\r?\n/);
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.length < 12) continue;
		const lower = line.toLowerCase();
		if (
			lower.startsWith("i prefer ") ||
			lower.startsWith("i like ") ||
			lower.startsWith("i want ") ||
			lower.startsWith("i need ") ||
			lower.includes(" prefer ") ||
			lower.startsWith("always ") ||
			lower.startsWith("never ")
		) {
			preferences.push(line);
		} else if (
			lower.startsWith("we use ") ||
			lower.startsWith("our team ") ||
			lower.startsWith("the codebase ") ||
			lower.startsWith("this repo ")
		) {
			context.push(line);
		} else if (
			lower.includes("style") ||
			lower.includes("convention") ||
			lower.includes("tone")
		) {
			style.push(line);
		}
	}

	if (preferences.length > 0) update.preferences = preferences;
	if (style.length > 0) update.style = style;
	if (context.length > 0) update.context = context;
	return update;
}

export const _internal = { scrubSecrets, PROFILE_PATH };
