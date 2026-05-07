/**
 * integrations.ts — Integration configuration store
 *
 * Stores integration credentials (API keys, OAuth tokens) in
 * ~/.setra/integrations.json — stored as-is for now.
 * NOTE: v2 will encrypt credentials using the OS keychain (Keytar).
 * Never synced to cloud in offline/governance mode.
 *
 * When an integration is connected, relevant agents automatically get
 * context from it (e.g. GTM agents see recent emails via Resend,
 * calendar agents see upcoming meetings via Google Calendar).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type IntegrationStatus =
	| "connected"
	| "disconnected"
	| "error"
	| "checking";

export interface Integration {
	id: string;
	name: string;
	description: string;
	category:
		| "email"
		| "calendar"
		| "ticketing"
		| "messaging"
		| "crm"
		| "monitoring"
		| "other";
	icon: string; // emoji
	docsUrl: string;
	configFields: IntegrationField[];
	/** What context agents get from this integration */
	agentContext: string;
}

export interface IntegrationField {
	key: string;
	label: string;
	type: "text" | "password" | "url" | "select";
	placeholder?: string;
	required: boolean;
	options?: string[]; // for select type
	helpText?: string;
}

export interface IntegrationConfig {
	integrationId: string;
	values: Record<string, string>;
	connectedAt: string;
	lastTestedAt?: string;
	status: IntegrationStatus;
	errorMessage?: string;
}

