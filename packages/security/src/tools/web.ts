/**
 * Sentinel — Web application security analysis tools.
 * Analyses HTTP responses, headers, TLS configuration, and page content without
 * requiring a browser engine — pure fetch() plus openssl for TLS probing.
 */

import { spawn } from "node:child_process";
import type { SeverityLevel, WebEndpoint } from "../types.js";

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

function resolveUrl(base: string, href: string): string | null {
	try {
		return new URL(href, base).href;
	} catch {
		return null;
	}
}

function extractLinks(html: string, baseUrl: string): string[] {
	const links: string[] = [];
	const patterns = [
		/href="([^"]+)"/gi,
		/href='([^']+)'/gi,
		/src="([^"]+)"/gi,
		/action="([^"]+)"/gi,
	];
	for (const pat of patterns) {
		let m: RegExpExecArray | null;
		while ((m = pat.exec(html)) !== null) {
			const resolved = resolveUrl(baseUrl, m[1] ?? "");
			if (resolved) links.push(resolved);
		}
	}
	return links;
}

function extractFormMethods(html: string): string[] {
	const methods: string[] = ["GET"];
	const formPat = /<form[^>]+method=["']([^"']+)["']/gi;
	let m: RegExpExecArray | null;
	while ((m = formPat.exec(html)) !== null) {
		const method = (m[1] ?? "GET").toUpperCase();
		if (!methods.includes(method)) methods.push(method);
	}
	return methods;
}

