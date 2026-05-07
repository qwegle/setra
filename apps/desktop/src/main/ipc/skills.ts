import {
	createSkill,
	deleteSkill,
	loadSkillById,
	loadSkills,
	renderSkill,
	updateSkill,
} from "@setra/skills";
import type { Skill } from "@setra/skills";
import { ipcMain } from "electron";

export function registerSkillsHandlers(): void {
	ipcMain.handle("skills:list", (_event, { cwd }: { cwd: string }) => {
		return loadSkills(cwd);
	});

	ipcMain.handle(
		"skills:get",
		(_event, { id, cwd }: { id: string; cwd?: string }) => {
			return loadSkillById(id, cwd);
		},
	);

	ipcMain.handle(
		"skills:create",
		(
			_event,
			{
				skill,
				scope,
				projectDir,
			}: {
				skill: Omit<Skill, "id" | "source" | "filePath">;
				scope: "global" | "project";
				projectDir?: string;
			},
		) => {
			const filePath = createSkill(skill, scope, projectDir);
			return { filePath };
		},
	);

	ipcMain.handle(
		"skills:update",
		(
			_event,
			{ filePath, updates }: { filePath: string; updates: Partial<Skill> },
		) => {
			updateSkill(filePath, updates);
		},
	);

	ipcMain.handle(
		"skills:delete",
		(_event, { filePath }: { filePath: string }) => {
			deleteSkill(filePath);
		},
	);

	ipcMain.handle(
		"skills:render",
		(
			_event,
			{
				skillId,
				args,
				cwd,
			}: { skillId: string; args: Record<string, string>; cwd?: string },
		) => {
			const skill = loadSkillById(skillId, cwd);
			if (!skill) throw new Error(`Skill not found: ${skillId}`);
			return renderSkill(skill, args);
		},
	);
}
