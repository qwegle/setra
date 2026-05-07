import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBuiltinCommands } from "./builtins.js";
import type { SlashCommandEntry } from "./types.js";

interface CacheEntry {
	commands: SlashCommandEntry[];
	expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

interface ParsedFrontmatter {
	meta: Record<string, string>;
	body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
	if (!raw.startsWith("---")) return { meta: {}, body: raw };

	const lines = raw.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return { meta: {}, body: raw };

	let endIdx = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			endIdx = i;
			break;
		}
	}

	if (endIdx === -1) return { meta: {}, body: raw };

	const meta: Record<string, string> = {};
	for (let i = 1; i < endIdx; i++) {
		const line = lines[i]?.trim() ?? "";
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).trim();
		let value = line.slice(colonIdx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		meta[key] = value;
	}

	const body = lines
		.slice(endIdx + 1)
		.join("\n")
		.trim();
	return { meta, body };
}

function parseAliases(raw: string | undefined): string[] {
	if (!raw) return [];
	// Handle YAML inline array: [a, b, c]
	if (raw.startsWith("[") && raw.endsWith("]")) {
		return raw
			.slice(1, -1)
			.split(",")
			.map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
	}
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function loadCommandsFromDir(
	dir: string,
	source: "global" | "project",
): SlashCommandEntry[] {
	if (!existsSync(dir)) return [];

	let files: string[] = [];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return [];
	}

	const entries: SlashCommandEntry[] = [];
	for (const file of files) {
		try {
			const raw = readFileSync(join(dir, file), "utf-8");
			const { meta, body } = parseFrontmatter(raw);
			const name = (meta["name"] ?? file.replace(/\.md$/, "")).trim();
			if (!name) continue;

			const entry: SlashCommandEntry = {
				name,
				aliases: parseAliases(meta["aliases"]),
				description: meta["description"] ?? "",
				argumentHint:
					meta["argumentHint"] ??
					meta["argument-hint"] ??
					meta["argument_hint"] ??
					"",
				kind: "custom",
				source,
				filePath: join(dir, file),
			};

			if (body) entry.template = body;

			entries.push(entry);
		} catch {
			// skip malformed files
		}
	}
	return entries;
}

export interface BuildRegistryOptions {
	skipCache?: boolean;
}

export function buildCommandRegistry(
	cwd: string,
	opts?: BuildRegistryOptions,
): SlashCommandEntry[] {
	const now = Date.now();

	if (!opts?.skipCache) {
		const cached = cache.get(cwd);
		if (cached && cached.expiresAt > now) return cached.commands;
	}

	const globalDir = join(homedir(), ".setra", "commands");
	const projectDir = join(cwd, ".setra", "commands");

	const builtins = getBuiltinCommands();
	const globals = loadCommandsFromDir(globalDir, "global");
	const project = loadCommandsFromDir(projectDir, "project");

	const commands = [...builtins, ...globals, ...project];
	cache.set(cwd, { commands, expiresAt: now + CACHE_TTL_MS });
	return commands;
}
