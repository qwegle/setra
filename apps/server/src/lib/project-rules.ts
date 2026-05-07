import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

export interface ProjectRule {
	glob?: string | undefined;
	content: string;
	name: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
const RULES_DIRECTORY = [".setra", "rules"] as const;

function rulesDirectoryFor(projectPath: string): string {
	return join(projectPath, ...RULES_DIRECTORY);
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isSafeRuleName(name: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(name);
}

function resolveRulePath(projectPath: string, name: string): string {
	if (!isSafeRuleName(name)) {
		throw new Error("Invalid rule name");
	}
	const baseDir = resolve(rulesDirectoryFor(projectPath));
	const filePath = resolve(baseDir, name);
	if (!filePath.startsWith(baseDir)) {
		throw new Error("Invalid rule path");
	}
	return filePath;
}

function parseInlineGlobArray(raw: string): string[] {
	const normalized = raw.trim();
	if (!normalized) return [];
	try {
		const parsed = JSON.parse(normalized.replace(/'/g, '"')) as unknown;
		return Array.isArray(parsed)
			? parsed.map((value) => String(value ?? "").trim()).filter(Boolean)
			: [];
	} catch {
		return normalized
			.replace(/^\[/, "")
			.replace(/\]$/, "")
			.split(",")
			.map((value) => value.trim().replace(/^['\"]|['\"]$/g, ""))
			.filter(Boolean);
	}
}

function parseFrontmatter(raw: string): { content: string; globs: string[] } {
	const match = raw.match(FRONTMATTER_RE);
	if (!match) {
		return { content: raw.trim(), globs: [] };
	}
	const header = match[1] ?? "";
	let globs: string[] = [];
	const inlineMatch = header.match(/^globs:\s*(\[[^\n]+\])\s*$/m);
	if (inlineMatch) {
		globs = parseInlineGlobArray(inlineMatch[1] ?? "[]");
	} else {
		const lines = header.split(/\r?\n/);
		const startIndex = lines.findIndex((line) =>
			/^globs:\s*$/.test(line.trim()),
		);
		if (startIndex >= 0) {
			for (const line of lines.slice(startIndex + 1)) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("-")) break;
				const value = trimmed
					.slice(1)
					.trim()
					.replace(/^['\"]|['\"]$/g, "");
				if (value) globs.push(value);
			}
		}
	}
	return {
		content: raw.slice(match[0].length).trim(),
		globs,
	};
}

function escapeRegex(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function expandBraces(pattern: string): string[] {
	const match = pattern.match(/\{([^{}]+)\}/);
	if (!match) return [pattern];
	const variants = (match[1] ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	if (variants.length === 0) return [pattern];
	return variants.flatMap((variant) =>
		expandBraces(pattern.replace(match[0], variant)),
	);
}

function globVariantToRegex(pattern: string): RegExp {
	let regex = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index]!;
		const next = pattern[index + 1];
		if (char === "*" && next === "*") {
			regex += ".*";
			index += 1;
			continue;
		}
		if (char === "*") {
			regex += "[^/]*";
			continue;
		}
		if (char === "?") {
			regex += "[^/]";
			continue;
		}
		regex += escapeRegex(char);
	}
	return new RegExp(`^${regex}$`);
}

function matchesGlob(pattern: string, filePath: string): boolean {
	const normalizedPattern = normalizePath(pattern);
	const normalizedPath = normalizePath(filePath);
	const candidates = normalizedPattern.includes("/")
		? [normalizedPath]
		: [basename(normalizedPath), normalizedPath];
	return expandBraces(normalizedPattern).some((variant) => {
		const regex = globVariantToRegex(variant);
		return candidates.some((candidate) => regex.test(candidate));
	});
}

function parseRuleGlobs(rule: ProjectRule): string[] {
	return String(rule.glob ?? "")
		.split(/\s*,\s*/)
		.map((value) => value.trim())
		.filter(Boolean);
}

function displayName(rule: ProjectRule): string {
	return basename(rule.name, ".md")
		.split(/[-_]+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function isGlobalRule(rule: ProjectRule): boolean {
	return rule.name === "global.md" || parseRuleGlobs(rule).length === 0;
}

export async function loadProjectRules(
	projectPath: string,
): Promise<ProjectRule[]> {
	const rulesDir = rulesDirectoryFor(projectPath);
	try {
		const entries = await readdir(rulesDir, { withFileTypes: true });
		const files = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right));
		const rules = await Promise.all(
			files.map(async (name) => {
				const filePath = join(rulesDir, name);
				const raw = await readFile(filePath, "utf8");
				const parsed = parseFrontmatter(raw);
				return {
					name,
					glob: parsed.globs.length > 0 ? parsed.globs.join(", ") : undefined,
					content: parsed.content,
				} satisfies ProjectRule;
			}),
		);
		return rules.sort((left, right) => {
			if (left.name === "global.md") return -1;
			if (right.name === "global.md") return 1;
			return left.name.localeCompare(right.name);
		});
	} catch {
		return [];
	}
}

export async function getMatchingRules(
	rules: ProjectRule[],
	filePaths: string[],
): Promise<string> {
	const normalizedPaths = filePaths
		.map((filePath) => normalizePath(filePath))
		.filter(Boolean);
	const matchingRules = rules.filter((rule) => {
		if (isGlobalRule(rule)) return true;
		const globs = parseRuleGlobs(rule);
		if (globs.length === 0 || normalizedPaths.length === 0) return false;
		return normalizedPaths.some((filePath) =>
			globs.some((pattern) => matchesGlob(pattern, filePath)),
		);
	});
	if (matchingRules.length === 0) return "";
	return [
		"## Project Rules",
		"",
		"The following rules are defined for this project:",
		"",
		...matchingRules.flatMap((rule, index) => {
			const globs = parseRuleGlobs(rule);
			const matchLabel = isGlobalRule(rule)
				? "always"
				: `matching: ${globs.join(", ")}`;
			return [
				index > 0 ? "" : null,
				`### ${displayName(rule)} (${matchLabel})`,
				rule.content.trim(),
			].filter((line): line is string => line !== null);
		}),
	].join("\n");
}

export async function writeProjectRule(
	projectPath: string,
	name: string,
	content: string,
): Promise<ProjectRule> {
	const filePath = resolveRulePath(projectPath, name);
	await mkdir(rulesDirectoryFor(projectPath), { recursive: true });
	await writeFile(filePath, `${content.trim()}\n`, "utf8");
	const rules = await loadProjectRules(projectPath);
	return (
		rules.find((rule) => rule.name === name) ?? {
			name,
			content: content.trim(),
		}
	);
}

export async function deleteProjectRule(
	projectPath: string,
	name: string,
): Promise<boolean> {
	const filePath = resolveRulePath(projectPath, name);
	try {
		await rm(filePath);
		return true;
	} catch {
		return false;
	}
}

export function relativizeRuleFilePaths(
	projectPath: string,
	filePaths: string[],
): string[] {
	return filePaths
		.map((filePath) =>
			normalizePath(relative(projectPath, resolve(projectPath, filePath))),
		)
		.filter((filePath) => filePath && !filePath.startsWith("../"));
}
