import { and, eq } from "drizzle-orm";
/**
 * Goals repository — Drizzle queries for goals table.
 */
import { db } from "../db/client.js";
import { goals } from "../db/schema.js";

export async function listGoals(companyId: string | null) {
	return companyId
		? db
				.select()
				.from(goals)
				.where(eq(goals.companyId, companyId))
				.orderBy(goals.createdAt)
		: db.select().from(goals).orderBy(goals.createdAt);
}

export interface CreateGoalParams {
	companyId: string | null;
	title: string;
	description: string | null;
	status: string;
	parentGoalId: string | null;
}

export async function createGoal(params: CreateGoalParams) {
	const [row] = await db
		.insert(goals)
		.values({
			companyId: params.companyId,
			title: params.title,
			description: params.description,
			status: params.status,
			parentGoalId: params.parentGoalId,
		})
		.returning();
	return row;
}

export async function getGoalById(id: string, companyId: string) {
	const [row] = await db
		.select({ id: goals.id, companyId: goals.companyId })
		.from(goals)
		.where(and(eq(goals.id, id), eq(goals.companyId, companyId)));
	return row ?? null;
}

export async function updateGoal(
	id: string,
	companyId: string,
	updates: Partial<typeof goals.$inferInsert>,
) {
	const [updated] = await db
		.update(goals)
		.set(updates)
		.where(and(eq(goals.id, id), eq(goals.companyId, companyId)))
		.returning();
	return updated;
}

export async function deleteGoal(id: string, companyId: string) {
	const [row] = await db
		.delete(goals)
		.where(and(eq(goals.id, id), eq(goals.companyId, companyId)))
		.returning();
	return row ?? null;
}
