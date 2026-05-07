/**
 * integrations.ts — persisted route for external service integrations.
 *
 * Setra's integration model:
 *   - Inbound: Slack/Telegram/Discord/webhook → triggers agent run
 *   - Outbound: agent completes → posts update back to channel
 *   - Daemon: setra runs as background process, no idle cost
 *     (Claude Code subscription used directly, no separate API key)
 *
 * Storage: SQLite via the raw DB client (tables created in migration 0007).
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import { postToSlack } from "../lib/webhook-dispatcher.js";
import * as integrationsRepo from "../repositories/integrations.repo.js";
import {
	CreateIntegrationSchema,
	CreateSecretSchema,
	UpdateIntegrationSchema,
	UpdateSecretSchema,
} from "../validators/integrations.validators.js";

export const integrationsRoute = new Hono();

function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "setra-server",
	};
}

// ─── Integration verification helpers ─────────────────────────────────────────

integrationsRoute.post("/github/verify", async (c) => {
	getCompanyId(c);
	const { token } = (await c.req.json()) as { token?: string };
	const trimmedToken = token?.trim();
	if (!trimmedToken) {
		return c.json({ error: "Token is required", valid: false }, 400);
	}

	try {
		const userResp = await fetch("https://api.github.com/user", {
			headers: githubHeaders(trimmedToken),
		});
		if (!userResp.ok) {
			return c.json({ error: "Invalid token", valid: false }, 401);
		}
		const user = (await userResp.json()) as {
			login: string;
			avatar_url: string;
			name: string | null;
		};

		const reposResp = await fetch(
			"https://api.github.com/user/repos?per_page=100&sort=updated",
			{
				headers: githubHeaders(trimmedToken),
			},
		);
		const repos = reposResp.ok
			? ((await reposResp.json()) as Array<{
					full_name: string;
					private: boolean;
					default_branch: string;
				}>)
			: [];

		return c.json({ valid: true, user, repos });
	} catch {
		return c.json({ error: "Connection failed", valid: false }, 500);
	}
});

integrationsRoute.get("/github/repos", async (c) => {
	const cid = getCompanyId(c);
	const github = integrationsRepo
		.listIntegrations(cid)
		.find(
			(integration) =>
				integration.type === "github" && integration.status === "active",
		);
	if (!github) return c.json({ error: "GitHub not connected" }, 404);

	const token = github.config?.token?.trim();
	if (!token) return c.json({ error: "No token" }, 400);

	try {
		const resp = await fetch(
			"https://api.github.com/user/repos?per_page=100&sort=updated",
			{
				headers: githubHeaders(token),
			},
		);
		if (!resp.ok)
			return c.json({ error: "GitHub API error" }, resp.status as 400);
		const repos = (await resp.json()) as unknown;
		return c.json(repos);
	} catch {
		return c.json({ error: "Connection failed" }, 500);
	}
});

integrationsRoute.post("/slack/test", async (c) => {
	getCompanyId(c);
	const { webhookUrl } = (await c.req.json()) as { webhookUrl?: string };
	const trimmedWebhookUrl = webhookUrl?.trim();
	if (!trimmedWebhookUrl) {
		return c.json({ ok: false, error: "Webhook URL is required" }, 400);
	}
	const ok = await postToSlack(trimmedWebhookUrl, {
		text: "🔗 Setra connected successfully! Agent updates will appear here.",
	});
	return c.json({ ok });
});

// ─── Integrations CRUD ────────────────────────────────────────────────────────

integrationsRoute.get("/", (c) => {
	const cid = getCompanyId(c);
	return c.json(integrationsRepo.listIntegrations(cid));
});

integrationsRoute.post(
	"/",
	zValidator("json", CreateIntegrationSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const row = integrationsRepo.createIntegration({
			type: body.type,
			name: body.name ?? body.type,
			config: body.config ?? {},
			companyId: cid,
		});
		await logActivity(c, "integration.created", "integration", row.id, {
			type: body.type,
			name: body.name ?? body.type,
		});
		return c.json(row, 201);
	},
);

integrationsRoute.get("/calendar/events", async (c) => {
	const cid = getCompanyId(c);
	const integrations = integrationsRepo.listIntegrations(cid);
	const calendar = integrations.find(
		(integration) =>
			integration.type === "google_calendar" && integration.status === "active",
	);
	if (!calendar) return c.json({ error: "No calendar configured" }, 404);

	const config = JSON.parse(calendar.config_json || "{}") as Record<
		string,
		string
	>;
	const calendarId = config.calendar_id;
	if (!calendarId) return c.json({ error: "No calendar ID" }, 400);

	const apiKey = config.api_key;
	const now = new Date().toISOString();
	const maxTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

	try {
		let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(maxTime)}&singleEvents=true&orderBy=startTime&maxResults=20`;
		if (apiKey) url += `&key=${encodeURIComponent(apiKey)}`;

		const response = await fetch(url);
		if (!response.ok) {
			const details = await response.text().catch(() => response.statusText);
			return c.json(
				{ error: "Calendar API error", details },
				response.status as 400,
			);
		}

		const data = (await response.json()) as {
			items?: Array<{
				summary?: string;
				start?: { dateTime?: string; date?: string };
				end?: { dateTime?: string; date?: string };
				htmlLink?: string;
			}>;
		};
		const events = (data.items || []).map((item) => ({
			title: item.summary ?? "Untitled event",
			start: item.start?.dateTime || item.start?.date || null,
			end: item.end?.dateTime || item.end?.date || null,
			link: item.htmlLink ?? null,
		}));

		return c.json({ events });
	} catch (error) {
		console.warn("[integrations] failed to fetch calendar events:", error);
		return c.json({ error: "Failed to fetch calendar" }, 500);
	}
});

integrationsRoute.patch(
	"/:id",
	zValidator("json", UpdateIntegrationSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const updates: { status?: string; config?: Record<string, string> } = {};
		if (body.status !== undefined) updates.status = body.status;
		if (body.config !== undefined) updates.config = body.config;
		const row = integrationsRepo.updateIntegration(
			c.req.param("id"),
			cid,
			updates,
		);
		if (!row) return c.json({ error: "not found" }, 404);
		await logActivity(
			c,
			"integration.updated",
			"integration",
			c.req.param("id"),
			{ status: body.status },
		);
		return c.json(row);
	},
);

integrationsRoute.delete("/:id", (c) => {
	const cid = getCompanyId(c);
	const deleted = integrationsRepo.deleteIntegration(c.req.param("id"), cid);
	if (!deleted) return c.json({ error: "not found" }, 404);
	void logActivity(c, "integration.deleted", "integration", c.req.param("id"));
	return c.json({ deleted: true });
});

// ─── Secrets CRUD ─────────────────────────────────────────────────────────────

integrationsRoute.get("/secrets", (c) => {
	const cid = getCompanyId(c);
	return c.json(integrationsRepo.listSecrets(cid));
});

integrationsRoute.post(
	"/secrets",
	zValidator("json", CreateSecretSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const payload: { name: string; description?: string; value?: string } = {
			name: body.name,
		};
		if (body.description !== undefined) payload.description = body.description;
		if (body.value !== undefined) payload.value = body.value;
		const row = integrationsRepo.createSecret({ ...payload, companyId: cid });
		return c.json(row, 201);
	},
);

integrationsRoute.get("/secrets/:id/value", (c) => {
	const cid = getCompanyId(c);
	const value = integrationsRepo.getSecretValue(c.req.param("id"), cid);
	if (value === null) return c.json({ error: "not found" }, 404);
	return c.json({ value });
});

integrationsRoute.patch(
	"/secrets/:id",
	zValidator("json", UpdateSecretSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const updated = integrationsRepo.updateSecret(
			c.req.param("id"),
			cid,
			body.value,
		);
		if (!updated) return c.json({ error: "not found" }, 404);
		await logActivity(c, "secret.updated", "secret", c.req.param("id"), {
			reason: "Company secret value rotated",
		});
		return c.json({ updated: true });
	},
);

integrationsRoute.put(
	"/secrets/:id",
	zValidator("json", UpdateSecretSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const updated = integrationsRepo.updateSecret(
			c.req.param("id"),
			cid,
			body.value,
		);
		if (!updated) return c.json({ error: "not found" }, 404);
		await logActivity(c, "secret.updated", "secret", c.req.param("id"), {
			reason: "Company secret value rotated",
		});
		return c.json({ updated: true });
	},
);

integrationsRoute.delete("/secrets/:id", (c) => {
	const cid = getCompanyId(c);
	const deleted = integrationsRepo.deleteSecret(c.req.param("id"), cid);
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ deleted: true });
});
