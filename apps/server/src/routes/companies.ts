import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { rawSqlite } from "../db/client.js";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	adoptPendingDefault,
	deleteCompanySettings,
	getCompanySettings,
} from "../lib/company-settings.js";
import * as companiesRepo from "../repositories/companies.repo.js";
import {
	CreateCompanySchema,
	UpdateCompanySchema,
} from "../validators/companies.validators.js";

// Assistant backfill removed — the assistant chat is a separate feature
// and should not appear in the agents roster.

export const companiesRoute = new Hono();

companiesRoute.get("/", async (c) => {
	const rows = await companiesRepo.listCompanies();
	return c.json(rows);
});

companiesRoute.post("/", zValidator("json", CreateCompanySchema), async (c) => {
	const body = c.req.valid("json");

	// Prevent duplicate company names
	const existing = await companiesRepo.listCompanies();
	if (
		existing.some((co) => co.name.toLowerCase() === body.name.toLowerCase())
	) {
		return c.json({ error: `Company "${body.name}" already exists` }, 409);
	}

	const row = await companiesRepo.createCompany(body);

	// First-run flow: any v1 keys that were migrated into the _pending_default
	// bucket (because no companies existed yet) get adopted onto this company.
	// No-op when there's nothing pending or this isn't the first company.
	if (row) {
		try {
			adoptPendingDefault(row.id);
		} catch {
			/* settings file may not exist */
		}
		await logActivity(c, "company.created", "company", row.id, {
			name: row.name,
		});
	}

	return c.json(row, 201);
});

companiesRoute.get("/:id", async (c) => {
	const row = await companiesRepo.getCompanyById(c.req.param("id"));
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

companiesRoute.post("/:id/logo", async (c) => {
	const id = c.req.param("id");
	const cid = getCompanyId(c);
	if (cid !== id) {
		return c.json(
			{ error: "company_required", message: "x-company-id must match :id" },
			403,
		);
	}

	const body = (await c.req.json()) as { logo?: string };
	const logo = typeof body.logo === "string" ? body.logo : "";
	if (logo && !logo.startsWith("data:image/")) {
		return c.json({ error: "Invalid image format" }, 400);
	}

	rawSqlite
		.prepare("UPDATE companies SET logo_url = ?, updated_at = ? WHERE id = ?")
		.run(logo, new Date().toISOString(), cid);
	return c.json({ ok: true });
});

companiesRoute.get("/:id/logo", async (c) => {
	const id = c.req.param("id");
	const cid = getCompanyId(c);
	if (cid !== id) {
		return c.json(
			{ error: "company_required", message: "x-company-id must match :id" },
			403,
		);
	}

	const row = rawSqlite
		.prepare("SELECT logo_url FROM companies WHERE id = ?")
		.get(cid) as { logo_url: string } | undefined;
	return c.json({ logo: row?.logo_url || "" });
});

companiesRoute.patch(
	"/:id",
	zValidator("json", UpdateCompanySchema),
	async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const existing = await companiesRepo.getCompanyById(id);
		if (!existing) return c.json({ error: "not found" }, 404);

		// Strip undefined-valued keys so the partial matches `exactOptionalPropertyTypes`.
		const updates: Partial<{
			name: string;
			goal: string;
			type: string;
			size: string;
			brandColor: string;
			logoUrl: string;
			isOfflineOnly: boolean;
		}> = {};
		if (body.name !== undefined) updates.name = body.name;
		if (body.goal !== undefined) updates.goal = body.goal;
		if (body.type !== undefined) updates.type = body.type;
		if (body.size !== undefined) updates.size = body.size;
		if (body.brandColor !== undefined) updates.brandColor = body.brandColor;
		if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl;
		if (body.isOfflineOnly !== undefined)
			updates.isOfflineOnly = body.isOfflineOnly;

		const updated = await companiesRepo.updateCompany(id, updates);
		await logActivity(c, "company.updated", "company", id, updates);
		return c.json(updated);
	},
);

// DELETE /api/companies/:id — cascades to every scoped child table and wipes
// the company's API keys from settings.json.
companiesRoute.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const exists = await companiesRepo.companyExists(id);
	if (!exists) return c.json({ error: "not found" }, 404);

	companiesRepo.cascadeDeleteCompany(id);

	// Wipe persisted API keys for this company.
	try {
		deleteCompanySettings(id);
	} catch {
		/* settings file optional */
	}

	await logActivity(c, "company.deleted", "company", id);
	return c.json({ ok: true });
});

