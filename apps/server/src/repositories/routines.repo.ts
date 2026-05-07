import { and, eq } from "drizzle-orm";
/**
 * Routines repository — Drizzle queries for routines table.
 */
import { db } from "../db/client.js";
import { agentRoster, routineRuns, routines } from "../db/schema.js";

export interface RoutineRow {
	id: string;
	companyId: string | null;
	name: string;
	description: string | null;
	schedule: string | null;
	agentId: string | null;
	agentName: string | null;
	prompt: string | null;
	isActive: boolean;
	lastTriggeredAt: string | null;
	nextRunAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export async function listRoutines(
	companyId: string | null,
): Promise<RoutineRow[]> {
	return db
		.select({
			id: routines.id,
			companyId: routines.companyId,
			name: routines.name,
			description: routines.description,
			schedule: routines.schedule,
			agentId: routines.agentId,
			agentName: agentRoster.displayName,
			prompt: routines.prompt,
			isActive: routines.isActive,
			lastTriggeredAt: routines.lastTriggeredAt,
			nextRunAt: routines.nextRunAt,
			createdAt: routines.createdAt,
			updatedAt: routines.updatedAt,
		})
		.from(routines)
		.leftJoin(agentRoster, eq(agentRoster.id, routines.agentId))
		.where(companyId ? eq(routines.companyId, companyId) : undefined)
		.orderBy(routines.createdAt);
}

export interface CreateRoutineParams {
	companyId: string | null;
	name: string;
	description: string | null;
	schedule: string | null;
	agentId: string | null;
	prompt: string | null;
	isActive: boolean;
	nextRunAt?: string | null;
}

export async function createRoutine(params: CreateRoutineParams) {
	const [row] = await db
		.insert(routines)
		.values({
			companyId: params.companyId,
			name: params.name,
			description: params.description,
			schedule: params.schedule,
			agentId: params.agentId,
			prompt: params.prompt,
			isActive: params.isActive,
			nextRunAt: params.nextRunAt ?? null,
		})
		.returning();
	return row;
}

export async function getRoutineById(id: string, companyId: string) {
	const [row] = await db
		.select({
			id: routines.id,
			companyId: routines.companyId,
			isActive: routines.isActive,
		})
		.from(routines)
		.where(and(eq(routines.id, id), eq(routines.companyId, companyId)));
	return row ?? null;
}

export async function getRoutineWithAllFields(id: string, companyId: string) {
	const [row] = await db
		.select()
		.from(routines)
		.where(and(eq(routines.id, id), eq(routines.companyId, companyId)));
	return row ?? null;
}

export async function updateRoutine(
	id: string,
	companyId: string,
	updates: Partial<typeof routines.$inferInsert>,
) {
	const [updated] = await db
		.update(routines)
		.set(updates)
		.where(and(eq(routines.id, id), eq(routines.companyId, companyId)))
		.returning();
	return updated;
}

export async function deleteRoutine(id: string, companyId: string) {
	const [row] = await db
		.delete(routines)
		.where(and(eq(routines.id, id), eq(routines.companyId, companyId)))
		.returning();
	return row ?? null;
}

export async function createRoutineRun(
	routineId: string,
	status: string,
	startedAt: string,
	createdAt: string,
) {
	const [run] = await db
		.insert(routineRuns)
		.values({
			routineId,
			status,
			startedAt,
			createdAt,
		})
		.returning();
	return run;
}

// routine_runs inherits company_id via parent routines — validate via JOIN
export async function getRoutineRuns(routineId: string, companyId: string) {
	return db
		.select({
			id: routineRuns.id,
			routineId: routineRuns.routineId,
			status: routineRuns.status,
			startedAt: routineRuns.startedAt,
			completedAt: routineRuns.completedAt,
			createdAt: routineRuns.createdAt,
		})
		.from(routineRuns)
		.innerJoin(routines, eq(routines.id, routineRuns.routineId))
		.where(
			and(
				eq(routineRuns.routineId, routineId),
				eq(routines.companyId, companyId),
			),
		)
		.orderBy(routineRuns.startedAt);
}
