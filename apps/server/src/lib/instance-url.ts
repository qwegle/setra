/**
 * Helpers for building external join URLs that point at this Setra instance.
 *
 * Precedence (most specific wins):
 *   1. `companies.public_url` — set by the owner for internet-exposed hosts
 *      (e.g. `https://setra.acme.com` or a Cloudflare-tunnel URL).
 *   2. First non-loopback IPv4 address from the OS — works on LAN.
 *   3. `http://localhost:<port>` — fallback for solo dev.
 */
import { getRawDb } from "@setra/db";
import { getLanAddresses } from "./lan-discovery.js";

export function getCompanyPublicUrl(companyId: string): string | null {
	const row = getRawDb()
		.prepare(`SELECT public_url FROM companies WHERE id = ?`)
		.get(companyId) as { public_url: string | null } | undefined;
	return row?.public_url?.trim() || null;
}

export function getInstanceBaseUrl(companyId?: string): string {
	if (companyId) {
		const explicit = getCompanyPublicUrl(companyId);
		if (explicit) return explicit.replace(/\/$/, "");
	}
	const port = Number(process.env.SETRA_PORT ?? 3141);
	const [lan] = getLanAddresses();
	const host = lan ?? "localhost";
	return `http://${host}:${port}`;
}

export function buildInviteUrl(opts: {
	companyId: string;
	inviteId: string;
	email: string;
}): string {
	const base = getInstanceBaseUrl(opts.companyId);
	const qs = new URLSearchParams({
		invite: opts.inviteId,
		email: opts.email,
	});
	return `${base}/login?${qs.toString()}`;
}
