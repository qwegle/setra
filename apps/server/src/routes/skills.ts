import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as skillsRepo from "../repositories/skills.repo.js";
import {
	CreateSkillSchema,
	UpdateSkillSchema,
} from "../validators/skills.validators.js";

const app = new Hono();

app.get("/", async (c) => {
	const cid = getCompanyId(c);
	const pageRaw = Number(c.req.query("page") ?? 1);
	const pageSizeRaw = Number(c.req.query("pageSize") ?? 20);
	const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
	const pageSize = Number.isFinite(pageSizeRaw)
		? Math.min(100, Math.max(1, Math.trunc(pageSizeRaw)))
		: 20;
	const search = c.req.query("search") ?? "";
	const category = c.req.query("category") ?? "all";

	const rows = await skillsRepo.listSkillsPaginated(cid, {
		page,
		pageSize,
		search,
		category,
	});
	const totalPages = Math.max(1, Math.ceil(rows.total / pageSize));
	return c.json({
		items: rows.items,
		total: rows.total,
		page,
		pageSize,
		totalPages,
	});
});

app.get("/library", async (c) => {
	const cid = getCompanyId(c);
	const rows = await skillsRepo.listSkillsWithGlobal(cid);
	return c.json(rows);
});

app.get("/recommended", async (c) => {
	const cid = getCompanyId(c);
	const role = c.req.query("role") ?? "developer";
	const limitRaw = Number(c.req.query("limit") ?? 20);
	const limit = Number.isFinite(limitRaw)
		? Math.max(1, Math.min(100, Math.trunc(limitRaw)))
		: 20;
	const rows = await skillsRepo.listRecommendedSkills(cid, role, limit);
	return c.json(rows);
});

app.post("/", zValidator("json", CreateSkillSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");

	const slug =
		body.slug ??
		body.name
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");

	const row = await skillsRepo.createSkill({
		companyId: cid,
		name: body.name,
		slug,
		description: body.description ?? null,
		category: body.category ?? null,
		trigger: body.trigger ?? null,
		prompt: body.prompt ?? null,
		isActive: body.isActive ?? true,
	});

	if (!row) return c.json({ error: "insert failed" }, 500);
	await logActivity(c, "skill.created", "skill", row.id, { name: body.name });
	return c.json(row, 201);
});

app.patch("/:id", zValidator("json", UpdateSkillSchema), async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const body = c.req.valid("json");

	const existing = await skillsRepo.getSkillById(id, cid);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const updates: Record<string, unknown> = {
		updatedAt: new Date().toISOString(),
	};
	if (body.name !== undefined) updates.name = body.name;
	if (body.slug !== undefined) updates.slug = body.slug;
	if (body.description !== undefined) updates.description = body.description;
	if (body.category !== undefined) updates.category = body.category;
	if (body.trigger !== undefined) updates.trigger = body.trigger;
	if (body.prompt !== undefined) updates.prompt = body.prompt;
	if (body.isActive !== undefined) updates.isActive = body.isActive;

	const updated = await skillsRepo.updateSkill(id, cid, updates);
	await logActivity(c, "skill.updated", "skill", id, updates);
	return c.json(updated);
});

app.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const row = await skillsRepo.deleteSkill(id, cid);
	if (!row) return c.json({ error: "Not found" }, 404);
	await logActivity(c, "skill.deleted", "skill", id);
	return c.json({ ok: true });
});

export default app;
