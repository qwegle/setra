import { runs } from "@setra/db";
import { eq, gte, sql } from "drizzle-orm";
/**
 * Org repository — Drizzle queries for company members, invites, and org stats.
 */
import { db } from "../db/client.js";
import { companyInvites, companyMembers } from "../db/schema.js";

export async function listMembers(companyId: string | null) {
	return db
		.select()
		.from(companyMembers)
		.where(companyId ? eq(companyMembers.companyId, companyId) : undefined)
		.orderBy(companyMembers.joinedAt);
}

export interface OrgStats {
	totalAgentRuns: number;
	totalCostUsd: number;
	activeMembers: number;
	thisMonthCostUsd: number;
}

export async function getOrgStats(companyId: string | null): Promise<OrgStats> {
	const [totals] = await db
		.select({
			totalAgentRuns: sql<number>`count(*)`,
			totalCostUsd: sql<number>`sum(coalesce(cost_usd, 0))`,
		})
		.from(runs);

	const now = new Date();
	const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

	const [mtd] = await db
		.select({ thisMonthCostUsd: sql<number>`sum(coalesce(cost_usd, 0))` })
		.from(runs)
		.where(gte(runs.startedAt, mtdStart));

	const [memberCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(companyMembers)
		.where(companyId ? eq(companyMembers.companyId, companyId) : undefined);

	return {
		totalAgentRuns: Number(totals?.totalAgentRuns ?? 0),
		totalCostUsd: Number(totals?.totalCostUsd ?? 0),
		activeMembers: Number(memberCount?.count ?? 0),
		thisMonthCostUsd: Number(mtd?.thisMonthCostUsd ?? 0),
	};
}

export interface CreateInviteParams {
	companyId: string | null;
	email: string;
	role: string;
	expiresAt: string;
}

export async function createInvite(params: CreateInviteParams) {
	const [invite] = await db
		.insert(companyInvites)
		.values({
			id: crypto.randomUUID(),
			companyId: params.companyId,
			email: params.email,
			role: params.role,
			expiresAt: params.expiresAt,
		})
		.returning();
	return invite;
}
