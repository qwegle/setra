import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as approvalsRepo from "../repositories/approvals.repo.js";
import * as inboxRepo from "../repositories/inbox.repo.js";

export const inboxRoute = new Hono();

inboxRoute.get("/", async (c) => {
	const cid = getCompanyId(c);
	const tab = c.req.query("tab") ?? "all";

	const issuesList: {
		id: string;
		title: string;
		status: string;
		priority: string;
		projectId: string;
		assigneeId: string | null;
		createdAt: string;
		updatedAt: string;
	}[] = [];
	const approvalsList: approvalsRepo.ApprovalRow[] = [];
	const alertsList: {
		id: string;
		type: string;
		message: string;
		severity: string;
		createdAt: string;
	}[] = [];

	if (tab === "all" || tab === "issues") {
		const rows = inboxRepo.getIssuesForInbox(cid);
		for (const r of rows) {
			issuesList.push({
				id: r.id,
				title: r.title,
				status: r.status,
				priority: r.priority,
				projectId: r.projectId,
				assigneeId: r.assignedAgentId ?? null,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
			});
		}
	}

	if (tab === "all" || tab === "approvals") {
		const rows = await approvalsRepo.listApprovals(cid, "pending");
		approvalsList.push(...rows);
	}

	if (tab === "all" || tab === "alerts") {
		const rows = await inboxRepo.getAlerts(cid);
		for (const r of rows) {
			alertsList.push({
				id: r.id,
				type: r.type,
				message: r.message,
				severity: r.severity,
				createdAt: r.createdAt,
			});
		}
	}

	return c.json({
		issues: issuesList,
		approvals: approvalsList,
		alerts: alertsList,
	});
});

// POST /archive/:issueId — no body; archives a single inbox alert.
// Skipping zValidator because the board client invokes this method-only.
inboxRoute.post("/archive/:issueId", async (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.param("issueId");
	await inboxRepo.archiveAlert(issueId, cid);
	return c.json({ ok: true });
});
