import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as goalsRepo from "../repositories/goals.repo.js";
import {
	CreateGoalSchema,
	UpdateGoalSchema,
} from "../validators/goals.validators.js";

export const goalsRoute = new Hono();

goalsRoute.get("/", async (c) => {
	const companyId = getCompanyId(c);
	const rows = await goalsRepo.listGoals(companyId);
	return c.json(rows);
});

goalsRoute.post("/", zValidator("json", CreateGoalSchema), async (c) => {
	const body = c.req.valid("json");

	const cid = getCompanyId(c);

	const row = await goalsRepo.createGoal({
		companyId: cid ?? null,
		title: body.title,
		description: body.description ?? null,
		status: body.status ?? "active",
		parentGoalId: body.parentGoalId ?? null,
	});

	if (!row) return c.json({ error: "insert failed" }, 500);
	await logActivity(c, "goal.created", "goal", row.id, { title: body.title });
	return c.json(row, 201);
});

goalsRoute.patch("/:id", zValidator("json", UpdateGoalSchema), async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const body = c.req.valid("json");

	const existing = await goalsRepo.getGoalById(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);

	const updates: Record<string, unknown> = {
		updatedAt: new Date().toISOString(),
	};
	if (body.title !== undefined) updates.title = body.title;
	if (body.description !== undefined) updates.description = body.description;
	if (body.status !== undefined) updates.status = body.status;
	if (body.parentGoalId !== undefined) updates.parentGoalId = body.parentGoalId;

	const updated = await goalsRepo.updateGoal(id, cid, updates);
	await logActivity(c, "goal.updated", "goal", id, updates);
	return c.json(updated);
});

goalsRoute.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await goalsRepo.deleteGoal(c.req.param("id"), cid);
	if (!row) return c.json({ error: "not found" }, 404);
	await logActivity(c, "goal.deleted", "goal", row.id);
	return c.json({ ok: true });
});

goalsRoute.post("/:id/decompose", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const existing = await goalsRepo.getGoalById(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);
	try {
		const { decomposeGoal } = await import("../lib/goal-engine.js");
		const result = await decomposeGoal(id);
		await logActivity(c, "goal.decomposed", "goal", id, result);
		return c.json(result);
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : String(error),
			},
			500,
		);
	}
});