export const INTEGRATIONS: Integration[] = [
	{
		id: "resend",
		name: "Resend",
		description:
			"Send transactional emails. GTM agents can draft, send, and track email campaigns.",
		category: "email",
		icon: "✉️",
		docsUrl: "https://resend.com/docs/api-reference/introduction",
		agentContext:
			"Email history, campaign stats, bounce rates for GTM intelligence",
		configFields: [
			{
				key: "apiKey",
				label: "API Key",
				type: "password",
				placeholder: "re_xxxx",
				required: true,
				helpText: "Found in Resend dashboard → API Keys",
			},
			{
				key: "fromEmail",
				label: "Default From Email",
				type: "text",
				placeholder: "you@yourdomain.com",
				required: true,
			},
			{
				key: "fromName",
				label: "From Name",
				type: "text",
				placeholder: "Your Name / Company",
				required: false,
			},
		],
	},
	{
		id: "google-calendar",
		name: "Google Calendar",
		description:
			"Agents see your schedule, suggest meeting times, and create follow-up reminders.",
		category: "calendar",
		icon: "📅",
		docsUrl: "https://developers.google.com/calendar/api/guides/overview",
		agentContext:
			"Upcoming meetings, availability windows, calendar events for scheduling context",
		configFields: [
			{
				key: "clientId",
				label: "OAuth Client ID",
				type: "text",
				required: true,
			},
			{
				key: "clientSecret",
				label: "OAuth Client Secret",
				type: "password",
				required: true,
			},
			{
				key: "calendarId",
				label: "Calendar ID",
				type: "text",
				placeholder: "primary",
				required: false,
			},
		],
	},
	{
		id: "jira",
		name: "Jira",
		description:
			"Agents can read, create, and close Jira tickets. Track token cost per ticket.",
		category: "ticketing",
		icon: "🎫",
		docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
		agentContext:
			"Open tickets, sprint backlog, ticket history for work context",
		configFields: [
			{
				key: "baseUrl",
				label: "Jira Base URL",
				type: "url",
				placeholder: "https://yourorg.atlassian.net",
				required: true,
			},
			{ key: "email", label: "Atlassian Email", type: "text", required: true },
			{
				key: "apiToken",
				label: "API Token",
				type: "password",
				required: true,
				helpText: "Create at id.atlassian.com → Security → API tokens",
			},
			{
				key: "projectKey",
				label: "Default Project Key",
				type: "text",
				placeholder: "PROJ",
				required: false,
			},
		],
	},
	{
		id: "github",
		name: "GitHub",
		description:
			"PR reviews, issue tracking, repository analysis. Already used for PR review feature.",
		category: "ticketing",
		icon: "🐙",
		docsUrl: "https://docs.github.com/en/rest",
		agentContext: "Open PRs, issues, commit history, CI status",
		configFields: [
			{
				key: "token",
				label: "Personal Access Token",
				type: "password",
				placeholder: "ghp_xxxx",
				required: true,
			},
			{
				key: "defaultRepo",
				label: "Default Repository",
				type: "text",
				placeholder: "owner/repo",
				required: false,
			},
		],
	},
	{
		id: "slack",
		name: "Slack",
		description: "Agents post updates, alerts, and reports to Slack channels.",
		category: "messaging",
		icon: "💬",
		docsUrl: "https://api.slack.com/messaging/webhooks",
		agentContext:
			"Channel activity, mentions, DMs for team context (read-only with bot token)",
		configFields: [
			{
				key: "webhookUrl",
				label: "Webhook URL",
				type: "url",
				placeholder: "https://hooks.slack.com/services/...",
				required: false,
				helpText: "For outbound messages only (simpler)",
			},
			{
				key: "botToken",
				label: "Bot Token",
				type: "password",
				placeholder: "xoxb-xxxx",
				required: false,
				helpText: "For reading channel messages too",
			},
			{
				key: "defaultChannel",
				label: "Default Channel",
				type: "text",
				placeholder: "#general",
				required: false,
			},
		],
	},
	{
		id: "linear",
		name: "Linear",
		description:
			"Modern issue tracker. Agents create, update, and close Linear issues.",
		category: "ticketing",
		icon: "📐",
		docsUrl:
			"https://developers.linear.app/docs/graphql/working-with-the-graphql-api",
		agentContext: "Issue backlog, cycle progress, team velocity",
		configFields: [
			{
				key: "apiKey",
				label: "API Key",
				type: "password",
				required: true,
				helpText: "Settings → API → Personal API keys",
			},
			{ key: "teamId", label: "Team ID", type: "text", required: false },
		],
	},
	{
		id: "hubspot",
		name: "HubSpot",
		description:
			"GTM agents read CRM data — contacts, deals, pipeline stage — for sales intelligence.",
		category: "crm",
		icon: "🟠",
		docsUrl: "https://developers.hubspot.com/docs/api/overview",
		agentContext:
			"Contact list, deal pipeline, recent activities for GTM agent context",
		configFields: [
			{
				key: "accessToken",
				label: "Private App Access Token",
				type: "password",
				required: true,
			},
			{ key: "portalId", label: "Portal ID", type: "text", required: false },
		],
	},
	{
		id: "sendgrid",
		name: "SendGrid",
		description:
			"Alternative to Resend for email sending. Supports bulk marketing emails.",
		category: "email",
		icon: "📨",
		docsUrl: "https://docs.sendgrid.com/api-reference",
		agentContext: "Email stats, suppression lists, template library",
		configFields: [
			{
				key: "apiKey",
				label: "API Key",
				type: "password",
				placeholder: "SG.xxxx",
				required: true,
			},
			{
				key: "fromEmail",
				label: "Verified Sender Email",
				type: "text",
				required: true,
			},
		],
	},
	{
		id: "datadog",
		name: "Datadog",
		description:
			"Monitoring agents read alerts, metrics, and logs for incident response.",
		category: "monitoring",
		icon: "🐶",
		docsUrl: "https://docs.datadoghq.com/api/latest/",
		agentContext:
			"Active alerts, error rates, infrastructure metrics for incident context",
		configFields: [
			{ key: "apiKey", label: "API Key", type: "password", required: true },
			{
				key: "appKey",
				label: "Application Key",
				type: "password",
				required: true,
			},
			{
				key: "site",
				label: "Datadog Site",
				type: "select",
				options: ["datadoghq.com", "datadoghq.eu", "us3.datadoghq.com"],
				required: false,
			},
		],
	},
	{
		id: "notion",
		name: "Notion",
		description: "Agents read and write to Notion databases, wikis, and pages.",
		category: "other",
		icon: "📓",
		docsUrl: "https://developers.notion.com/docs/getting-started",
		agentContext:
			"Project documentation, meeting notes, knowledge base content",
		configFields: [
			{
				key: "apiKey",
				label: "Integration Token",
				type: "password",
				placeholder: "secret_xxxx",
				required: true,
			},
			{
				key: "databaseId",
				label: "Default Database ID",
				type: "text",
				required: false,
			},
		],
	},
];

