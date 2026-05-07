import { and, eq } from "drizzle-orm";
/**
 * Review repository — Drizzle queries for review_items table.
 */
import { db } from "../db/client.js";
import { reviewItems } from "../db/schema.js";

export async function listReviewItems(
	companyId: string | null,
	status?: string,
) {
	const filters = [
		companyId ? eq(reviewItems.companyId, companyId) : undefined,
		status ? eq(reviewItems.status, status) : undefined,
	].filter((x): x is NonNullable<typeof x> => x !== undefined);

	return db
		.select()
		.from(reviewItems)
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(reviewItems.createdAt);
}

export interface CreateReviewItemParams {
	companyId: string | null;
	type: string | null;
	title: string | null;
	status: string;
}

export async function createReviewItem(params: CreateReviewItemParams) {
	const [row] = await db
		.insert(reviewItems)
		.values({
			companyId: params.companyId,
			type: params.type,
			title: params.title,
			status: params.status,
		})
		.returning();
	return row;
}

export async function getReviewItemById(id: string, companyId: string) {
	const [row] = await db
		.select()
		.from(reviewItems)
		.where(and(eq(reviewItems.id, id), eq(reviewItems.companyId, companyId)));
	return row ?? null;
}

export async function updateReviewItem(
	id: string,
	companyId: string,
	updates: Partial<typeof reviewItems.$inferInsert>,
) {
	const [updated] = await db
		.update(reviewItems)
		.set(updates)
		.where(and(eq(reviewItems.id, id), eq(reviewItems.companyId, companyId)))
		.returning();
	return updated;
}
