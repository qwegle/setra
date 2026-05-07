import { and, desc, eq } from "drizzle-orm";
/**
 * Inbox repository — raw SQL + Drizzle queries for inbox dashboard.
 */
import { db, rawSqlite } from "../db/client.js";
import { approvals, inboxAlerts } from "../db/schema.js";

export interface IssueRow {
	id: string;
	title: string;
	status: string;
	priority: string;
	projectId: string;
	assignedAgentId: string | null;
	createdAt: string;
	updatedAt: string;
}

export function getIssuesForInbox(companyId: string | null): IssueRow[] {
	const rows = (
		companyId
			? rawSqlite
					.prepare(
						`SELECT id, title, status, priority, project_id AS projectId,
                  assigned_agent_id AS assignedAgentId,
                  created_at AS createdAt, updated_at AS updatedAt
             FROM board_issues
            WHERE company_id = ?
            ORDER BY created_at DESC LIMIT 20`,
					)
					.all(companyId)
			: rawSqlite
					.prepare(
						`SELECT id, title, status, priority, project_id AS projectId,
                  assigned_agent_id AS assignedAgentId,
                  created_at AS createdAt, updated_at AS updatedAt
             FROM board_issues ORDER BY created_at DESC LIMIT 20`,
					)
					.all()
	) as IssueRow[];
	return rows;
}

export async function getPendingApprovals(companyId: string | null) {
	const where = companyId
		? and(eq(approvals.status, "pending"), eq(approvals.companyId, companyId))
		: eq(approvals.status, "pending");
	return db
		.select()
		.from(approvals)
		.where(where)
		.orderBy(desc(approvals.createdAt));
}

export async function getAlerts(companyId: string | null) {
	return db
		.select()
		.from(inboxAlerts)
		.where(companyId ? eq(inboxAlerts.companyId, companyId) : undefined)
		.orderBy(desc(inboxAlerts.createdAt))
		.limit(50);
}

export async function archiveAlert(id: string, companyId: string) {
	await db
		.update(inboxAlerts)
		.set({ read: true, updatedAt: new Date().toISOString() })
		.where(and(eq(inboxAlerts.id, id), eq(inboxAlerts.companyId, companyId)));
}