function extractParams(url: string): string[] {
	try {
		return [...new URL(url).searchParams.keys()];
	} catch {
		return [];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint crawler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively crawls a web application starting from baseUrl, extracting all
 * reachable endpoints. Stays within the same origin and respects robots.txt.
 */
export async function crawlEndpoints(
	baseUrl: string,
	depth = 2,
): Promise<{ endpoints: WebEndpoint[]; totalPages: number }> {
	const origin = new URL(baseUrl).origin;
	const visited = new Set<string>();
	const endpoints: WebEndpoint[] = [];

	// Fetch and honour robots.txt disallow rules
	const disallowed: RegExp[] = [];
	try {
		const r = await fetch(`${origin}/robots.txt`, {
			signal: AbortSignal.timeout(5_000),
		});
		if (r.ok) {
			const txt = await r.text();
			for (const line of txt.split("\n")) {
				const m = line.match(/^Disallow:\s*(\S+)/i);
				if (m && m[1] && m[1] !== "/") {
					disallowed.push(
						new RegExp(
							"^" + m[1].replace(/\*/g, ".*").replace(/\//g, "\\/") + ".*",
						),
					);
				}
			}
		}
	} catch {
		/* robots.txt unavailable — proceed without restrictions */
	}

	function isAllowed(url: string): boolean {
		try {
			const path = new URL(url).pathname;
			return !disallowed.some((re) => re.test(path));
		} catch {
			return false;
		}
	}

	async function crawl(url: string, currentDepth: number): Promise<void> {
		if (currentDepth < 0 || visited.has(url)) return;
		if (!url.startsWith(origin)) return;
		if (!isAllowed(url)) return;
		visited.add(url);

		try {
			const resp = await fetch(url, {
				signal: AbortSignal.timeout(8_000),
				redirect: "follow",
				headers: { "User-Agent": "Sentinel/1.0 Security Scanner (setra.sh)" },
			});
			const contentType = resp.headers.get("content-type") ?? "";
			const html = contentType.includes("html") ? await resp.text() : "";

			endpoints.push({
				url,
				method: extractFormMethods(html),
				statusCode: resp.status,
				contentType: contentType || undefined,
				parameters: extractParams(url),
				technologies: sniffTechnologiesFromResponse(resp.headers, html),
			});

			if (currentDepth > 0 && html) {
				const links = extractLinks(html, url);
				const unique = [...new Set(links)].filter(
					(l) => l.startsWith(origin) && !visited.has(l),
				);
				await Promise.allSettled(
					unique.slice(0, 20).map((l) => crawl(l, currentDepth - 1)),
				);
			}
		} catch {
			/* unreachable endpoint — skip silently */
		}
	}

	await crawl(baseUrl, depth);
	return { endpoints, totalPages: visited.size };
}

// ─────────────────────────────────────────────────────────────────────────────
// Technology detection
// ─────────────────────────────────────────────────────────────────────────────

function sniffTechnologiesFromResponse(
	headers: Headers,
	body: string,
): string[] {
	const techs: string[] = [];
	const h = (key: string) => (headers.get(key) ?? "").toLowerCase();

	const server = h("server");
	if (server.includes("nginx")) techs.push("nginx");
	if (server.includes("apache")) techs.push("Apache");
	if (server.includes("iis")) techs.push("IIS");
	if (server.includes("litespeed")) techs.push("LiteSpeed");
	if (server.includes("caddy")) techs.push("Caddy");

	const powered = h("x-powered-by");
	if (powered.includes("php")) techs.push("PHP");
	if (powered.includes("asp.net")) techs.push("ASP.NET");
	if (powered.includes("express")) techs.push("Express.js");
	if (powered.includes("next.js")) techs.push("Next.js");

	if (h("set-cookie").includes("laravel_session")) techs.push("Laravel");
	if (h("set-cookie").includes("django")) techs.push("Django");
	if (h("set-cookie").includes("rails_session")) techs.push("Ruby on Rails");
	if (h("x-generator").includes("wordpress")) techs.push("WordPress");

	// Body-based framework signatures
	if (/<div[^>]+ng-app/i.test(body)) techs.push("AngularJS");
	if (
		/react\.development\.js|react\.production\.min\.js|__NEXT_DATA__/i.test(
			body,
		)
	)
		techs.push("React");
	if (/vue\.js|vue\.min\.js|data-v-app/i.test(body)) techs.push("Vue.js");
	if (/wp-content\/themes|wp-includes/i.test(body)) techs.push("WordPress");
	if (/Drupal\.settings|\/sites\/default\/files/i.test(body))
		techs.push("Drupal");
	if (/joomla!|\/components\/com_/i.test(body)) techs.push("Joomla");
	if (/jquery(?:\.min)?\.js/i.test(body)) techs.push("jQuery");
	if (/bootstrap(?:\.min)?\.css|bootstrap(?:\.bundle)?\.js/i.test(body))
		techs.push("Bootstrap");

	return [...new Set(techs)];
}

/**
 * Fingerprints a web target's technology stack via HTTP headers, cookies,
 * and page source analysis. No browser required.
 */
export async function detectTechnologies(url: string): Promise<{
	technologies: string[];
	frameworks: string[];
	cdn?: string;
	server?: string;
}> {
	const resp = await fetch(url, {
		signal: AbortSignal.timeout(10_000),
		headers: { "User-Agent": "Sentinel/1.0 Security Scanner (setra.sh)" },
	});
	const body = await resp.text().catch(() => "");
	const h = (key: string) => resp.headers.get(key) ?? "";

	const all = sniffTechnologiesFromResponse(resp.headers, body);

	const frameworks = all.filter((t) =>
		[
			"React",
			"Vue.js",
			"AngularJS",
			"Next.js",
			"Laravel",
			"Django",
			"Ruby on Rails",
			"Express.js",
			"ASP.NET",
			"WordPress",
			"Drupal",
			"Joomla",
		].includes(t),
	);

	let cdn: string | undefined;
	if (h("cf-ray")) cdn = "Cloudflare";
	else if (h("x-amz-cf-id")) cdn = "Amazon CloudFront";
	else if (h("x-fastly-request-id")) cdn = "Fastly";
	else if (h("via").toLowerCase().includes("akamai")) cdn = "Akamai";

	const server = h("server") || undefined;

	return {
		technologies: all,
		frameworks,
		...(cdn != null ? { cdn } : {}),
		...(server != null ? { server } : {}),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Security header audit
// ─────────────────────────────────────────────────────────────────────────────

interface HeaderFinding {
	header: string;
	severity: SeverityLevel;
	detail: string;
}

/**
 * Evaluates a URL's HTTP security posture by analysing response headers against
 * current best-practice directives. Returns a 0-100 score and actionable findings.
 */
export async function checkSecurityHeaders(url: string): Promise<{
	score: number;
	present: string[];
	missing: string[];
	findings: HeaderFinding[];
}> {
	const resp = await fetch(url, {
		method: "GET",
		redirect: "follow",
		signal: AbortSignal.timeout(10_000),
		headers: { "User-Agent": "Sentinel/1.0 Security Scanner (setra.sh)" },
	});

	const h = (key: string) => resp.headers.get(key) ?? "";
	const findings: HeaderFinding[] = [];
	const present: string[] = [];
	const missing: string[] = [];

	// ── Content-Security-Policy ───────────────────────────────────────────────
	const csp = h("content-security-policy");
	if (csp) {
		present.push("Content-Security-Policy");
		if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'")) {
			findings.push({
				header: "Content-Security-Policy",
				severity: "medium",
				detail:
					"CSP permits unsafe-inline or unsafe-eval, undermining XSS protection.",
			});
		}
	} else {
		missing.push("Content-Security-Policy");
		findings.push({
			header: "Content-Security-Policy",
			severity: "high",
			detail:
				"No CSP directive found. Cross-site scripting attacks are not mitigated.",
		});
	}

	// ── HSTS ─────────────────────────────────────────────────────────────────
	const hsts = h("strict-transport-security");
	if (hsts) {
		present.push("Strict-Transport-Security");
		const maxAgeM = hsts.match(/max-age=(\d+)/i);
		if (maxAgeM && maxAgeM[1] && Number.parseInt(maxAgeM[1], 10) < 31_536_000) {
			findings.push({
				header: "Strict-Transport-Security",
				severity: "low",
				detail:
					"HSTS max-age is less than one year. Increase to at least 31536000.",
			});
		}
	} else {
		missing.push("Strict-Transport-Security");
		findings.push({
			header: "Strict-Transport-Security",
			severity: "high",
			detail: "HSTS is absent. Connections can be downgraded to plain HTTP.",
		});
	}

	// ── X-Frame-Options ───────────────────────────────────────────────────────
	const xfo = h("x-frame-options");
	if (xfo) {
		present.push("X-Frame-Options");
	} else if (!csp.includes("frame-ancestors")) {
		missing.push("X-Frame-Options");
		findings.push({
			header: "X-Frame-Options",
			severity: "medium",
			detail:
				"No clickjacking protection. Add X-Frame-Options or CSP frame-ancestors.",
		});
	}

	// ── X-Content-Type-Options ────────────────────────────────────────────────
	const xcto = h("x-content-type-options");
	if (xcto.toLowerCase() === "nosniff") {
		present.push("X-Content-Type-Options");
	} else {
		missing.push("X-Content-Type-Options");
		findings.push({
			header: "X-Content-Type-Options",
			severity: "medium",
			detail:
				"MIME-sniffing not disabled. Browsers may interpret files as executable scripts.",
		});
	}

	// ── Referrer-Policy ───────────────────────────────────────────────────────
	const rp = h("referrer-policy");
	if (rp) {
		present.push("Referrer-Policy");
	} else {
		missing.push("Referrer-Policy");
		findings.push({
			header: "Referrer-Policy",
			severity: "low",
			detail:
				"Referrer-Policy not set. Full URLs may leak in cross-origin navigation.",
		});
	}

	// ── Permissions-Policy ────────────────────────────────────────────────────
	const pp = h("permissions-policy");
	if (pp) {
		present.push("Permissions-Policy");
	} else {
		missing.push("Permissions-Policy");
		findings.push({
			header: "Permissions-Policy",
			severity: "info",
			detail:
				"Permissions-Policy absent. Consider restricting camera, microphone, and geolocation.",
		});
	}

	// ── CORS misconfiguration ──────────────────────────────────────────────────
	const cors = h("access-control-allow-origin");
	if (cors === "*") {
		present.push("Access-Control-Allow-Origin");
		findings.push({
			header: "Access-Control-Allow-Origin",
			severity: "medium",
			detail:
				"Wildcard CORS policy allows any origin to read responses. Restrict to known domains.",
		});
	}

	// ── Cookie flags (check Set-Cookie) ──────────────────────────────────────
	const setCookie = h("set-cookie");
	if (setCookie) {
		if (!setCookie.toLowerCase().includes("httponly")) {
			findings.push({
				header: "Set-Cookie",
				severity: "medium",
				detail:
					"Session cookie missing HttpOnly flag. Accessible to JavaScript — XSS risk.",
			});
		}
		if (!setCookie.toLowerCase().includes("secure")) {
			findings.push({
				header: "Set-Cookie",
				severity: "high",
				detail:
					"Session cookie missing Secure flag. Cookie transmitted over unencrypted HTTP.",
			});
		}
		if (!setCookie.toLowerCase().includes("samesite")) {
			findings.push({
				header: "Set-Cookie",
				severity: "medium",
				detail:
					"Session cookie missing SameSite attribute. Cross-site request forgery risk.",
			});
		}
	}

	// ── Score calculation ─────────────────────────────────────────────────────
	const totalChecks = 7;
	const passedChecks = present.length;
	const severityPenalty = findings.reduce((acc, f) => {
		const pen: Record<SeverityLevel, number> = {
			critical: 20,
			high: 15,
			medium: 8,
			low: 3,
			info: 0,
		};
		return acc + pen[f.severity];
	}, 0);
	const score = Math.max(
		0,
		Math.round((passedChecks / totalChecks) * 100 - severityPenalty),
	);

	return { score, present, missing, findings };
}

// ─────────────────────────────────────────────────────────────────────────────
// TLS / SSL assessment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates the TLS configuration of a hostname by invoking openssl s_client
 * or using Node's built-in tls module as a fallback.
 */
export async function testSslTls(
	hostname: string,
	port = 443,
): Promise<{
	grade: "A+" | "A" | "B" | "C" | "D" | "F";
	protocol: string;
	cipherSuites: string[];
	certExpiry: Date;
	weaknesses: string[];
}> {
	try {
		const raw = await spawnOut(
			"openssl",
			[
				"s_client",
				"-connect",
				`${hostname}:${port}`,
				"-servername",
				hostname,
				"-brief",
			],
			12_000,
		);
		return parseOpensslOutput(raw);
	} catch {
		// Node.js tls fallback
		return nodeTlsCheck(hostname, port);
	}
}

function parseOpensslOutput(raw: string): {
	grade: "A+" | "A" | "B" | "C" | "D" | "F";
	protocol: string;
	cipherSuites: string[];
	certExpiry: Date;
	weaknesses: string[];
} {
	const weaknesses: string[] = [];

	const protoM = raw.match(/Protocol\s*:\s*(\S+)/i);
	const protocol = protoM?.[1] ?? "unknown";

	const cipherM = raw.match(/Cipher\s*:\s*(\S+)/i);
	const cipherSuites: string[] = cipherM?.[1] ? [cipherM[1]] : [];

	const expiryM = raw.match(/notAfter=([^\n]+)/i);
	const certExpiry = expiryM?.[1]
		? new Date(expiryM[1].trim())
		: new Date(Date.now() + 90 * 86_400_000);

	if (["SSLv2", "SSLv3", "TLSv1", "TLSv1.1"].includes(protocol)) {
		weaknesses.push(`Deprecated protocol in use: ${protocol}`);
	}
	if (cipherSuites.some((c) => /RC4|DES|NULL|EXPORT|anon/i.test(c))) {
		weaknesses.push("Weak cipher suite detected");
	}
	if (certExpiry < new Date()) {
		weaknesses.push("Certificate has expired");
	} else if (certExpiry.getTime() - Date.now() < 30 * 86_400_000) {
		weaknesses.push("Certificate expires within 30 days");
	}

	const grade = gradeFromWeaknesses(weaknesses, protocol);
	return { grade, protocol, cipherSuites, certExpiry, weaknesses };
}

function nodeTlsCheck(
	hostname: string,
	port: number,
): Promise<{
	grade: "A+" | "A" | "B" | "C" | "D" | "F";
	protocol: string;
	cipherSuites: string[];
	certExpiry: Date;
	weaknesses: string[];
}> {
	return new Promise((resolve) => {
		const tls = require("tls") as typeof import("tls");
		const socket = tls.connect(
			{ host: hostname, port, servername: hostname, timeout: 8_000 },
			() => {
				const cert = socket.getPeerCertificate();
				const cipher = socket.getCipher();
				const certExpiry = cert.valid_to
					? new Date(cert.valid_to)
					: new Date(Date.now() + 365 * 86_400_000);
				const weaknesses: string[] = [];
				if (!socket.authorized) weaknesses.push("Certificate is not trusted");
				if (certExpiry < new Date()) weaknesses.push("Certificate has expired");
				socket.destroy();
				resolve({
					grade: gradeFromWeaknesses(weaknesses, "TLSv1.3"),
					protocol: "TLSv1.3",
					cipherSuites: [cipher?.name ?? "unknown"] as string[],
					certExpiry,
					weaknesses,
				});
			},
		);
		socket.on("error", () => {
			resolve({
				grade: "F",
				protocol: "unknown",
				cipherSuites: [],
				certExpiry: new Date(),
				weaknesses: ["TLS connection failed"],
			});
		});
	});
}

function gradeFromWeaknesses(
	weaknesses: string[],
	protocol: string,
): "A+" | "A" | "B" | "C" | "D" | "F" {
	if (["SSLv2", "SSLv3"].includes(protocol)) return "F";
	if (["TLSv1", "TLSv1.1"].includes(protocol)) return "D";
	if (
		weaknesses.some((w) => w.includes("expired") || w.includes("not trusted"))
	)
		return "C";
	if (
		weaknesses.some(
			(w) => w.includes("Weak cipher") || w.includes("deprecated"),
		)
	)
		return "B";
	if (weaknesses.length === 0 && protocol === "TLSv1.3") return "A+";
	if (weaknesses.length === 0) return "A";
	return "B";
}

// ─────────────────────────────────────────────────────────────────────────────
// Open redirect probe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tests a URL endpoint for open redirect vulnerabilities by injecting common redirect
 * payloads and tracking resulting Location headers.
 */
export async function probeOpenRedirects(
	url: string,
): Promise<{ vulnerable: boolean; payload?: string; redirectTarget?: string }> {
	const sentinel = "https://sentinel.setra.sh/redirect-test";
	const params = [
		"url",
		"next",
		"redirect",
		"return",
		"returnUrl",
		"redir",
		"goto",
		"target",
		"dest",
		"destination",
	];
	const base = new URL(url);

	for (const param of params) {
		base.searchParams.set(param, sentinel);
		try {
			const resp = await fetch(base.toString(), {
				method: "GET",
				redirect: "manual",
				signal: AbortSignal.timeout(6_000),
				headers: { "User-Agent": "Sentinel/1.0 Security Scanner (setra.sh)" },
			});
			const location = resp.headers.get("location") ?? "";
			if (
				resp.status >= 300 &&
				resp.status < 400 &&
				location.includes(sentinel)
			) {
				return {
					vulnerable: true,
					payload: `?${param}=${encodeURIComponent(sentinel)}`,
					redirectTarget: location,
				};
			}
		} catch {
			/* unreachable or timeout — continue */
		}
		base.searchParams.delete(param);
	}

	return { vulnerable: false };
}
