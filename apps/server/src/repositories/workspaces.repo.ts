import { and, eq } from "drizzle-orm";
/**
 * Workspaces repository — Drizzle queries for workspaces table.
 */
import { db } from "../db/client.js";
import { workspaces } from "../db/schema.js";

export async function listWorkspaces(companyId: string | null) {
	return db
		.select()
		.from(workspaces)
		.where(companyId ? eq(workspaces.companyId, companyId) : undefined)
		.orderBy(workspaces.createdAt);
}

export interface CreateWorkspaceParams {
	companyId: string | null;
	name: string;
	type: string;
	isDefault: boolean;
	config: string;
}

export async function createWorkspace(params: CreateWorkspaceParams) {
	const [row] = await db
		.insert(workspaces)
		.values({
			companyId: params.companyId,
			name: params.name,
			type: params.type,
			isDefault: params.isDefault,
			config: params.config,
		})
		.returning();
	return row;
}

export async function getWorkspaceById(id: string, companyId: string) {
	const [row] = await db
		.select({ id: workspaces.id, companyId: workspaces.companyId })
		.from(workspaces)
		.where(and(eq(workspaces.id, id), eq(workspaces.companyId, companyId)));
	return row ?? null;
}

export async function updateWorkspace(
	id: string,
	companyId: string,
	updates: Partial<typeof workspaces.$inferInsert>,
) {
	const [updated] = await db
		.update(workspaces)
		.set(updates)
		.where(and(eq(workspaces.id, id), eq(workspaces.companyId, companyId)))
		.returning();
	return updated;
}

export async function deleteWorkspace(id: string, companyId: string) {
	const [row] = await db
		.delete(workspaces)
		.where(and(eq(workspaces.id, id), eq(workspaces.companyId, companyId)))
		.returning();
	return row ?? null;
}

export async function clearDefaultWorkspaces() {
	await db
		.update(workspaces)
		.set({ isDefault: false })
		.where(eq(workspaces.isDefault, true));
}

export async function setAsDefault(id: string, companyId: string) {
	const [updated] = await db
		.update(workspaces)
		.set({ isDefault: true, updatedAt: new Date().toISOString() })
		.where(and(eq(workspaces.id, id), eq(workspaces.companyId, companyId)))
		.returning();
	return updated;
}
