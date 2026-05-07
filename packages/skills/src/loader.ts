import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { BUILTIN_SKILLS } from "./builtins.js";
import type { Skill, SkillInputSchema } from "./types.js";

interface FrontMatter {
	name?: string;
	description?: string;
	aliases?: string[];
	modelHint?: string;
	inputSchema?: SkillInputSchema;
	tags?: string[];
}

interface CacheEntry {
	skills: Skill[];
	loadedAt: number;
}

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, CacheEntry>();

function slugify(filename: string): string {
	return path.basename(filename, ".md").toLowerCase().replace(/\s+/g, "-");
}

function parseSkillFile(
	filePath: string,
	source: "global" | "project",
): Skill | null {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
		if (!fmMatch) return null;

		const [, fmRaw, templateRaw] = fmMatch;
		const fm = parseYaml(fmRaw ?? "") as FrontMatter;

		const id = slugify(filePath);
		const skill: Skill = {
			id,
			name: fm.name ?? id,
			description: fm.description ?? "",
			aliases: fm.aliases ?? [],
			inputSchema: fm.inputSchema ?? {},
			tags: fm.tags ?? [],
			template: (templateRaw ?? "").trim(),
			source,
			filePath,
		};
		if (fm.modelHint !== undefined) {
			skill.modelHint = fm.modelHint;
		}
		return skill;
	} catch {
		return null;
	}
}

function loadFromDir(dir: string, source: "global" | "project"): Skill[] {
	if (!fs.existsSync(dir)) return [];
	const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
	return files
		.map((f) => parseSkillFile(path.join(dir, f), source))
		.filter((s): s is Skill => s !== null);
}

export function loadSkills(cwd?: string): Skill[] {
	const cacheKey = cwd ?? "__global__";
	const cached = cache.get(cacheKey);
	if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
		return cached.skills;
	}

	const globalDir = path.join(os.homedir(), ".setra", "skills");
	const projectDir = cwd ? path.join(cwd, ".setra", "skills") : null;

	const globalSkills = loadFromDir(globalDir, "global");
	const projectSkills = projectDir ? loadFromDir(projectDir, "project") : [];

	// project skills override global skills with same id, global overrides builtins
	const byId = new Map<string, Skill>();
	for (const s of BUILTIN_SKILLS) byId.set(s.id, s);
	for (const s of globalSkills) byId.set(s.id, s);
	for (const s of projectSkills) byId.set(s.id, s);

	const skills = Array.from(byId.values());
	cache.set(cacheKey, { skills, loadedAt: Date.now() });
	return skills;
}

export function loadSkillById(id: string, cwd?: string): Skill | null {
	return (
		loadSkills(cwd).find((s) => s.id === id || s.aliases.includes(id)) ?? null
	);
}
