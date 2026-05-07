/**
 * Resend email tool — available to GTM agents when Resend is connected.
 */

export const RESEND_TOOLS = [
	{
		name: "send_email",
		description:
			"Send an email via Resend. Only available when Resend integration is connected.",
		inputSchema: {
			type: "object",
			properties: {
				to: { type: "string", description: "Email address" },
				subject: { type: "string", description: "Email subject" },
				body: { type: "string", description: "Plain text or HTML body" },
				fromName: {
					type: "string",
					description: "Optional sender name; uses default if omitted",
				},
			},
			required: ["to", "subject", "body"],
		},
	},
	{
		name: "list_email_domains",
		description: "List verified sending domains in Resend account",
	},
];

export async function executeSendEmail(
	params: { to: string; subject: string; body: string; fromName?: string },
	apiKey: string,
	fromEmail: string,
): Promise<{ id: string; status: string }> {
	const resp = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: params.fromName ? `${params.fromName} <${fromEmail}>` : fromEmail,
			to: [params.to],
			subject: params.subject,
			html: params.body.includes("<")
				? params.body
				: `<p>${params.body.replace(/\n/g, "<br>")}</p>`,
		}),
	});
	if (!resp.ok)
		throw new Error(`Resend error ${resp.status}: ${await resp.text()}`);
	return resp.json() as Promise<{ id: string; status: string }>;
}

export async function executeListEmailDomains(
	apiKey: string,
): Promise<unknown> {
	const resp = await fetch("https://api.resend.com/domains", {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!resp.ok)
		throw new Error(`Resend error ${resp.status}: ${await resp.text()}`);
	return resp.json();
}
