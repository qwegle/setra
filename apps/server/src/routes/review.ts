import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as reviewRepo from "../repositories/review.repo.js";
import { emit } from "../sse/handler.js";
import {
	CreateReviewItemSchema,
	UpdateReviewItemSchema,
} from "../validators/review.validators.js";

const app = new Hono();

app.get("/", async (c) => {
	const cid = getCompanyId(c);
	const status = c.req.query("status");

	const rows = await reviewRepo.listReviewItems(cid, status);
	return c.json(rows);
});

app.post("/", zValidator("json", CreateReviewItemSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");

	const row = await reviewRepo.createReviewItem({
		companyId: cid,
		type: body.type ?? null,
		title: body.title ?? null,
		status: "pending",
	});

	if (!row) return c.json({ error: "insert failed" }, 500);
	emit("review_requested", { id: row.id, type: row.type, title: row.title });
	return c.json(row, 201);
});

app.patch("/:id", zValidator("json", UpdateReviewItemSchema), async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const body = c.req.valid("json");

	const existing = await reviewRepo.getReviewItemById(id, cid);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const updates: Record<string, unknown> = {
		updatedAt: new Date().toISOString(),
	};
	if (body.status !== undefined) updates.status = body.status;
	if (body.comment !== undefined) updates.comment = body.comment;
	if (body.status && body.status !== "pending") {
		updates.resolvedAt = new Date().toISOString();
	}

	const updated = await reviewRepo.updateReviewItem(id, cid, updates);
	emit("review_resolved", { id, status: updated?.status });
	return c.json(updated);
});

export default app;
