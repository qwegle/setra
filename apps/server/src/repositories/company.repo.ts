/**
 * company.repo.ts — Repository for companySettings, companyMembers, companyInvites
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
	companyInvites,
	companyMembers,
	companySettings,
} from "../db/schema.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CompanySettings = typeof companySettings.$inferSelect;
export type CompanyMember = typeof companyMembers.$inferSelect;
export type CompanyInvite = typeof companyInvites.$inferSelect;

// ─── Company Settings ─────────────────────────────────────────────────────────

export async function getSettings(
	companyId: string,
): Promise<CompanySettings | null> {
	const rows = await db
		.select()
		.from(companySettings)
		.where(eq(companySettings.id, companyId))
		.limit(1);
	return rows[0] ?? null;
}

export async function updateSettings(
	companyId: string,
	updates: Partial<typeof companySettings.$inferInsert>,
): Promise<CompanySettings> {
	const existing = await db
		.select({ id: companySettings.id })
		.from(companySettings)
		.where(eq(companySettings.id, companyId))
		.limit(1);
	const now = new Date().toISOString();

	const patchedUpdates = { ...updates, updatedAt: now };

	if (existing.length > 0) {
		const [updated] = await db
			.update(companySettings)
			.set(patchedUpdates)
			.where(eq(companySettings.id, companyId))
			.returning();
		return updated!;
	}

	const [created] = await db
		.insert(companySettings)
		.values({
			id: companyId,
			...patchedUpdates,
		} as typeof companySettings.$inferInsert)
		.returning();
	return created!;
}

// ─── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(companyId: string): Promise<CompanyMember[]> {
	return db
		.select()
		.from(companyMembers)
		.where(eq(companyMembers.companyId, companyId))
		.orderBy(companyMembers.joinedAt);
}

export async function getMemberById(
	id: string,
	companyId: string,
): Promise<CompanyMember | undefined> {
	const [row] = await db
		.select()
		.from(companyMembers)
		.where(
			and(eq(companyMembers.id, id), eq(companyMembers.companyId, companyId)),
		);
	return row;
}

export async function updateMemberRole(
	id: string,
	companyId: string,
	role: string,
): Promise<CompanyMember | undefined> {
	const [updated] = await db
		.update(companyMembers)
		.set({ role })
		.where(
			and(eq(companyMembers.id, id), eq(companyMembers.companyId, companyId)),
		)
		.returning();
	return updated;
}

export async function deleteMember(
	id: string,
	companyId: string,
): Promise<boolean> {
	const [row] = await db
		.delete(companyMembers)
		.where(
			and(eq(companyMembers.id, id), eq(companyMembers.companyId, companyId)),
		)
		.returning();
	return !!row;
}

// ─── Invites ──────────────────────────────────────────────────────────────────

export async function listInvites(companyId: string): Promise<CompanyInvite[]> {
	return db
		.select()
		.from(companyInvites)
		.where(eq(companyInvites.companyId, companyId))
		.orderBy(companyInvites.sentAt);
}

export async function getInviteById(
	id: string,
	companyId: string,
): Promise<CompanyInvite | undefined> {
	const [row] = await db
		.select()
		.from(companyInvites)
		.where(
			and(eq(companyInvites.id, id), eq(companyInvites.companyId, companyId)),
		);
	return row;
}

export async function createInvite(
	email: string,
	companyId: string,
	role?: string,
): Promise<CompanyInvite> {
	const expiresAt = new Date(
		Date.now() + 7 * 24 * 60 * 60 * 1000,
	).toISOString();
	const [row] = await db
		.insert(companyInvites)
		.values({
			email,
			companyId,
			role: role ?? "member",
			status: "pending",
			expiresAt,
		})
		.returning();
	return row!;
}

export async function deleteInvite(
	id: string,
	companyId: string,
): Promise<boolean> {
	const [row] = await db
		.delete(companyInvites)
		.where(
			and(eq(companyInvites.id, id), eq(companyInvites.companyId, companyId)),
		)
		.returning();
	return !!row;
}

export async function resendInvite(
	id: string,
	companyId: string,
): Promise<CompanyInvite | undefined> {
	const expiresAt = new Date(
		Date.now() + 7 * 24 * 60 * 60 * 1000,
	).toISOString();
	const sentAt = new Date().toISOString();
	const [updated] = await db
		.update(companyInvites)
		.set({ status: "pending", sentAt, expiresAt })
		.where(
			and(eq(companyInvites.id, id), eq(companyInvites.companyId, companyId)),
		)
		.returning();
	return updated ?? undefined;
}
