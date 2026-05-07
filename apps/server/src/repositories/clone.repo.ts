/**
 * clone.repo.ts — Repository for clone profile, Q&A sessions, observations
 */

import { cloneObservations, cloneProfile, cloneQaSessions } from "@setra/db";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CloneProfile = typeof cloneProfile.$inferSelect;
export type CloneQaSession = typeof cloneQaSessions.$inferSelect;
export type CloneObservation = typeof cloneObservations.$inferSelect;

// ─── Clone Profile ────────────────────────────────────────────────────────────

export async function getOrCreateClone(
	companyId: string,
): Promise<CloneProfile> {
	const [existing] = await db
		.select()
		.from(cloneProfile)
		.where(eq(cloneProfile.companyId, companyId))
		.limit(1);
	if (existing) return existing;

	const [created] = await db
		.insert(cloneProfile)
		.values({
			id: crypto.randomUUID(),
			companyId,
			name: "My Clone",
			mode: "training",
		})
		.returning();
	return created!;
}

export async function updateCloneMode(
	cloneId: string,
	companyId: string,
	mode: "training" | "locked",
): Promise<CloneProfile | undefined> {
	const [updated] = await db
		.update(cloneProfile)
		.set({
			mode,
			lockedAt: mode === "locked" ? new Date().toISOString() : null,
		})
		.where(
			and(eq(cloneProfile.id, cloneId), eq(cloneProfile.companyId, companyId)),
		)
		.returning();
	return updated;
}

// ─── Q&A Sessions ─────────────────────────────────────────────────────────────

export async function listQaSessions(
	cloneId: string,
): Promise<CloneQaSession[]> {
	return db
		.select()
		.from(cloneQaSessions)
		.where(eq(cloneQaSessions.cloneId, cloneId))
		.limit(20);
}

export async function createStarterQuestions(
	cloneId: string,
): Promise<CloneQaSession[]> {
	const starters = [
		{
			question:
				"How do you prefer agents to handle blockers — push through, ask for help, or stop and wait?",
			aspect: "style",
		},
		{
			question:
				"What's your risk tolerance when an agent wants to make an irreversible change (e.g. delete a branch)?",
			aspect: "risk",
		},
		{
			question:
				"When you're not around, should agents prioritise speed or caution?",
			aspect: "priority",
		},
		{
			question:
				"What domains are you most expert in? Where do you want agents to defer to you?",
			aspect: "domain",
		},
		{
			question:
				"How should agents communicate with each other — brief and terse, or detailed and verbose?",
			aspect: "style",
		},
	];
	const inserted = await Promise.all(
		starters.map((s) =>
			db
				.insert(cloneQaSessions)
				.values({
					id: crypto.randomUUID(),
					cloneId,
					question: s.question,
					aspect: s.aspect,
				})
				.returning(),
		),
	);
	return inserted.flat();
}

export async function answerQaSession(
	sessionId: string,
	cloneId: string,
	answer: string,
): Promise<CloneQaSession | undefined> {
	const [updated] = await db
		.update(cloneQaSessions)
		.set({ answer, answeredAt: new Date().toISOString() })
		.where(
			and(
				eq(cloneQaSessions.id, sessionId),
				eq(cloneQaSessions.cloneId, cloneId),
			),
		)
		.returning();
	return updated;
}

// ─── Observations ─────────────────────────────────────────────────────────────

export async function listObservations(
	cloneId: string,
): Promise<CloneObservation[]> {
	return db
		.select()
		.from(cloneObservations)
		.where(eq(cloneObservations.cloneId, cloneId))
		.orderBy(cloneObservations.createdAt)
		.limit(50);
}
