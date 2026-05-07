import { getRawDb } from "@setra/db";

interface SlackMessageBlockText {
	type: string;
	text: string;
}

interface SlackMessageBlock {
	type: string;
	text?: SlackMessageBlockText;
	[k: string]: unknown;
}

export interface SlackMessage {
	text: string;
	blocks?: SlackMessageBlock[];
}

export async function postToSlack(
	webhookUrl: string,
	message: SlackMessage,
): Promise<boolean> {
	try {
		const resp = await fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(message),
		});
		return resp.ok;
	} catch {
		return false;
	}
}

export function buildAgentStatusBlock(
	agentName: string,
	lifecycle: "started" | "completed" | "failed",
	details: {
		issueTitle?: string | undefined;
		costUsd?: number | undefined;
		error?: string | undefined;
		prUrl?: string | undefined;
	},
): SlackMessage {
	const emoji =
		lifecycle === "started" ? "🚀" : lifecycle === "completed" ? "✅" : "❌";
	const verb =
		lifecycle === "started"
			? "started working on"
			: lifecycle === "completed"
				? "completed"
				: "failed on";
	const target = details.issueTitle || "a task";

	let text = `${emoji} *${agentName}* ${verb} ${target}`;
	if (details.prUrl) text += `\n<${details.prUrl}|View PR>`;
	if (details.error) text += `\n> ${details.error}`;
	if (details.costUsd) text += `\n💰 Cost: $${details.costUsd.toFixed(4)}`;

	return { text };
}

export async function fanOutToSlack(
	companyId: string,
	message: SlackMessage,
): Promise<void> {
	try {
		const integrations = getRawDb()
			.prepare(
				"SELECT config_json FROM integrations WHERE company_id = ? AND type = 'slack' AND status = 'active'",
			)
			.all(companyId) as Array<{ config_json: string | null }>;

		for (const row of integrations) {
			const config = JSON.parse(row.config_json || "{}") as Record<
				string,
				unknown
			>;
			const webhookUrl =
				typeof config.webhook_url === "string" ? config.webhook_url : null;
			if (webhookUrl) {
				await postToSlack(webhookUrl, message);
			}
		}
	} catch (err) {
		console.warn("[webhook-dispatcher] slack fan-out failed:", err);
	}
}
