import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCommandRegistry, resolveSlashCommand } from "@setra/commands";
import type { ResolvedCommand, SlashCommandEntry } from "@setra/commands";
import { ipcMain } from "electron";

export function registerCommandsHandlers(): void {
	// List all commands (builtins + global + project-local) for a given cwd
	ipcMain.handle("commands:list", (_e, cwd: string): SlashCommandEntry[] => {
		return buildCommandRegistry(cwd);
	});

	// Resolve a slash command string like "/review src/" to a ResolvedCommand
	ipcMain.handle("commands:resolve", (_e, input: unknown): ResolvedCommand => {
		const { text, cwd } = input as { text: string; cwd: string };
		return resolveSlashCommand(text, cwd);
	});

	// Create a custom command file in .setra/commands/<name>.md (project) or
	// ~/.setra/commands/<name>.md (global when no projectDir provided)
	ipcMain.handle("commands:createCustom", (_e, input: unknown): void => {
		const { name, description, template, projectDir } = input as {
			name: string;
			description: string;
			template: string;
			projectDir?: string;
		};

		const baseDir = projectDir
			? join(projectDir, ".setra", "commands")
			: join(
					process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~",
					".setra",
					"commands",
				);

		mkdirSync(baseDir, { recursive: true });

		const content = [
			"---",
			`name: ${name}`,
			`description: ${description}`,
			"aliases: []",
			'argumentHint: ""',
			"---",
			template,
		].join("\n");

		writeFileSync(join(baseDir, `${name}.md`), content, "utf-8");

		// Bust cache for affected directory
		buildCommandRegistry(projectDir ?? baseDir, { skipCache: true });
	});

	// Delete a custom command file by absolute path
	ipcMain.handle("commands:deleteCustom", (_e, input: unknown): void => {
		const { filePath } = input as { filePath: string };
		unlinkSync(filePath);
	});
}
