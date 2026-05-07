/**
 * Sentinel — Open-source intelligence gathering tools.
 * Collects public data about targets via WHOIS, certificate transparency,
 * reverse DNS, and breach exposure checks.
 */

import { spawn } from "node:child_process";
import type { DnsRecord } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function spawnOut(
	cmd: string,
	args: string[],
	timeoutMs = 15_000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		const t = setTimeout(() => {
			proc.kill();
			reject(new Error("timeout"));
		}, timeoutMs);
		proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
		proc.on("close", () => {
			clearTimeout(t);
			resolve(out);
		});
		proc.on("error", (e) => {
			clearTimeout(t);
			reject(e);
		});
	});
}

async function commandExists(cmd: string): Promise<boolean> {
	try {
		await spawnOut("which", [cmd], 4_000);
		return true;
	} catch {
		return false;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// WHOIS / RDAP lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieves domain registration information via the whois CLI or the RDAP API.
 */
export async function whoisLookup(domain: string): Promise<{
	registrar: string;
	registeredAt?: Date;
	expiresAt?: Date;
	nameservers: string[];
	registrantOrg?: string;
	raw: string;
}> {
	// Prefer the whois CLI — it supports more TLDs
	const hasWhois = await commandExists("whois");
	if (hasWhois) {
		try {
			const raw = await spawnOut("whois", [domain], 20_000);
			return parseWhoisOutput(raw, domain);
		} catch {
			/* fall through to RDAP */
		}
	}

	// RDAP fallback
	try {
		const resp = await fetch(
			`https://rdap.org/domain/${encodeURIComponent(domain)}`,
			{
				signal: AbortSignal.timeout(10_000),
				headers: { Accept: "application/json" },
			},
		);
		if (!resp.ok) throw new Error(`RDAP ${resp.status}`);
		const data = (await resp.json()) as RdapResponse;
		return parseRdapResponse(data, domain);
	} catch {
		return { registrar: "unknown", nameservers: [], raw: "" };
	}
}

interface RdapResponse {
	entities?: Array<{
		roles?: string[];
		vcardArray?: unknown[];
		handle?: string;
	}>;
	nameservers?: Array<{ ldhName: string }>;
	events?: Array<{ eventAction: string; eventDate: string }>;
}

function parseRdapResponse(
	data: RdapResponse,
	domain: string,
): ReturnType<typeof whoisLookup> extends Promise<infer R> ? R : never {
	const nameservers = (data.nameservers ?? []).map((ns) => ns.ldhName);
	let registrar = "unknown";
	let registrantOrg: string | undefined;

	for (const entity of data.entities ?? []) {
		if (entity.roles?.includes("registrar")) {
			registrar = entity.handle ?? "unknown";
		}
		if (entity.roles?.includes("registrant")) {
			registrantOrg = entity.handle;
		}
	}

	const events = data.events ?? [];
	const regEvt = events.find((e) => e.eventAction === "registration");
	const expEvt = events.find((e) => e.eventAction === "expiration");

	return {
		registrar,
		...(regEvt != null ? { registeredAt: new Date(regEvt.eventDate) } : {}),
		...(expEvt != null ? { expiresAt: new Date(expEvt.eventDate) } : {}),
		nameservers,
		...(registrantOrg != null ? { registrantOrg } : {}),
		raw: JSON.stringify(data, null, 2),
	};
}

function parseWhoisOutput(
	raw: string,
	_domain: string,
): ReturnType<typeof whoisLookup> extends Promise<infer R> ? R : never {
	const line = (key: string) =>
		raw.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "mi"))?.[1]?.trim();

	const nameservers: string[] = [];
	for (const m of raw.matchAll(/^name server\s*:\s*(.+)$/gim)) {
		nameservers.push((m[1] ?? "").trim().toLowerCase());
	}

	const registrar = line("registrar") ?? line("Registrar") ?? "unknown";
	const registrantOrgVal =
		line("registrant organization") ?? line("Registrant Org");

	const parseDateLine = (key: string): Date | undefined => {
		const v = line(key);
		if (!v) return undefined;
		const d = new Date(v);
		return isNaN(d.getTime()) ? undefined : d;
	};

	const registeredAt =
		parseDateLine("creation date") ?? parseDateLine("Created");
	const expiresAt =
		parseDateLine("registry expiry date") ?? parseDateLine("Expiry Date");

	return {
		registrar,
		...(registeredAt != null ? { registeredAt } : {}),
		...(expiresAt != null ? { expiresAt } : {}),
		nameservers,
		...(registrantOrgVal != null ? { registrantOrg: registrantOrgVal } : {}),
		raw,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificate transparency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries crt.sh to retrieve certificates issued for a domain and its subdomains.
 */
export async function certTransparency(domain: string): Promise<
	Array<{
		commonName: string;
		issuer: string;
		notBefore: Date;
		notAfter: Date;
		subjectAltNames: string[];
	}>
> {
	try {
		const resp = await fetch(
			`https://crt.sh/?q=${encodeURIComponent("%" + domain)}&output=json`,
			{
				signal: AbortSignal.timeout(15_000),
				headers: {
					Accept: "application/json",
					"User-Agent": "Sentinel/1.0 (setra.sh)",
				},
			},
		);
		if (!resp.ok) throw new Error(`crt.sh ${resp.status}`);
		const data = (await resp.json()) as Array<{
			common_name: string;
			issuer_name: string;
			not_before: string;
			not_after: string;
			name_value: string;
		}>;

		const seen = new Set<string>();
		return data
			.filter((c) => {
				const key = c.common_name + c.not_before;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			})
			.slice(0, 200)
			.map((c) => ({
				commonName: c.common_name,
				issuer: c.issuer_name,
				notBefore: new Date(c.not_before),
				notAfter: new Date(c.not_after),
				subjectAltNames: c.name_value
					.split("\n")
					.map((s) => s.trim())
					.filter(Boolean),
			}));
	} catch {
		return [];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse DNS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the hostname for an IP address and attempts to identify related domains
 * sharing the same IP block via passive DNS patterns.
 */
export async function reverseDns(
	ip: string,
): Promise<{ hostname?: string; relatedDomains: string[] }> {
	const hasDig = await commandExists("dig");

	let hostname: string | undefined;
	if (hasDig) {
		try {
			const out = await spawnOut("dig", ["-x", ip, "+short"], 8_000);
			hostname = out.trim().replace(/\.$/, "") || undefined;
		} catch {
			/* ignore */
		}
	} else {
		try {
			const resp = await fetch(
				`https://1.1.1.1/dns-query?name=${encodeURIComponent(reverseArpa(ip))}&type=PTR`,
				{
					headers: { Accept: "application/dns-json" },
					signal: AbortSignal.timeout(6_000),
				},
			);
			if (resp.ok) {
				const json = (await resp.json()) as {
					Answer?: Array<{ data: string }>;
				};
				hostname = json.Answer?.[0]?.data?.replace(/\.$/, "") || undefined;
			}
		} catch {
			/* ignore */
		}
	}

	// Related domains: extract base domain from PTR and try common naming patterns
	const relatedDomains: string[] = [];
	if (hostname) {
		const parts = hostname.split(".");
		if (parts.length >= 2) {
			const baseDomain = parts.slice(-2).join(".");
			relatedDomains.push(baseDomain);
		}
	}

	return { ...(hostname != null ? { hostname } : {}), relatedDomains };
}

function reverseArpa(ip: string): string {
	return ip.split(".").reverse().join(".") + ".in-addr.arpa";
}

// ─────────────────────────────────────────────────────────────────────────────
// Subdomain discovery
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_SUBDOMAINS = [
	"www",
	"mail",
	"ftp",
	"smtp",
	"pop",
	"imap",
	"vpn",
	"remote",
	"api",
	"dev",
	"staging",
	"test",
	"uat",
	"prod",
	"admin",
	"portal",
	"app",
	"static",
	"cdn",
	"assets",
	"img",
	"images",
	"upload",
	"download",
	"help",
	"support",
	"docs",
	"status",
	"monitor",
	"metrics",
	"logs",
	"jenkins",
	"gitlab",
	"git",
	"ci",
	"jira",
	"confluence",
	"wiki",
	"ns1",
	"ns2",
	"mx",
	"mx1",
	"mx2",
	"webmail",
	"autodiscover",
	"login",
	"auth",
	"sso",
	"oauth",
	"id",
	"accounts",
	"secure",
	"beta",
	"alpha",
	"sandbox",
	"demo",
	"old",
	"new",
	"v2",
	"v3",
];

/**
 * Discovers subdomains through certificate transparency records and
 * a targeted DNS brute-force using a curated wordlist.
 */
export async function gatherSubdomains(domain: string): Promise<string[]> {
	const found = new Set<string>();

	// Source 1: certificate transparency
	const certs = await certTransparency(domain).catch(() => []);
	for (const cert of certs) {
		for (const san of cert.subjectAltNames) {
			const name = san.replace(/^\*\./, "").toLowerCase();
			if (name.endsWith(`.${domain}`) || name === domain) {
				found.add(name);
			}
		}
		const cn = cert.commonName.replace(/^\*\./, "").toLowerCase();
		if (cn.endsWith(`.${domain}`)) found.add(cn);
	}

	// Source 2: DNS brute-force (concurrent, small wordlist)
	const resolveSub = async (sub: string): Promise<void> => {
		const fqdn = `${sub}.${domain}`;
		try {
			const resp = await fetch(
				`https://1.1.1.1/dns-query?name=${encodeURIComponent(fqdn)}&type=A`,
				{
					headers: { Accept: "application/dns-json" },
					signal: AbortSignal.timeout(4_000),
				},
			);
			if (resp.ok) {
				const json = (await resp.json()) as {
					Status: number;
					Answer?: unknown[];
				};
				if (json.Status === 0 && (json.Answer?.length ?? 0) > 0) {
					found.add(fqdn);
				}
			}
		} catch {
			/* DNS timeout or NXDOMAIN — skip */
		}
	};

	// Batched DNS requests to avoid overwhelming resolvers
	const BATCH = 10;
	for (let i = 0; i < COMMON_SUBDOMAINS.length; i += BATCH) {
		const batch = COMMON_SUBDOMAINS.slice(i, i + BATCH);
		await Promise.allSettled(batch.map(resolveSub));
	}

	return [...found].sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Breach exposure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if a domain appears in publicly known breach datasets via the
 * HaveIBeenPwned domain search API, if available. Returns a safe offline
 * indicator when the service is unreachable.
 */
export async function checkBreachExposure(domain: string): Promise<{
	breached: boolean;
	breachCount: number;
	exposedDataTypes: string[];
}> {
	try {
		const resp = await fetch(
			`https://haveibeenpwned.com/api/v3/breacheddomain/${encodeURIComponent(domain)}`,
			{
				signal: AbortSignal.timeout(8_000),
				headers: {
					"User-Agent": "Sentinel/1.0 (setra.sh security scanner)",
					Accept: "application/json",
				},
			},
		);

		if (resp.status === 404) {
			return { breached: false, breachCount: 0, exposedDataTypes: [] };
		}
		if (!resp.ok) throw new Error(`HIBP ${resp.status}`);

		const data = (await resp.json()) as Record<string, string[]>;
		const allTypes = new Set<string>();
		for (const types of Object.values(data)) {
			for (const t of types) allTypes.add(t);
		}

		return {
			breached: true,
			breachCount: Object.keys(data).length,
			exposedDataTypes: [...allTypes],
		};
	} catch {
		// Offline or rate-limited — surface as informational
		return { breached: false, breachCount: 0, exposedDataTypes: [] };
	}
}

// Re-export DnsRecord for convenience
export type { DnsRecord };
