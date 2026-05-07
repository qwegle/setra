import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import { nextCronOccurrence } from "../lib/cron.js";
import { triggerRoutineRun } from "../lib/routines-scheduler.js";
import * as routinesRepo from "../repositories/routines.repo.js";
import {
	CreateRoutineSchema,
	UpdateRoutineSchema,
} from "../validators/routines.validators.js";

export const routinesRoute = new Hono();

routinesRoute.get("/", async (c) => {
	const cid = getCompanyId(c);
	const rows = await routinesRepo.listRoutines(cid);
	return c.json(rows);
});

routinesRoute.post("/", zValidator("json", CreateRoutineSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");

	const row = await routinesRepo.createRoutine({
		companyId: cid,
		name: body.name,
		description: body.description ?? null,
		schedule: body.schedule ?? null,
		agentId: body.agentId ?? null,
		prompt: body.prompt ?? null,
		isActive: body.isActive ?? true,
		nextRunAt:
			body.isActive === false || !body.schedule
				? null
				: (nextCronOccurrence(body.schedule)?.toISOString() ?? null),
	});

	if (!row) return c.json({ error: "insert failed" }, 500);
	await logActivity(c, "routine.created", "routine", row.id, {
		name: body.name,
		agentId: body.agentId ?? null,
	});
	return c.json(row, 201);
});

routinesRoute.patch(
	"/:id",
	zValidator("json", UpdateRoutineSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = await routinesRepo.getRoutineWithAllFields(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);

		const nextSchedule = body.schedule ?? existing.schedule;
		const nextIsActive = body.isActive ?? existing.isActive;
		const updates: Record<string, unknown> = {
			updatedAt: new Date().toISOString(),
		};
		if (body.name !== undefined) updates.name = body.name;
		if (body.description !== undefined) updates.description = body.description;
		if (body.schedule !== undefined) updates.schedule = body.schedule;
		if (body.agentId !== undefined) updates.agentId = body.agentId;
		if (body.prompt !== undefined) updates.prompt = body.prompt;
		if (body.isActive !== undefined) updates.isActive = body.isActive;
		updates.nextRunAt =
			!nextIsActive || !nextSchedule
				? null
				: (nextCronOccurrence(nextSchedule)?.toISOString() ?? null);

		const updated = await routinesRepo.updateRoutine(id, cid, updates);
		await logActivity(c, "routine.updated", "routine", id, updates);
		return c.json(updated);
	},
);

routinesRoute.post("/:id/toggle", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const existing = await routinesRepo.getRoutineWithAllFields(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);

	const isActive = !existing.isActive;
	const updated = await routinesRepo.updateRoutine(id, cid, {
		isActive,
		nextRunAt:
			isActive && existing.schedule
				? (nextCronOccurrence(existing.schedule)?.toISOString() ?? null)
				: null,
		updatedAt: new Date().toISOString(),
	});
	await logActivity(c, "routine.toggled", "routine", id, { isActive });
	return c.json(updated);
});

routinesRoute.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await routinesRepo.deleteRoutine(c.req.param("id"), cid);
	if (!row) return c.json({ error: "not found" }, 404);
	await logActivity(c, "routine.deleted", "routine", row.id);
	return c.json({ ok: true });
});

routinesRoute.post("/:id/run", async (c) => {
	const cid = getCompanyId(c);
	const routineId = c.req.param("id");
	const routine = await routinesRepo.getRoutineWithAllFields(routineId, cid);
	if (!routine) return c.json({ error: "not found" }, 404);

	const created = await triggerRoutineRun(routineId, cid);
	if (!created) {
		return c.json({ error: "agent unavailable or routine misconfigured" }, 409);
	}

	await logActivity(c, "routine.executed", "routine", routineId, {
		runId: created.runId,
	});
	return c.json({ id: created.runId, routineId, status: "pending" }, 201);
});

routinesRoute.get("/:id/runs", async (c) => {
	const cid = getCompanyId(c);
	const rows = await routinesRepo.getRoutineRuns(c.req.param("id"), cid);
	return c.json(rows);
});
