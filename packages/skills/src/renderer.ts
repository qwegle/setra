import type { RenderedSkill, Skill } from "./types.js";

export function renderSkill(
	skill: Skill,
	args: Record<string, string>,
): RenderedSkill {
	// Warn about missing required params but don't throw
	for (const paramName of Object.keys(skill.inputSchema)) {
		if (
			!(paramName in args) ||
			args[paramName] === undefined ||
			args[paramName] === ""
		) {
			process.stdout.write(
				`[skills] Warning: missing arg "${paramName}" for skill "${skill.id}"\n`,
			);
		}
	}

	let prompt = skill.template;
	for (const [key, value] of Object.entries(args)) {
		prompt = prompt.replaceAll(`$${key}`, value);
	}

	const result: RenderedSkill = { prompt };
	if (skill.modelHint !== undefined) {
		result.modelHint = skill.modelHint;
	}
	return result;
}
