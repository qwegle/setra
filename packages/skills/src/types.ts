export interface SkillInputSchema {
	[paramName: string]: string;
}

export interface Skill {
	id: string;
	name: string;
	description: string;
	aliases: string[];
	modelHint?: string;
	inputSchema: SkillInputSchema;
	tags: string[];
	template: string;
	source: "global" | "project" | "builtin";
	filePath?: string;
}

export interface SkillInvocation {
	skillId: string;
	args: Record<string, string>;
}

export interface RenderedSkill {
	prompt: string;
	modelHint?: string;
}
