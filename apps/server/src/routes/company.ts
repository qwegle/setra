import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import {
	getCompanySettings as getStoreSettings,
	setCompanySettings as setStoreSettings,
} from "../lib/company-settings.js";
import * as companyRepo from "../repositories/company.repo.js";
import {
	CreateInviteSchema,
	UpdateCompanySettingsSchema,
	UpdateMemberRoleSchema,
} from "../validators/company.validators.js";

export const companyRoute = new Hono();

// ─── Settings ─────────────────────────────────────────────────────────────────

function readEnvVars(cid: string | null | undefined): Record<string, string> {
	const s = getStoreSettings(cid) as Record<string, unknown>;
	const raw = s["env_vars"];
	if (typeof raw === "string" && raw.trim().length > 0) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const out: Record<string, string> = {};
				for (const [k, v] of Object.entries(
					parsed as Record<string, unknown>,
				)) {
					if (typeof v === "string") out[k] = v;
				}
				return out;
			}
		} catch {
			/* ignore parse errors */
		}
	}
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof v === "string") out[k] = v;
		}
		return out;
	}
	return {};
}

companyRoute.get("/settings", async (c) => {
	const cid = getCompanyId(c);
	const base = (await companyRepo.getSettings(cid)) ?? {
		id: cid,
		name: "My Company",
		slug: "my-company",
		domain: null,
		timezone: "UTC",
		defaultModel: "claude-sonnet-4-6",
		isOfflineOnly: false,
		brandColor: null,
		logoUrl: null,
	};
	return c.json({ ...base, envVars: readEnvVars(cid) });
});

companyRoute.patch(
	"/settings",
	zValidator("json", UpdateCompanySettingsSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");

		// env_vars / envVars routes to the per-company settings.json store via the
		// shared lib helpers (not the SQL companySettings table) so they're picked
		// up by applyKeysToEnv/agent runtimes.
		const envVars = body.env_vars ?? body.envVars;
		if (envVars && typeof envVars === "object") {
			const sanitized: Record<string, string> = {};
			for (const [k, v] of Object.entries(envVars)) {
				if (typeof v === "string") sanitized[k] = v;
			}
			setStoreSettings(cid, { env_vars: JSON.stringify(sanitized) });
		}

		const updates: Record<string, unknown> = {};
		if (body.name !== undefined) updates.name = body.name;
		if (body.slug !== undefined) updates.slug = body.slug;
		if (body.domain !== undefined) updates.domain = body.domain;
		if (body.timezone !== undefined) updates.timezone = body.timezone;
		if (body.defaultModel !== undefined)
			updates.defaultModel = body.defaultModel;
		if (body.isOfflineOnly !== undefined)
			updates.isOfflineOnly = body.isOfflineOnly;
		if (body.brandColor !== undefined) updates.brandColor = body.brandColor;
		if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl;

		const result = await companyRepo.updateSettings(cid, updates);
		return c.json({ ...result, envVars: readEnvVars(cid) });
	},
);

// ─── Members ──────────────────────────────────────────────────────────────────

companyRoute.get("/members", async (c) => {
	const cid = getCompanyId(c);
	const rows = await companyRepo.listMembers(cid);
	return c.json(rows);
});

companyRoute.put(
	"/members/:id/role",
	zValidator("json", UpdateMemberRoleSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = await companyRepo.getMemberById(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);

		const updated = await companyRepo.updateMemberRole(id, cid, body.role);
		return c.json(updated);
	},
);

companyRoute.delete("/members/:id", async (c) => {
	const cid = getCompanyId(c);
	const deleted = await companyRepo.deleteMember(c.req.param("id"), cid);
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

// ─── Invites ──────────────────────────────────────────────────────────────────

companyRoute.get("/invites", async (c) => {
	const cid = getCompanyId(c);
	const rows = await companyRepo.listInvites(cid);
	return c.json(rows);
});

companyRoute.post(
	"/invites",
	zValidator("json", CreateInviteSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const row = await companyRepo.createInvite(body.email, cid, body.role);
		return c.json(row, 201);
	},
);

companyRoute.delete("/invites/:id", async (c) => {
	const cid = getCompanyId(c);
	const deleted = await companyRepo.deleteInvite(c.req.param("id"), cid);
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

// POST /invites/:id/resend — no body. Skipping zValidator.
companyRoute.post("/invites/:id/resend", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const existing = await companyRepo.getInviteById(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);

	const updated = await companyRepo.resendInvite(id, cid);
	return c.json(updated);
});
