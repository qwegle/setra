import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as approvalsRepo from "../repositories/approvals.repo.js";
import { emit } from "../sse/handler.js";
import { RejectApprovalSchema } from "../validators/approvals.validators.js";

export const approvalsRoute = new Hono();

approvalsRoute.get("/", async (c) => {
	const cid = getCompanyId(c);
	const status = c.req.query("status") ?? "pending";
	const rows = await approvalsRepo.listApprovals(cid, status);
	return c.json(rows);
});

approvalsRoute.get("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await approvalsRepo.getApprovalById(c.req.param("id"), cid);
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

// POST /:id/approve — no body; clients invoke this method-only.
// Skipping zValidator.
approvalsRoute.post("/:id/approve", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const existing = await approvalsRepo.getApprovalForAction(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);
	if (existing.status !== "pending")
		return c.json({ error: "already resolved" }, 409);

	const updated = await approvalsRepo.updateApproval(id, cid, {
		status: "approved",
		resolvedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	emit("review_resolved", { id, status: "approved", companyId: cid });
	await logActivity(c, "approval.approved", "approval", id);
	return c.json(updated);
});

approvalsRoute.post(
	"/:id/reject",
	zValidator("json", RejectApprovalSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = await approvalsRepo.getApprovalForAction(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);
		if (existing.status !== "pending")
			return c.json({ error: "already resolved" }, 409);

		const updates: Record<string, unknown> = {
			status: "rejected",
			resolvedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		if (body.reason != null) updates.comment = body.reason;

		const updated = await approvalsRepo.updateApproval(id, cid, updates);

		emit("review_resolved", { id, status: "rejected", companyId: cid });
		await logActivity(c, "approval.rejected", "approval", id, {
			reason: body.reason,
		});
		return c.json(updated);
	},
);
