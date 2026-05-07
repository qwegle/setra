/**
 * projects.ts — IPC handlers for project CRUD (stored in SQLite).
 *
 * Projects map to local git repositories. Each project has a unique repoPath.
 */

import { getDb, schema } from "@setra/db";
import { desc, eq } from "drizzle-orm";
import { ipcMain } from "electron";

export function registerProjectsHandlers(): void {
	// projects:list — return all projects ordered by lastActiveAt desc
	ipcMain.handle("projects:list", async () => {
		const db = getDb();
		return db
			.select()
			.from(schema.projects)
			.orderBy(desc(schema.projects.lastActiveAt))
			.all();
	});

	// projects:get — return a single project by id
	ipcMain.handle("projects:get", async (_event, id: string) => {
		const db = getDb();
		const project = db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.id, id))
			.get();
		if (!project) throw new Error(`Project not found: ${id}`);
		return project;
	});

	// projects:create — insert a new project row
	ipcMain.handle(
		"projects:create",
		async (
			_event,
			input: {
				name: string;
				repoPath: string;
				remoteUrl?: string;
				defaultBranch?: string;
			},
		) => {
			const db = getDb();
			const id = crypto.randomUUID();
			const now = new Date().toISOString();
			db.insert(schema.projects)
				.values({
					id,
					name: input.name.trim(),
					repoPath: input.repoPath.trim(),
					remoteUrl: input.remoteUrl ?? null,
					defaultBranch: input.defaultBranch ?? "main",
					lastActiveAt: now,
				})
				.run();
			return db
				.select()
				.from(schema.projects)
				.where(eq(schema.projects.id, id))
				.get();
		},
	);

	// projects:update — update name / remoteUrl / defaultBranch
	ipcMain.handle(
		"projects:update",
		async (
			_event,
			id: string,
			updates: Partial<{
				name: string;
				remoteUrl: string;
				defaultBranch: string;
			}>,
		) => {
			const db = getDb();
			db.update(schema.projects)
				.set({ ...updates, updatedAt: new Date().toISOString() })
				.where(eq(schema.projects.id, id))
				.run();
			return db
				.select()
				.from(schema.projects)
				.where(eq(schema.projects.id, id))
				.get();
		},
	);

	// projects:delete — delete a project (cascades to plots)
	ipcMain.handle("projects:delete", async (_event, id: string) => {
		const db = getDb();
		db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
		return { ok: true };
	});

	// projects:touch — update lastActiveAt (called when user selects a project)
	ipcMain.handle("projects:touch", async (_event, id: string) => {
		const db = getDb();
		db.update(schema.projects)
			.set({
				lastActiveAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(schema.projects.id, id))
			.run();
		return { ok: true };
	});
}
