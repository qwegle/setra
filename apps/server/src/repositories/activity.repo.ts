/**
 * Activity repository — raw SQL queries for activity_log table.
 */
import { getRawDb } from "@setra/db";

export interface ActivityLogRow {
	id: string;
	issue_id: string | null;
	project_id: string | null;
	actor: string;
	event: string;
	payload: string | null;
	created_at: string;
}

export interface PaginatedActivity {
	items: ActivityLogRow[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export function getPaginatedActivityLogs(
	companyId: string,
	page = 1,
	pageSize = 50,
	filter?: string,
): PaginatedActivity {
	const db = getRawDb();
	const offset = (page - 1) * pageSize;

	let whereClause = "WHERE company_id = ?";
	const params: unknown[] = [companyId];

	if (filter && filter !== "all") {
		if (filter === "comment") {
			whereClause += " AND (event LIKE ? OR event = ?)";
			params.push(`${filter}.%`, "comment_added");
		} else {
			whereClause += " AND event LIKE ?";
			params.push(`${filter}.%`);
		}
	}

	const countRow = db
		.prepare(`SELECT COUNT(*) as total FROM activity_log ${whereClause}`)
		.get(...params) as { total: number };

	const items = db
		.prepare(
			`SELECT id, issue_id, project_id, actor, event, payload, created_at
       FROM activity_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
		)
		.all(...params, pageSize, offset) as ActivityLogRow[];

	return {
		items,
		total: countRow.total,
		page,
		pageSize,
		totalPages: Math.ceil(countRow.total / pageSize),
	};
}

// Keep old function for backward compat
export function getRecentActivityLogs(companyId: string): ActivityLogRow[] {
	return getPaginatedActivityLogs(companyId, 1, 50).items;
}