// ─── GDPR data export ─────────────────────────────────────────────────────
// GET /api/companies/:id/export — full machine-readable dump of everything
// the platform knows about a company. The route is publicly mounted (its
// parent /api/companies is) so it enforces tenant scope itself: the
// x-company-id header MUST match :id, otherwise we'd be a one-shot
// cross-tenant data exfiltration vector.
companiesRoute.get("/:id/export", async (c) => {
	const id = c.req.param("id");
	const headerCid = c.req.header("x-company-id");
	if (!headerCid || headerCid !== id) {
		return c.json(
			{ error: "company_required", message: "x-company-id must match :id" },
			403,
		);
	}

	const company = await companiesRepo.getCompanyById(id);
	if (!company) return c.json({ error: "not found" }, 404);

	const projects = companiesRepo.exportCompanyProjects(id);
	const issues = companiesRepo.exportCompanyIssues(id);
	const goalsRows = companiesRepo.exportCompanyGoals(id);
	const routinesRows = companiesRepo.exportCompanyRoutines(id);
	const wikiRows = companiesRepo.exportCompanyWiki(id);
	const skillsRows = companiesRepo.exportCompanySkills(id);
	const integrationsRows = (
		companiesRepo.exportCompanyIntegrations(id) as Array<
			Record<string, unknown>
		>
	).map((r) => {
		// Strip secret-bearing fields. Keep metadata so the export remains useful.
		const { config_json, ...rest } = r;
		let cfg: Record<string, unknown> = {};
		try {
			cfg = JSON.parse(typeof config_json === "string" ? config_json : "{}");
		} catch {
			/* keep empty */
		}
		const SECRET_KEYS = new Set([
			"secret_value",
			"token",
			"api_key",
			"password",
			"client_secret",
		]);
		const sanitized: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(cfg)) {
			sanitized[k] = SECRET_KEYS.has(k) ? null : v;
		}
		return { ...rest, config: sanitized };
	});
	const approvalsRows = companiesRepo.exportCompanyApprovals(id);
	const activityLogRows = companiesRepo.exportCompanyActivityLog(id);
	const runsRows = companiesRepo.exportCompanyRuns(id);

	// Settings — strip every plaintext API key but keep model/budget/governance.
	const settingsRaw = (() => {
		try {
			return getCompanySettings(id);
		} catch {
			return {};
		}
	})();
	const SECRET_FIELDS = new Set([
		"anthropic_api_key",
		"openai_api_key",
		"openrouter_api_key",
		"groq_api_key",
		"gemini_api_key",
		"together_api_key",
		"tavily_api_key",
		"brave_api_key",
		"serper_api_key",
	]);
	const settings: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(settingsRaw)) {
		if (!SECRET_FIELDS.has(k)) settings[k] = v;
	}

	const slug =
		(company.name ?? "company")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "company";
	const date = new Date().toISOString().slice(0, 10);

	c.header(
		"Content-Disposition",
		`attachment; filename="${slug}-export-${date}.json"`,
	);
	return c.json({
		company,
		projects,
		issues,
		runs: runsRows,
		goals: goalsRows,
		routines: routinesRows,
		wiki: wikiRows,
		skills: skillsRows,
		integrations: integrationsRows,
		approvals: approvalsRows,
		activity_log: activityLogRows,
		settings,
	});
});
