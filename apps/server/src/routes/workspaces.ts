import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as workspacesRepo from "../repositories/workspaces.repo.js";
import {
	CreateWorkspaceSchema,
	UpdateWorkspaceSchema,
} from "../validators/workspaces.validators.js";

export const workspacesRoute = new Hono();

workspacesRoute.get("/", async (c) => {
	const cid = getCompanyId(c);
	const rows = await workspacesRepo.listWorkspaces(cid);
	const enriched = rows.map((row) => ({
		...row,
		status: "running" as const,
		agentCount: 0,
		lastUsedAt: row.updatedAt ?? null,
	}));
	return c.json(enriched);
});

workspacesRoute.post(
	"/",
	zValidator("json", CreateWorkspaceSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");

		const row = await workspacesRepo.createWorkspace({
			companyId: body.companyId ?? cid,
			name: body.name,
			type: body.type ?? "local",
			isDefault: body.isDefault ?? false,
			config: body.config ? JSON.stringify(body.config) : "{}",
		});

		return c.json(row, 201);
	},
);

workspacesRoute.patch(
	"/:id",
	zValidator("json", UpdateWorkspaceSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = await workspacesRepo.getWorkspaceById(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);

		const updates: Record<string, unknown> = {
			updatedAt: new Date().toISOString(),
		};
		if (body.name !== undefined) updates.name = body.name;
		if (body.type !== undefined) updates.type = body.type;
		if (body.config !== undefined) updates.config = JSON.stringify(body.config);

		const updated = await workspacesRepo.updateWorkspace(id, cid, updates);
		return c.json(updated);
	},
);

workspacesRoute.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await workspacesRepo.deleteWorkspace(c.req.param("id"), cid);
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

// POST /:id/default — no body; promotes a workspace to default. zValidator
// is intentionally omitted because the board client sends no JSON body.
workspacesRoute.post("/:id/default", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const existing = await workspacesRepo.getWorkspaceById(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);

	await workspacesRepo.clearDefaultWorkspaces();
	const updated = await workspacesRepo.setAsDefault(id, cid);
	return c.json(updated);
});
