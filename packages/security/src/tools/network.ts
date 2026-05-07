/**
 * Sentinel — Network reconnaissance and port scanning tools.
 * Uses OS-native binaries when available; returns mock data in air-gapped environments.
 */

import { spawn } from "node:child_process";
import type { DnsRecord, PortInfo } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function spawnWithTimeout(
	cmd: string,
	args: string[],
	timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			reject(new Error(`Command timed out after ${timeoutMs}ms: ${cmd}`));
		}, timeoutMs);

		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, code: code ?? 1 });
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

async function commandExists(cmd: string): Promise<boolean> {
	try {
		await spawnWithTimeout("which", [cmd], 5_000);
		return true;
	} catch {
		return false;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Port scanner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Performs a TCP/UDP port scan against the target.
 * Delegates to nmap when available; returns structured mock data otherwise.
 */
export async function portScan(
	target: string,
	ports = "1-1024",
	options: { timing?: number; serviceDetect?: boolean } = {},
): Promise<{ ports: PortInfo[]; scanTime: number; _mock?: boolean }> {
	const { timing = 3, serviceDetect = true } = options;
	const t0 = Date.now();

	const hasNmap = await commandExists("nmap");
	if (!hasNmap) {
		return {
			ports: mockPortList(target),
			scanTime: Date.now() - t0,
			_mock: true,
		};
	}

	const args = [
		"-p",
		ports,
		`-T${timing}`,
		"--open",
		"-oX",
		"-", // XML output to stdout
	];
	if (serviceDetect) args.push("-sV");
	args.push(target);

	try {
		const { stdout } = await spawnWithTimeout("nmap", args, 120_000);
		const ports_result = parseNmapXml(stdout);
		return { ports: ports_result, scanTime: Date.now() - t0 };
	} catch {
		return {
			ports: mockPortList(target),
			scanTime: Date.now() - t0,
			_mock: true,
		};
	}
}

function parseNmapXml(xml: string): PortInfo[] {
	const results: PortInfo[] = [];
	const portRegex =
		/<port protocol="(tcp|udp)" portid="(\d+)">[\s\S]*?<state state="(\w+)"[\s\S]*?(?:<service name="([^"]*)"(?:[^>]*version="([^"]*)")?)?/g;
	let m: RegExpExecArray | null;
	while ((m = portRegex.exec(xml)) !== null) {
		results.push({
			port: Number.parseInt(m[2] ?? "0", 10),
			protocol: (m[1] as "tcp" | "udp") ?? "tcp",
			state: (m[3] as "open" | "closed" | "filtered") ?? "open",
			...(m[4] != null ? { service: m[4] } : {}),
			...(m[5] != null ? { version: m[5] } : {}),
		});
	}
	return results;
}

function mockPortList(target: string): PortInfo[] {
	// Deterministic pseudo-random selection seeded by target string length
	const seed = target.length % 4;
	const templates: PortInfo[][] = [
		[
			{
				port: 22,
				protocol: "tcp",
				state: "open",
				service: "ssh",
				version: "OpenSSH 8.9",
			},
			{
				port: 80,
				protocol: "tcp",
				state: "open",
				service: "http",
				version: "nginx/1.24",
			},
			{
				port: 443,
				protocol: "tcp",
				state: "open",
				service: "https",
				version: "nginx/1.24",
			},
		],
		[
			{
				port: 22,
				protocol: "tcp",
				state: "open",
				service: "ssh",
				version: "OpenSSH 9.0",
			},
			{
				port: 3306,
				protocol: "tcp",
				state: "open",
				service: "mysql",
				version: "8.0.33",
			},
			{ port: 8080, protocol: "tcp", state: "open", service: "http-proxy" },
		],
		[
			{
				port: 21,
				protocol: "tcp",
				state: "open",
				service: "ftp",
				version: "vsftpd 3.0",
			},
			{ port: 25, protocol: "tcp", state: "filtered", service: "smtp" },
			{ port: 443, protocol: "tcp", state: "open", service: "https" },
		],
		[
			{
				port: 80,
				protocol: "tcp",
				state: "open",
				service: "http",
				version: "Apache/2.4.54",
			},
			{
				port: 443,
				protocol: "tcp",
				state: "open",
				service: "https",
				version: "Apache/2.4.54",
			},
			{ port: 5432, protocol: "tcp", state: "filtered", service: "postgresql" },
		],
	];
	return templates[seed] ?? templates[0] ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Service banner grabbing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connects to a port and captures the service banner for version fingerprinting.
 */
export async function serviceBanner(
	target: string,
	port: number,
): Promise<{ banner: string; service?: string; version?: string }> {
	try {
		const { stdout } = await spawnWithTimeout(
			"nc",
			["-w", "3", "-n", target, String(port)],
			8_000,
		);
		const banner = stdout.slice(0, 512).trim();
		const service = inferServiceFromBanner(banner, port);
		const version = extractVersionFromBanner(banner);
		return {
			banner,
			...(service != null ? { service } : {}),
			...(version != null ? { version } : {}),
		};
	} catch {
		const fallbackService = wellKnownService(port);
		return {
			banner: "",
			...(fallbackService != null ? { service: fallbackService } : {}),
		};
	}
}

function inferServiceFromBanner(
	banner: string,
	port: number,
): string | undefined {
	const b = banner.toLowerCase();
	if (b.includes("ssh")) return "ssh";
	if (b.includes("http") || b.includes("html")) return "http";
	if (b.includes("ftp")) return "ftp";
	if (b.includes("smtp") || b.includes("220")) return "smtp";
	if (b.includes("mysql") || b.includes("mariadb")) return "mysql";
	return wellKnownService(port);
}

function extractVersionFromBanner(banner: string): string | undefined {
	const m = banner.match(/(\d+\.\d+(?:\.\d+)?(?:[-_]\w+)?)/);
	return m ? m[1] : undefined;
}

function wellKnownService(port: number): string | undefined {
	const map: Record<number, string> = {
		21: "ftp",
		22: "ssh",
		23: "telnet",
		25: "smtp",
		53: "dns",
		80: "http",
		110: "pop3",
		143: "imap",
		443: "https",
		3306: "mysql",
		5432: "postgresql",
		6379: "redis",
		27017: "mongodb",
	};
	return map[port];
}

// ─────────────────────────────────────────────────────────────────────────────
// Traceroute
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps the network path to the target, revealing routing topology and potential bottlenecks.
 */
export async function traceroute(target: string): Promise<{
	hops: Array<{ hop: number; ip: string; hostname?: string; rttMs: number }>;
}> {
	const cmd = process.platform === "darwin" ? "traceroute" : "tracepath";
	try {
		const { stdout } = await spawnWithTimeout(
			cmd,
			["-m", "20", target],
			45_000,
		);
		return { hops: parseTracerouteOutput(stdout) };
	} catch {
		return { hops: mockTraceroute() };
	}
}

function parseTracerouteOutput(
	raw: string,
): Array<{ hop: number; ip: string; hostname?: string; rttMs: number }> {
	const hops: Array<{
		hop: number;
		ip: string;
		hostname?: string;
		rttMs: number;
	}> = [];
	const lines = raw.split("\n");
	for (const line of lines) {
		const m = line.match(
			/^\s*(\d+)\s+(?:(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)|(\d+\.\d+\.\d+\.\d+))\s+([\d.]+)\s*ms/,
		);
		if (!m) continue;
		hops.push({
			hop: Number.parseInt(m[1] ?? "0", 10),
			...(m[2] != null ? { hostname: m[2] } : {}),
			ip: m[3] ?? m[4] ?? "0.0.0.0",
			rttMs: Number.parseFloat(m[5] ?? "0"),
		});
	}
	return hops;
}

function mockTraceroute() {
	return [
		{ hop: 1, ip: "192.168.1.1", hostname: "gateway.local", rttMs: 1.2 },
		{ hop: 2, ip: "10.0.0.1", rttMs: 5.4 },
		{
			hop: 3,
			ip: "72.14.215.99",
			hostname: "isp-edge.example.net",
			rttMs: 12.7,
		},
		{ hop: 4, ip: "209.85.248.100", rttMs: 18.3 },
	];
}

// ─────────────────────────────────────────────────────────────────────────────
// DNS enumeration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enumerates DNS records for a domain using the system resolver or Cloudflare DoH as fallback.
 */
export async function dnsEnumerate(
	domain: string,
): Promise<{ records: DnsRecord[]; subdomains: string[] }> {
	const records: DnsRecord[] = [];

	// Try system dig first
	const hasDig = await commandExists("dig");
	if (hasDig) {
		const types = ["A", "AAAA", "MX", "NS", "TXT", "CNAME"];
		for (const type of types) {
			try {
				const { stdout } = await spawnWithTimeout(
					"dig",
					["+short", "+noall", "+answer", type, domain],
					8_000,
				);
				for (const line of stdout.split("\n").filter(Boolean)) {
					records.push({ type, name: domain, value: line.trim() });
				}
			} catch {
				// continue with next record type
			}
		}
	} else {
		// Fallback: Cloudflare DNS-over-HTTPS
		const types = ["A", "AAAA", "MX", "NS", "TXT"];
		for (const type of types) {
			try {
				const resp = await fetch(
					`https://1.1.1.1/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
					{
						headers: { Accept: "application/dns-json" },
						signal: AbortSignal.timeout(8_000),
					},
				);
				if (resp.ok) {
					const json = (await resp.json()) as {
						Answer?: Array<{ data: string }>;
					};
					for (const ans of json.Answer ?? []) {
						records.push({ type, name: domain, value: ans.data });
					}
				}
			} catch {
				// continue
			}
		}
	}

	// Collect subdomains from NS and MX values
	const subdomains = [
		...new Set(
			records
				.filter((r) => ["NS", "MX", "CNAME"].includes(r.type))
				.map((r) => r.value.replace(/\.$/, "").toLowerCase())
				.filter((v) => v.endsWith(`.${domain}`)),
		),
	];

	return { records, subdomains };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAF detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Probes a URL for Web Application Firewall presence by analysing response headers and
 * behaviour patterns introduced by common WAF vendors.
 */
export async function detectWaf(
	url: string,
): Promise<{ detected: boolean; vendor?: string; confidence: number }> {
	try {
		// Send a mildly suspicious payload to trigger WAF response headers
		const probeUrl = `${url}?s=<script>alert(1)</script>`;
		const resp = await fetch(probeUrl, {
			method: "GET",
			signal: AbortSignal.timeout(10_000),
			redirect: "follow",
		});

		const headers: Record<string, string> = {};
		resp.headers.forEach(
			(v, k) => (headers[k.toLowerCase()] = v.toLowerCase()),
		);
		const body = await resp.text().catch(() => "");

		const result = classifyWaf(headers, body, resp.status);
		return result;
	} catch {
		return { detected: false, confidence: 0 };
	}
}

function classifyWaf(
	headers: Record<string, string>,
	body: string,
	status: number,
): { detected: boolean; vendor?: string; confidence: number } {
	const signatures: Array<{
		vendor: string;
		headerKey?: string;
		headerVal?: string;
		bodyPattern?: RegExp;
		statusCode?: number;
		weight: number;
	}> = [
		{ vendor: "Cloudflare", headerKey: "cf-ray", weight: 90 },
		{
			vendor: "Cloudflare",
			headerKey: "server",
			headerVal: "cloudflare",
			weight: 85,
		},
		{ vendor: "AWS WAF", headerKey: "x-amzn-requestid", weight: 70 },
		{ vendor: "AWS WAF", bodyPattern: /aws.waf/i, weight: 75 },
		{ vendor: "Akamai", headerKey: "x-akamai-transformed", weight: 85 },
		{ vendor: "Akamai", headerKey: "x-check-cacheable", weight: 60 },
		{ vendor: "Sucuri", headerKey: "x-sucuri-id", weight: 90 },
		{ vendor: "Sucuri", bodyPattern: /sucuri\.net/i, weight: 80 },
		{ vendor: "Imperva (Incapsula)", headerKey: "x-iinfo", weight: 85 },
		{
			vendor: "Imperva (Incapsula)",
			headerKey: "x-cdn",
			headerVal: "incapsula",
			weight: 90,
		},
		{ vendor: "F5 BIG-IP", headerKey: "x-wa-info", weight: 80 },
		{
			vendor: "ModSecurity",
			bodyPattern: /mod_security|modsecurity/i,
			weight: 75,
		},
		{ vendor: "Barracuda", bodyPattern: /barracuda/i, weight: 70 },
		{ vendor: "Fortinet", headerKey: "x-waf-event-info", weight: 85 },
		{ vendor: "Generic WAF", statusCode: 406, weight: 40 },
		{ vendor: "Generic WAF", statusCode: 419, weight: 45 },
		{ vendor: "Generic WAF", statusCode: 501, weight: 35 },
	];

	const scores: Record<string, number> = {};

	for (const sig of signatures) {
		let match = false;
		if (sig.headerKey && sig.headerVal) {
			match = (headers[sig.headerKey] ?? "").includes(sig.headerVal);
		} else if (sig.headerKey) {
			match = sig.headerKey in headers;
		} else if (sig.bodyPattern) {
			match = sig.bodyPattern.test(body);
		} else if (sig.statusCode !== undefined) {
			match = status === sig.statusCode;
		}
		if (match) {
			scores[sig.vendor] = Math.max(scores[sig.vendor] ?? 0, sig.weight);
		}
	}

	const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
	if (!top) return { detected: false, confidence: 0 };
	return { detected: true, vendor: top[0], confidence: top[1] };
}
