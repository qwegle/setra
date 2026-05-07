export type SlashCommandKind = "builtin" | "custom" | "skill";
export type SlashCommandSource = "builtin" | "global" | "project";
export type SlashCommandActionType =
	| "new_session"
	| "stop_run"
	| "set_model"
	| "show_mcp"
	| "show_skills"
	| "show_instances"
	| "allow_all"
	| "deny_all"
	| "show_cost"
	| "compact";

export interface SlashCommandAction {
	type: SlashCommandActionType;
	passArguments?: boolean;
}

export interface SlashCommandEntry {
	name: string;
	aliases: string[];
	description: string;
	argumentHint: string;
	kind: SlashCommandKind;
	source: SlashCommandSource;
	action?: SlashCommandAction;
	template?: string;
	filePath?: string;
}

export interface ResolvedCommand {
	handled: boolean;
	commandName?: string;
	prompt?: string;
	action?: { type: SlashCommandActionType; argument?: string };
}
