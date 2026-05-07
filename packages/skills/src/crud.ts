import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Skill, SkillInputSchema } from "./types.js";

function skillToMarkdown(
	skill: Omit<Skill, "id" | "source" | "filePath">,
): string {
	const fm: Record<string, unknown> = {
		name: skill.name,
		description: skill.description,
	};
	if (skill.aliases.length > 0) fm["aliases"] = skill.aliases;
	if (skill.modelHint) fm["modelHint"] = skill.modelHint;
	if (Object.keys(skill.inputSchema).length > 0)
		fm["inputSchema"] = skill.inputSchema;
	if (skill.tags.length > 0) fm["tags"] = skill.tags;

	return `---\n${stringifyYaml(fm).trimEnd()}\n---\n${skill.template}\n`;
}

function nameToFilename(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "") + ".md"
	);
}

export function createSkill(
	skill: Omit<Skill, "id" | "source" | "filePath">,
	dir: "global" | "project",
	projectDir?: string,
): string {
	const baseDir =
		dir === "global"
			? path.join(os.homedir(), ".setra", "skills")
			: path.join(projectDir ?? process.cwd(), ".setra", "skills");

	fs.mkdirSync(baseDir, { recursive: true });
	const filePath = path.join(baseDir, nameToFilename(skill.name));
	fs.writeFileSync(filePath, skillToMarkdown(skill), "utf-8");
	return filePath;
}

export function updateSkill(
	filePath: string,
	updates: Partial<Omit<Skill, "id" | "source" | "filePath">>,
): void {
	if (!fs.existsSync(filePath))
		throw new Error(`Skill file not found: ${filePath}`);

	const raw = fs.readFileSync(filePath, "utf-8");
	const fmMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);

	const existingFm = fmMatch
		? (parseYaml(fmMatch[1] ?? "") as Partial<Skill>)
		: {};
	const existingTemplate = fmMatch ? (fmMatch[2] ?? "").trim() : raw.trim();

	const mergedModelHint =
		updates.modelHint ?? (existingFm.modelHint as string | undefined);
	const merged: Omit<Skill, "id" | "source" | "filePath"> = {
		name: updates.name ?? (existingFm.name as string | undefined) ?? "",
		description:
			updates.description ??
			(existingFm.description as string | undefined) ??
			"",
		aliases:
			updates.aliases ?? (existingFm.aliases as string[] | undefined) ?? [],
		...(mergedModelHint !== undefined ? { modelHint: mergedModelHint } : {}),
		inputSchema:
			updates.inputSchema ??
			(existingFm.inputSchema as SkillInputSchema | undefined) ??
			{},
		tags: updates.tags ?? (existingFm.tags as string[] | undefined) ?? [],
		template: updates.template ?? existingTemplate,
	};

	fs.writeFileSync(filePath, skillToMarkdown(merged), "utf-8");
}

export function deleteSkill(filePath: string): void {
	if (!fs.existsSync(filePath))
		throw new Error(`Skill file not found: ${filePath}`);
	fs.unlinkSync(filePath);
}
