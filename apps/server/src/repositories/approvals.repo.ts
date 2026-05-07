import { and, eq } from "drizzle-orm";
import { db, rawSqlite } from "../db/client.js";
import { reviewItems } from "../db/schema.js";

export interface ApprovalRow {
	id: string;
	type: string | null;
	entityType: string | null;
	entityId: string | null;
	title: string | null;
	description: string | null;
	requestedBy: string | null;
	targetIssueSlug: string | null;
	estimatedCostUsd: number | null;
	diff: string | null;
	riskLevel: string;
	status: string;
	comment: string | null;
	createdAt: string;
	resolvedAt: string | null;
	entityTitle: string | null;
	entitySlug: string | null;
	entityUrl: string | null;
}

function selectApprovalRows(
	whereSql = "",
	params: unknown[] = [],
	suffixSql = "",
): ApprovalRow[] {
	return rawSqlite
		.prepare(
			`SELECT
				ri.id,
				ri.type,
				ri.entity_type AS entityType,
				ri.entity_id AS entityId,
				ri.title,
				ri.description,
				ri.requested_by AS requestedBy,
				ri.target_issue_slug AS targetIssueSlug,
				ri.estimated_cost_usd AS estimatedCostUsd,
				ri.diff,
				ri.risk_level AS riskLevel,
				ri.status,
				ri.comment,
				ri.created_at AS createdAt,
				ri.resolved_at AS resolvedAt,
				i.title AS entityTitle,
				i.slug AS entitySlug,
				i.pr_url AS entityUrl
			FROM review_items ri
			LEFT JOIN board_issues i
				ON ri.entity_type = 'issue' AND i.id = ri.entity_id
			${whereSql}
			ORDER BY ri.created_at DESC
			${suffixSql}`,
		)
		.all(...params) as ApprovalRow[];
}

export async function listApprovals(companyId: string | null, status: string) {
	const clauses: string[] = [];
	const params: unknown[] = [];
	if (companyId) {
		clauses.push("ri.company_id = ?");
		params.push(companyId);
	}
	if (status !== "all") {
		clauses.push("ri.status = ?");
		params.push(status);
	}
	return selectApprovalRows(
		clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
		params,
	);
}

export async function getApprovalById(id: string, companyId: string) {
	const [row] = selectApprovalRows("WHERE ri.id = ? AND ri.company_id = ?", [
		id,
		companyId,
	]);
	return row ?? null;
}

export async function getApprovalForAction(id: string, companyId: string) {
	const [row] = await db
		.select({ id: reviewItems.id, status: reviewItems.status })
		.from(reviewItems)
		.where(and(eq(reviewItems.id, id), eq(reviewItems.companyId, companyId)));
	return row ?? null;
}

export async function updateApproval(
	id: string,
	companyId: string,
	updates: Partial<typeof reviewItems.$inferInsert>,
) {
	await db
		.update(reviewItems)
		.set(updates)
		.where(and(eq(reviewItems.id, id), eq(reviewItems.companyId, companyId)));
	return getApprovalById(id, companyId);
}

export async function getLatestEntityApproval(
	entityId: string,
	companyId: string,
	type: string,
	entityType = "issue",
) {
	const [row] = selectApprovalRows(
		"WHERE ri.entity_id = ? AND ri.company_id = ? AND ri.type = ? AND ri.entity_type = ?",
		[entityId, companyId, type, entityType],
		"LIMIT 1",
	);
	return row ?? null;
}

export async function createApproval(input: {
	companyId: string;
	type: string;
	requestedBy: string;
	title: string;
	description: string;
	entityType?: string | null;
	entityId?: string | null;
	targetIssueSlug?: string | null;
	estimatedCostUsd?: number | null;
	diff?: string | null;
	riskLevel?: string;
	status?: string;
	comment?: string | null;
	resolvedAt?: string | null;
}) {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	await db.insert(reviewItems).values({
		id,
		companyId: input.companyId,
		type: input.type,
		entityType: input.entityType ?? null,
		entityId: input.entityId ?? null,
		title: input.title,
		description: input.description,
		requestedBy: input.requestedBy,
		targetIssueSlug: input.targetIssueSlug ?? null,
		estimatedCostUsd: input.estimatedCostUsd ?? null,
		diff: input.diff ?? null,
		riskLevel: input.riskLevel ?? "medium",
		status: input.status ?? "pending",
		comment: input.comment ?? null,
		resolvedAt: input.resolvedAt ?? null,
		createdAt: now,
		updatedAt: now,
	});
	return getApprovalById(id, input.companyId);
}
