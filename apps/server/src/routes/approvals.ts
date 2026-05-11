import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import { requestDispatcherTick } from "../lib/dispatcher-scheduler.js";
import * as approvalsRepo from "../repositories/approvals.repo.js";
import { emit } from "../sse/handler.js";
import {
	RejectApprovalSchema,
	ResolveApprovalSchema,
} from "../validators/approvals.validators.js";

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
	requestDispatcherTick(`approval-${id}-approved`);
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
		requestDispatcherTick(`approval-${id}-rejected`);
		return c.json(updated);
	},
);

/**
 * POST /:id/resolve - structured 4-option approval resolution.
 *
 * Body: { outcome: "approve"|"approve_with_note"|"reject"|"reject_with_steer",
 *         note?: string }
 *
 * Mirrors WUPHF's humanInterview interaction model so an operator can attach
 * binding constraints (approve_with_note) or a corrective re-prompt
 * (reject_with_steer) without leaving the approval UI. The legacy
 * /approve and /reject endpoints stay as thin compatibility shims.
 */
approvalsRoute.post(
	"/:id/resolve",
	zValidator("json", ResolveApprovalSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = await approvalsRepo.getApprovalForAction(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);
		if (existing.status !== "pending")
			return c.json({ error: "already resolved" }, 409);

		const isApprove =
			body.outcome === "approve" || body.outcome === "approve_with_note";
		const status = isApprove ? "approved" : "rejected";
		const now = new Date().toISOString();
		const updates: Record<string, unknown> = {
			status,
			resolvedAt: now,
			updatedAt: now,
		};
		if (body.note != null && body.note.trim().length > 0) {
			updates.comment = `[${body.outcome}] ${body.note}`;
		}

		const updated = await approvalsRepo.updateApproval(id, cid, updates);

		emit("review_resolved", {
			id,
			status,
			outcome: body.outcome,
			note: body.note ?? null,
			companyId: cid,
		});
		await logActivity(c, `approval.${status}`, "approval", id, {
			outcome: body.outcome,
			note: body.note ?? null,
		});
		requestDispatcherTick(`approval-${id}-${body.outcome}`);
		return c.json(updated);
	},
);