// ── Config store (stored in ~/.setra/integrations.json) ──────────────────────

function integrationsPath(): string {
	return join(homedir(), ".setra", "integrations.json");
}

function ensureSetraDir(): void {
	const dir = join(homedir(), ".setra");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadIntegrationConfigs(): Record<string, IntegrationConfig> {
	const path = integrationsPath();
	if (!existsSync(path)) return {};
	try {
		const raw = readFileSync(path, "utf8");
		return JSON.parse(raw) as Record<string, IntegrationConfig>;
	} catch {
		return {};
	}
}

export function saveIntegrationConfig(config: IntegrationConfig): void {
	ensureSetraDir();
	const all = loadIntegrationConfigs();
	all[config.integrationId] = config;
	writeFileSync(integrationsPath(), JSON.stringify(all, null, 2), "utf8");
}

export function removeIntegrationConfig(integrationId: string): void {
	ensureSetraDir();
	const all = loadIntegrationConfigs();
	delete all[integrationId];
	writeFileSync(integrationsPath(), JSON.stringify(all, null, 2), "utf8");
}

export function getConnectedIntegrations(): Integration[] {
	const configs = loadIntegrationConfigs();
	return INTEGRATIONS.filter((i) => configs[i.id]?.status === "connected");
}

/**
 * buildIntegrationContext — injects relevant integration summaries
 * into the agent system prompt.
 *
 * Called by launcher.ts before spawning each agent turn.
 */
export function buildIntegrationContext(integrationIds?: string[]): string {
	const normalizeIntegrationId = (value: string) =>
		value.trim().toLowerCase().replace(/_/g, "-");
	const requested = integrationIds?.map(normalizeIntegrationId) ?? null;
	const relevant = requested
		? INTEGRATIONS.filter((integration) =>
				requested.includes(normalizeIntegrationId(integration.id)),
			)
		: getConnectedIntegrations();
	if (relevant.length === 0) return "";
	return `## Connected Integrations\n${relevant.map((i) => `- ${i.icon} ${i.name}: ${i.agentContext}`).join("\n")}`;
}

export async function testIntegration(
	integration: Integration,
	values: Record<string, string>,
): Promise<{ ok: boolean; message: string }> {
	try {
		switch (integration.id) {
			case "resend": {
				const apiKey = values["apiKey"];
				if (!apiKey) return { ok: false, message: "API key is required" };
				const resp = await fetch("https://api.resend.com/domains", {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				if (!resp.ok)
					return { ok: false, message: `Invalid API key (${resp.status})` };
				return { ok: true, message: "Connected to Resend ✅" };
			}

			case "github": {
				const token = values["token"];
				if (!token) return { ok: false, message: "Token is required" };
				const resp = await fetch("https://api.github.com/user", {
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/vnd.github+json",
					},
				});
				if (!resp.ok)
					return { ok: false, message: `Invalid token (${resp.status})` };
				const data = (await resp.json()) as { login?: string };
				return {
					ok: true,
					message: `Connected as ${data.login ?? "unknown"} ✅`,
				};
			}

			case "jira": {
				const { baseUrl, email, apiToken } = values as Record<string, string>;
				if (!baseUrl || !email || !apiToken)
					return {
						ok: false,
						message: "Base URL, email and API token are required",
					};
				const credentials = Buffer.from(`${email}:${apiToken}`).toString(
					"base64",
				);
				const resp = await fetch(
					`${baseUrl.replace(/\/$/, "")}/rest/api/3/myself`,
					{
						headers: {
							Authorization: `Basic ${credentials}`,
							Accept: "application/json",
						},
					},
				);
				if (!resp.ok)
					return {
						ok: false,
						message: `Authentication failed (${resp.status})`,
					};
				const data = (await resp.json()) as {
					emailAddress?: string;
					accountId?: string;
				};
				return {
					ok: true,
					message: `Connected as ${data.emailAddress ?? data.accountId ?? "unknown"} ✅`,
				};
			}

			case "slack": {
				const webhookUrl = values["webhookUrl"];
				const botToken = values["botToken"];
				if (webhookUrl) {
					const resp = await fetch(webhookUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ text: "setra connected ✅" }),
					});
					if (!resp.ok && resp.status !== 200) {
						return {
							ok: false,
							message: `Webhook test failed (${resp.status})`,
						};
					}
					return { ok: true, message: "Slack webhook connected ✅" };
				}
				if (botToken) {
					const resp = await fetch("https://slack.com/api/auth.test", {
						headers: { Authorization: `Bearer ${botToken}` },
					});
					const data = (await resp.json()) as {
						ok?: boolean;
						user?: string;
						error?: string;
					};
					if (!data.ok)
						return { ok: false, message: data.error ?? "Invalid bot token" };
					return { ok: true, message: `Connected as ${data.user ?? "bot"} ✅` };
				}
				return {
					ok: false,
					message: "Provide either a webhook URL or bot token",
				};
			}

			case "sendgrid": {
				const apiKey = values["apiKey"];
				if (!apiKey) return { ok: false, message: "API key is required" };
				const resp = await fetch("https://api.sendgrid.com/v3/scopes", {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				if (!resp.ok)
					return { ok: false, message: `Invalid API key (${resp.status})` };
				return { ok: true, message: "Connected to SendGrid ✅" };
			}

			case "datadog": {
				const apiKey = values["apiKey"];
				const appKey = values["appKey"];
				if (!apiKey || !appKey)
					return { ok: false, message: "API key and App key are required" };
				const site = values["site"] ?? "datadoghq.com";
				const resp = await fetch(`https://api.${site}/api/v1/validate`, {
					headers: { "DD-API-KEY": apiKey, "DD-APPLICATION-KEY": appKey },
				});
				if (!resp.ok)
					return { ok: false, message: `Invalid credentials (${resp.status})` };
				return { ok: true, message: "Connected to Datadog ✅" };
			}

			case "notion": {
				const apiKey = values["apiKey"];
				if (!apiKey)
					return { ok: false, message: "Integration token is required" };
				const resp = await fetch("https://api.notion.com/v1/users/me", {
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Notion-Version": "2022-06-28",
					},
				});
				if (!resp.ok)
					return { ok: false, message: `Invalid token (${resp.status})` };
				const data = (await resp.json()) as { name?: string; type?: string };
				return {
					ok: true,
					message: `Connected as ${data.name ?? data.type ?? "unknown"} ✅`,
				};
			}

			case "hubspot": {
				const accessToken = values["accessToken"];
				if (!accessToken)
					return { ok: false, message: "Access token is required" };
				const resp = await fetch(
					"https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
					{
						headers: { Authorization: `Bearer ${accessToken}` },
					},
				);
				if (!resp.ok)
					return {
						ok: false,
						message: `Invalid access token (${resp.status})`,
					};
				return { ok: true, message: "Connected to HubSpot ✅" };
			}

			case "linear": {
				const apiKey = values["apiKey"];
				if (!apiKey) return { ok: false, message: "API key is required" };
				const resp = await fetch("https://api.linear.app/graphql", {
					method: "POST",
					headers: {
						Authorization: apiKey,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ query: "{ viewer { name email } }" }),
				});
				if (!resp.ok)
					return { ok: false, message: `Invalid API key (${resp.status})` };
				const data = (await resp.json()) as {
					data?: { viewer?: { name?: string; email?: string } };
				};
				const viewer = data.data?.viewer;
				return {
					ok: true,
					message: `Connected as ${viewer?.name ?? viewer?.email ?? "unknown"} ✅`,
				};
			}

			case "google-calendar": {
				// Validate required fields are non-empty
				const { clientId, clientSecret } = values as Record<string, string>;
				if (!clientId || !clientSecret) {
					return {
						ok: false,
						message: "Client ID and Client Secret are required",
					};
				}
				return {
					ok: true,
					message:
						"OAuth credentials saved — complete OAuth flow to activate ✅",
				};
			}

			default: {
				// For any integration not explicitly handled, verify required fields are present
				const missingFields = integration.configFields
					.filter((f) => f.required && !values[f.key])
					.map((f) => f.label);
				if (missingFields.length > 0) {
					return {
						ok: false,
						message: `Missing required fields: ${missingFields.join(", ")}`,
					};
				}
				return {
					ok: true,
					message: `${integration.name} configuration saved ✅`,
				};
			}
		}
	} catch (err) {
		return {
			ok: false,
			message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
