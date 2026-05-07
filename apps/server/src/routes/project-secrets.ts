import { zValidator } from "@hono/zod-validator";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import * as projectsRepo from "../repositories/projects.repo.js";

export const projectSecretsRoute = new Hono();

const UpsertProjectSecretSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});

let tableReady = false;

function ensureProjectSecretsTable(): void {
	if (tableReady) return;
	getRawDb().exec(`
		CREATE TABLE IF NOT EXISTS project_secrets (
			id TEXT PRIMARY KEY,
			company_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			created_at TEXT DEFAULT (datetime('now')),
			updated_at TEXT DEFAULT (datetime('now')),
			UNIQUE(company_id, project_id, key)
		);
	`);
	tableReady = true;
}

try {
	ensureProjectSecretsTable();
} catch {
	// DB is initialised during app startup; handlers re-run table creation lazily.
}

function maskSecret(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "••••";
	return `••••••••${value.slice(-4)}`;
}

function ensureProjectExists(projectId: string, companyId: string): void {
	const project = projectsRepo.getProjectFull(projectId);
	if (!project || project.companyId !== companyId) {
		throw new Error("project not found");
	}
}

function projectSecretsStatus(message: string): 404 | 500 {
	return message === "project not found" ? 404 : 500;
}

projectSecretsRoute.get("/:projectId/secrets", (c) => {
	try {
		ensureProjectSecretsTable();
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		ensureProjectExists(projectId, companyId);
		const secrets = getRawDb()
			.prepare(
				`SELECT id, key, value, created_at AS createdAt, updated_at AS updatedAt
				 FROM project_secrets
				 WHERE company_id = ? AND project_id = ?
				 ORDER BY key ASC`,
			)
			.all(companyId, projectId) as Array<{
			id: string;
			key: string;
			value: string;
			createdAt: string;
			updatedAt: string;
		}>;

		return c.json({
			secrets: secrets.map((secret) => ({
				id: secret.id,
				key: secret.key,
				value: maskSecret(decrypt(secret.value)),
				createdAt: secret.createdAt,
				updatedAt: secret.updatedAt,
			})),
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to list project secrets";
		return c.json({ error: message }, projectSecretsStatus(message));
	}
});

projectSecretsRoute.post(
	"/:projectId/secrets",
	zValidator("json", UpsertProjectSecretSchema),
	async (c) => {
		try {
			ensureProjectSecretsTable();
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			ensureProjectExists(projectId, companyId);
			const body = c.req.valid("json");
			const rowId = crypto.randomUUID();
			getRawDb()
				.prepare(
					`INSERT INTO project_secrets (
						id, company_id, project_id, key, value, created_at, updated_at
					)
					VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
					ON CONFLICT(company_id, project_id, key)
					DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
				)
				.run(rowId, companyId, projectId, body.key, encrypt(body.value));
			await logActivity(
				c,
				"project.secret.upserted",
				"project_secret",
				body.key,
				{
					projectId,
					key: body.key,
					reason: "Project secret saved or rotated",
				},
			);
			return c.json({ ok: true });
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "failed to save project secret";
			return c.json({ error: message }, projectSecretsStatus(message));
		}
	},
);

projectSecretsRoute.delete("/:projectId/secrets/:key", async (c) => {
	try {
		ensureProjectSecretsTable();
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		ensureProjectExists(projectId, companyId);
		const key = c.req.param("key");
		const result = getRawDb()
			.prepare(
				`DELETE FROM project_secrets
				 WHERE company_id = ? AND project_id = ? AND key = ?`,
			)
			.run(companyId, projectId, key);
		if (result.changes === 0) return c.json({ error: "secret not found" }, 404);
		await logActivity(c, "project.secret.deleted", "project_secret", key, {
			projectId,
			key,
			reason: "Project secret deleted",
		});
		return c.json({ deleted: true });
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "failed to delete project secret";
		return c.json({ error: message }, projectSecretsStatus(message));
	}
});

projectSecretsRoute.get("/:projectId/secrets/env", (c) => {
	try {
		ensureProjectSecretsTable();
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		ensureProjectExists(projectId, companyId);
		const rows = getRawDb()
			.prepare(
				`SELECT key, value
				 FROM project_secrets
				 WHERE company_id = ? AND project_id = ?
				 ORDER BY key ASC`,
			)
			.all(companyId, projectId) as Array<{ key: string; value: string }>;
		return c.json({
			env: Object.fromEntries(rows.map((row) => [row.key, decrypt(row.value)])),
		});
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to load project secrets";
		return c.json({ error: message }, projectSecretsStatus(message));
	}
});
