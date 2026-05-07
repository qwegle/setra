import * as crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	createWebhookEvent,
	listWebhookEvents,
	updateWebhookEvent,
} from "../lib/webhook-events.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requireCompany } from "../middleware/require-company.js";
import { emit } from "../sse/handler.js";

export const webhooksRoute = new Hono();

webhooksRoute.use("/events", requireAuth(), requireCompany);

function safeParseJson(raw: string): Record<string, unknown> {
	if (!raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: { value: parsed };
	} catch {
		return { raw };
	}
}

function signaturesMatch(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	if (actualBuffer.length !== expectedBuffer.length) return false;
	return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

webhooksRoute.post("/:integrationId/incoming", async (c) => {
	try {
		const integrationId = c.req.param("integrationId");
		const row = getRawDb()
			.prepare("SELECT * FROM integrations WHERE id = ? AND type = 'webhook'")
			.get(integrationId) as
			| {
					id: string;
					company_id: string;
					config_json: string | null;
			  }
			| undefined;

		if (!row) return c.json({ error: "webhook not found" }, 404);

		const config = JSON.parse(row.config_json || "{}") as Record<
			string,
			string
		>;
		if (config.direction === "outbound_only") {
			return c.json({ error: "webhook is outbound only" }, 409);
		}

		const rawBody = await c.req.text();
		if (config.secret) {
			const signature =
				c.req.header("x-webhook-signature") ??
				c.req.header("x-hub-signature-256");
			if (!signature) {
				return c.json({ error: "missing signature" }, 401);
			}
			const expected =
				"sha256=" +
				crypto
					.createHmac("sha256", config.secret)
					.update(rawBody)
					.digest("hex");
			if (!signaturesMatch(signature, expected)) {
				return c.json({ error: "invalid signature" }, 401);
			}
		}

		const payload = safeParseJson(rawBody);
		const companyId = row.company_id;
		const eventId = createWebhookEvent({
			integrationId,
			companyId,
			direction: "inbound",
			payload,
			status: "received",
		});

		const issuePayload =
			typeof payload.issue === "object" && payload.issue !== null
				? (payload.issue as Record<string, unknown>)
				: null;
		const issueTitle =
			issuePayload && typeof issuePayload.title === "string"
				? issuePayload.title
				: null;
		const issueBody =
			issuePayload && typeof issuePayload.body === "string"
				? issuePayload.body
				: null;

		let issueCreated = false;
		if (
			typeof payload.title === "string" ||
			issueTitle ||
			payload.action === "opened"
		) {
			const title =
				typeof payload.title === "string"
					? payload.title
					: issueTitle || "Webhook event";
			const descriptionSource =
				typeof payload.description === "string"
					? payload.description
					: issueBody ||
						(typeof payload.body === "string"
							? payload.body
							: JSON.stringify(payload, null, 2));

			try {
				const project = getRawDb()
					.prepare("SELECT id FROM projects WHERE company_id = ? LIMIT 1")
					.get(companyId) as { id: string } | undefined;

				if (project) {
					const issueId = crypto.randomUUID();
					getRawDb()
						.prepare(
							`INSERT INTO board_issues (id, project_id, title, description, status, priority, company_id)
							VALUES (?, ?, ?, ?, 'backlog', 'medium', ?)`,
						)
						.run(
							issueId,
							project.id,
							title,
							descriptionSource.slice(0, 5000),
							companyId,
						);
					issueCreated = true;
					updateWebhookEvent(eventId, {
						status: "processed",
						issueId,
					});
				}
			} catch (error) {
				console.warn("[webhooks] failed to create issue from payload:", error);
			}
		}

		getRawDb()
			.prepare("UPDATE integrations SET updated_at = ? WHERE id = ?")
			.run(new Date().toISOString(), integrationId);
		c.set("companyId", companyId);
		await logActivity(c, "webhook.received", "integration", integrationId, {
			eventId,
			issueCreated,
		});
		emit("webhook:received", { integrationId, eventId, companyId });

		return c.json({ received: true, eventId, issueCreated });
	} catch (error) {
		console.warn("[webhooks] inbound handling failed:", error);
		return c.json({ error: "failed to process webhook" }, 500);
	}
});

webhooksRoute.get("/events", (c) => {
	const companyId = getCompanyId(c);
	return c.json(listWebhookEvents(companyId, 50));
});
