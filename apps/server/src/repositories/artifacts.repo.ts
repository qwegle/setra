import { and, eq } from "drizzle-orm";
/**
 * Artifacts repository — Drizzle queries for artifacts table.
 */
import { db } from "../db/client.js";
import { artifacts } from "../db/schema.js";

export async function listArtifacts(
	companyId: string | null,
	issueId?: string,
	agentSlug?: string,
) {
	const filters = [
		companyId ? eq(artifacts.companyId, companyId) : undefined,
		issueId ? eq(artifacts.issueId, issueId) : undefined,
		agentSlug ? eq(artifacts.agentSlug, agentSlug) : undefined,
	].filter((x): x is NonNullable<typeof x> => x !== undefined);

	return db
		.select()
		.from(artifacts)
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(artifacts.createdAt);
}

export interface CreateArtifactParams {
	companyId: string | null;
	name: string;
	issueId: string | null;
	agentSlug: string | null;
	mimeType: string | null;
	content: string | null;
}

export async function createArtifact(params: CreateArtifactParams) {
	const [row] = await db
		.insert(artifacts)
		.values({
			companyId: params.companyId,
			name: params.name,
			issueId: params.issueId,
			agentSlug: params.agentSlug,
			mimeType: params.mimeType,
			content: params.content,
		})
		.returning();
	return row;
}

export async function getArtifactById(id: string, companyId: string) {
	const [row] = await db
		.select()
		.from(artifacts)
		.where(and(eq(artifacts.id, id), eq(artifacts.companyId, companyId)));
	return row ?? null;
}

export async function deleteArtifact(id: string, companyId: string) {
	const [row] = await db
		.delete(artifacts)
		.where(and(eq(artifacts.id, id), eq(artifacts.companyId, companyId)))
		.returning();
	return row ?? null;
}
