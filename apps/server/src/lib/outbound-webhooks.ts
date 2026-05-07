import * as crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { createWebhookEvent, updateWebhookEvent } from "./webhook-events.js";

interface WebhookPayload {
	event: string;
	timestamp: string;
	data: Record<string, unknown>;
}

export async function fireOutboundWebhooks(
	companyId: string,
	event: string,
	data: Record<string, unknown>,
): Promise<void> {
	try {
		const integrations = getRawDb()
			.prepare(
				"SELECT * FROM integrations WHERE company_id = ? AND type = 'webhook' AND status = 'active'",
			)
			.all(companyId) as Array<{ id: string; config_json: string | null }>;

		const payload: WebhookPayload = {
			event,
			timestamp: new Date().toISOString(),
			data,
		};
		const body = JSON.stringify(payload);

		for (const row of integrations) {
			const config = JSON.parse(row.config_json || "{}") as Record<
				string,
				string
			>;
			if (!config.url || config.direction === "inbound_only") continue;

			const eventId = createWebhookEvent({
				integrationId: row.id,
				companyId,
				direction: "outbound",
				eventName: event,
				targetUrl: config.url,
				payload,
				status: "pending",
			});

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (config.secret) {
				headers["x-webhook-signature"] =
					"sha256=" +
					crypto.createHmac("sha256", config.secret).update(body).digest("hex");
			}

			try {
				const response = await fetch(config.url, {
					method: "POST",
					headers,
					body,
				});
				updateWebhookEvent(eventId, {
					status: response.ok ? "delivered" : "failed",
					responseStatus: response.status,
					errorMessage: response.ok
						? null
						: await response.text().catch(() => null),
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				updateWebhookEvent(eventId, {
					status: "failed",
					errorMessage: message,
				});
				console.warn(
					`[outbound-webhooks] failed to fire to ${config.url}:`,
					error,
				);
			}
		}
	} catch (error) {
		console.warn("[outbound-webhooks] fan-out failed:", error);
	}
}
