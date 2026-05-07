import * as crypto from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";

export const environmentsRoute = new Hono();

const CreateEnvironmentSchema = z.object({
	name: z.string().min(1),
	type: z.enum(["local", "ssh", "docker"]),
	host: z.string().optional(),
	port: z.number().int().default(22),
	username: z.string().optional(),
	authType: z.enum(["key", "password", "agent"]).optional(),
	keyPath: z.string().optional(),
	secretRef: z.string().optional(),
	projectId: z.string().optional(),
	dockerImage: z.string().optional(),
	dockerNetwork: z.string().optional(),
	notes: z.string().optional(),
});

const UpdateEnvironmentSchema = CreateEnvironmentSchema.partial();

const environmentColumns = {
	name: "name",
	type: "ground_type",
	host: "host",
	port: "port",
	username: "username",
	authType: "auth_type",
	keyPath: "key_path",
	secretRef: "secret_ref",
	projectId: "project_id",
	dockerImage: "docker_image",
	dockerNetwork: "docker_network",
	notes: "notes",
} satisfies Record<string, string>;

environmentsRoute.get("/", (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.query("projectId");

	let sql = "SELECT * FROM grounds WHERE company_id = ?";
	const params: any[] = [cid];

	if (projectId) {
		sql += " AND (project_id = ? OR project_id IS NULL)";
		params.push(projectId);
	}

	sql += " ORDER BY CASE WHEN project_id IS NULL THEN 0 ELSE 1 END, name ASC";

	const rows = getRawDb()
		.prepare(sql)
		.all(...params);
	return c.json(rows);
});

environmentsRoute.post(
	"/",
	zValidator("json", CreateEnvironmentSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const id = crypto.randomUUID();

		getRawDb()
			.prepare(
				`INSERT INTO grounds (
          id,
          name,
          ground_type,
          host,
          port,
          username,
          auth_type,
          key_path,
          secret_ref,
          company_id,
          project_id,
          docker_image,
          docker_network,
          notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				body.name,
				body.type,
				body.host ?? "localhost",
				body.port,
				body.username ?? "",
				body.authType ?? "agent",
				body.keyPath ?? null,
				body.secretRef ?? null,
				cid,
				body.projectId ?? null,
				body.dockerImage ?? null,
				body.dockerNetwork ?? null,
				body.notes ?? null,
			);

		await logActivity(c, "environment.created", "environment", id, {
			name: body.name,
			type: body.type,
			projectId: body.projectId ?? null,
		});

		const row = getRawDb()
			.prepare("SELECT * FROM grounds WHERE id = ? AND company_id = ?")
			.get(id, cid);
		return c.json(row, 201);
	},
);

environmentsRoute.patch(
	"/:id",
	zValidator("json", UpdateEnvironmentSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const fields: string[] = [];
		const values: unknown[] = [];

		for (const [key, value] of Object.entries(body)) {
			if (value === undefined) continue;
			const column = environmentColumns[key as keyof typeof environmentColumns];
			if (!column) continue;
			fields.push(`${column} = ?`);
			values.push(value);
		}

		if (fields.length === 0) {
			return c.json({ error: "no fields" }, 400);
		}

		values.push(id, cid);
		getRawDb()
			.prepare(
				`UPDATE grounds
         SET ${fields.join(", ")}, updated_at = datetime('now')
         WHERE id = ? AND company_id = ?`,
			)
			.run(...values);

		const row = getRawDb()
			.prepare("SELECT * FROM grounds WHERE id = ? AND company_id = ?")
			.get(id, cid);
		if (!row) return c.json({ error: "not found" }, 404);

		await logActivity(c, "environment.updated", "environment", id, body);
		return c.json(row);
	},
);

environmentsRoute.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const result = getRawDb()
		.prepare("DELETE FROM grounds WHERE id = ? AND company_id = ?")
		.run(id, cid);
	if (result.changes === 0) return c.json({ error: "not found" }, 404);
	await logActivity(c, "environment.deleted", "environment", id);
	return c.json({ ok: true });
});
