/**
 * Sentinel — Vulnerability intelligence tools.
 * Queries NVD, default-credential databases, npm audit, and custom secret scanners.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SecretFinding, SeverityLevel } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function spawnCollect(
	cmd: string,
	args: string[],
	timeoutMs = 30_000,
): Promise<{ stdout: string; code: number }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		const t = setTimeout(() => {
			proc.kill();
			reject(new Error("timeout"));
		}, timeoutMs);
		proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
		proc.on("close", (c) => {
			clearTimeout(t);
			resolve({ stdout, code: c ?? 1 });
		});
		proc.on("error", (e) => {
			clearTimeout(t);
			reject(e);
		});
	});
}

function cvssToSeverity(score: number): SeverityLevel {
	if (score >= 9.0) return "critical";
	if (score >= 7.0) return "high";
	if (score >= 4.0) return "medium";
	if (score > 0) return "low";
	return "info";
}

// ─────────────────────────────────────────────────────────────────────────────
// NVD CVE lookup
// ─────────────────────────────────────────────────────────────────────────────

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";

/**
 * Fetches detailed CVE information from the NVD 2.0 API.
 * Returns cached / mock data when the NVD is unreachable (offline operation).
 */
export async function lookupCve(cveId: string): Promise<{
	id: string;
	description: string;
	cvssScore: number;
	cvssVector: string;
	publishedDate: Date;
	lastModified: Date;
	references: string[];
	cpe: string[];
}> {
	try {
		const resp = await fetch(`${NVD_BASE}?cveId=${encodeURIComponent(cveId)}`, {
			signal: AbortSignal.timeout(10_000),
			headers: { "User-Agent": "Sentinel/1.0 (setra.sh security scanner)" },
		});
		if (!resp.ok) throw new Error(`NVD returned ${resp.status}`);
		const data = (await resp.json()) as NvdApiResponse;
		const vuln = data.vulnerabilities?.[0]?.cve;
		if (!vuln) throw new Error("CVE not found in NVD response");
		return mapNvdVuln(vuln);
	} catch {
		// Offline fallback — return structured placeholder so analysis continues
		return {
			id: cveId,
			description: `${cveId} — NVD data unavailable (offline mode). Verify manually at https://nvd.nist.gov/vuln/detail/${cveId}`,
			cvssScore: 0,
			cvssVector: "",
			publishedDate: new Date(0),
			lastModified: new Date(0),
			references: [`https://nvd.nist.gov/vuln/detail/${cveId}`],
			cpe: [],
		};
	}
}

interface NvdApiResponse {
	vulnerabilities?: Array<{
		cve: {
			id: string;
			descriptions: Array<{ lang: string; value: string }>;
			metrics?: {
				cvssMetricV31?: Array<{
					cvssData: { baseScore: number; vectorString: string };
				}>;
				cvssMetricV30?: Array<{
					cvssData: { baseScore: number; vectorString: string };
				}>;
				cvssMetricV2?: Array<{
					cvssData: { baseScore: number; vectorString: string };
				}>;
			};
			published: string;
			lastModified: string;
			references: Array<{ url: string }>;
			configurations?: Array<{
				nodes: Array<{ cpeMatch: Array<{ criteria: string }> }>;
			}>;
		};
	}>;
}

function mapNvdVuln(
	vuln: NonNullable<NvdApiResponse["vulnerabilities"]>[0]["cve"],
) {
	const desc = vuln.descriptions.find((d) => d.lang === "en")?.value ?? "";
	const m31 = vuln.metrics?.cvssMetricV31?.[0];
	const m30 = vuln.metrics?.cvssMetricV30?.[0];
	const m2 = vuln.metrics?.cvssMetricV2?.[0];
	const metric = m31 ?? m30 ?? m2;

	const cpe: string[] = [];
	for (const conf of vuln.configurations ?? []) {
		for (const node of conf.nodes ?? []) {
			for (const match of node.cpeMatch ?? []) {
				cpe.push(match.criteria);
			}
		}
	}

	return {
		id: vuln.id,
		description: desc,
		cvssScore: metric?.cvssData.baseScore ?? 0,
		cvssVector: metric?.cvssData.vectorString ?? "",
		publishedDate: new Date(vuln.published),
		lastModified: new Date(vuln.lastModified),
		references: vuln.references.map((r) => r.url),
		cpe,
	};
}

/**
 * Searches the NVD by keyword with optional result limit.
 */
export async function searchCveByKeyword(
	keyword: string,
	limit = 10,
): Promise<Array<{ id: string; score: number; description: string }>> {
	try {
		const url = `${NVD_BASE}?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=${limit}`;
		const resp = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
			headers: { "User-Agent": "Sentinel/1.0 (setra.sh security scanner)" },
		});
		if (!resp.ok) throw new Error(`NVD returned ${resp.status}`);
		const data = (await resp.json()) as NvdApiResponse;
		return (data.vulnerabilities ?? []).map(({ cve }) => {
			const m =
				cve.metrics?.cvssMetricV31?.[0] ??
				cve.metrics?.cvssMetricV30?.[0] ??
				cve.metrics?.cvssMetricV2?.[0];
			return {
				id: cve.id,
				score: m?.cvssData.baseScore ?? 0,
				description: cve.descriptions.find((d) => d.lang === "en")?.value ?? "",
			};
		});
	} catch {
		return [];
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Default credentials database
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CREDS: Record<
	string,
	Array<{ username: string; password: string; source: string }>
> = {
	mysql: [
		{ username: "root", password: "", source: "MySQL default install" },
		{ username: "root", password: "root", source: "Common misconfiguration" },
		{ username: "mysql", password: "mysql", source: "Vendor documentation" },
	],
	postgres: [
		{
			username: "postgres",
			password: "postgres",
			source: "PostgreSQL default",
		},
		{ username: "postgres", password: "", source: "Trust auth — no password" },
	],
	redis: [
		{ username: "", password: "", source: "Redis default — no auth" },
		{ username: "", password: "foobared", source: "Redis example config" },
	],
	mongodb: [
		{ username: "admin", password: "admin", source: "MongoDB common default" },
		{ username: "", password: "", source: "MongoDB pre-3.x — no auth" },
	],
	elasticsearch: [
		{
			username: "elastic",
			password: "changeme",
			source: "Elasticsearch bootstrap password",
		},
		{ username: "", password: "", source: "Elasticsearch pre-6.x — no auth" },
	],
	jenkins: [
		{
			username: "admin",
			password: "admin",
			source: "Jenkins wizard-skipped install",
		},
	],
	tomcat: [
		{ username: "tomcat", password: "tomcat", source: "Apache Tomcat default" },
		{ username: "admin", password: "admin", source: "Tomcat manager default" },
		{
			username: "manager",
			password: "manager",
			source: "Tomcat manager variant",
		},
	],
	grafana: [
		{ username: "admin", password: "admin", source: "Grafana default" },
	],
	rabbitmq: [
		{
			username: "guest",
			password: "guest",
			source: "RabbitMQ default — localhost only",
		},
	],
	minio: [
		{ username: "minioadmin", password: "minioadmin", source: "MinIO default" },
	],
	phpmyadmin: [
		{
			username: "root",
			password: "",
			source: "phpMyAdmin with MySQL trust auth",
		},
		{ username: "pma", password: "pmapass", source: "phpMyAdmin control user" },
	],
};

/**
 * Returns known default credentials for a service — awareness only, not exploitation.
 * Used to generate findings recommending credential hardening.
 */
export async function checkKnownDefaults(
	service: string,
	_version?: string,
): Promise<Array<{ username: string; password: string; source: string }>> {
	const key = service.toLowerCase().replace(/[^a-z0-9]/g, "");
	return DEFAULT_CREDS[key] ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency auditing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Audits a Node.js project for known vulnerable dependencies using npm audit.
 */
export async function auditDependencies(packageJsonPath: string): Promise<{
	total: number;
	vulnerable: number;
	findings: Array<{
		package: string;
		version: string;
		cveIds: string[];
		severity: SeverityLevel;
		fixedIn?: string;
	}>;
}> {
	const dir = path.dirname(path.resolve(packageJsonPath));

	try {
		const { stdout } = await spawnCollect("npm", ["audit", "--json"], 60_000);
		const audit = JSON.parse(stdout) as NpmAuditOutput;
		return parseNpmAudit(audit);
	} catch {
		// npm not available or no lock file — manual package.json check
		return manualPackageCheck(packageJsonPath);
	}
}

interface NpmAuditOutput {
	metadata?: { dependencies?: { total?: number } };
	vulnerabilities?: Record<
		string,
		{
			name: string;
			range: string;
			severity: string;
			via: Array<
				| string
				| { cves?: string[]; fixAvailable?: { version: string } | boolean }
			>;
			fixAvailable?: { version: string } | boolean;
		}
	>;
	auditReportVersion?: number;
}

function parseNpmAudit(audit: NpmAuditOutput) {
	const vulns = audit.vulnerabilities ?? {};
	const findings: Array<{
		package: string;
		version: string;
		cveIds: string[];
		severity: SeverityLevel;
		fixedIn?: string;
	}> = [];

	for (const [, v] of Object.entries(vulns)) {
		const cveIds: string[] = [];
		for (const via of v.via) {
			if (typeof via !== "string" && via.cves) cveIds.push(...via.cves);
		}
		const fixedIn =
			typeof v.fixAvailable === "object" ? v.fixAvailable.version : undefined;
		findings.push({
			package: v.name,
			version: v.range,
			cveIds,
			severity: nvdSeverityToLevel(v.severity),
			...(fixedIn !== undefined ? { fixedIn } : {}),
		});
	}

	const total =
		audit.metadata?.dependencies?.total ?? Object.keys(vulns).length;
	return { total, vulnerable: findings.length, findings };
}

function nvdSeverityToLevel(s: string): SeverityLevel {
	switch (s.toLowerCase()) {
		case "critical":
			return "critical";
		case "high":
			return "high";
		case "moderate":
			return "medium";
		case "low":
			return "low";
		default:
			return "info";
	}
}

async function manualPackageCheck(packageJsonPath: string) {
	try {
		const raw = await fs.readFile(packageJsonPath, "utf8");
		const pkg = JSON.parse(raw) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const all = { ...pkg.dependencies, ...pkg.devDependencies };
		const total = Object.keys(all).length;
		// Cannot check without network/npm; return structure with no findings
		return { total, vulnerable: 0, findings: [] };
	} catch {
		return { total: 0, vulnerable: 0, findings: [] };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret scanning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Original secret pattern definitions — covers 24 secret types.
 * Patterns are written from first principles, not imported from any external tool.
 */
const SECRET_PATTERNS: Array<{
	type: string;
	pattern: RegExp;
	severity: SeverityLevel;
}> = [
	// Cloud providers
	{
		type: "AWS_ACCESS_KEY",
		pattern: /\bAKI[A-Z0-9]{16,20}\b/,
		severity: "critical",
	},
	{
		type: "AWS_SECRET_KEY",
		pattern:
			/aws[_\-.]?secret[_\-.]?(?:access[_\-.]?)?key\s*[:=]\s*["']?([A-Za-z0-9\/+]{40})["']?/i,
		severity: "critical",
	},
	{
		type: "GCP_SERVICE_ACCOUNT",
		pattern: /"type"\s*:\s*"service_account"/,
		severity: "critical",
	},
	{
		type: "AZURE_CLIENT_SECRET",
		pattern:
			/azure[_\-.]?client[_\-.]?secret\s*[:=]\s*["']?([A-Za-z0-9~._\-]{32,})["']?/i,
		severity: "critical",
	},

	// Source control and CI/CD tokens
	{
		type: "GITHUB_TOKEN",
		pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/,
		severity: "critical",
	},
	{
		type: "GITLAB_TOKEN",
		pattern: /glpat-[A-Za-z0-9\-_]{20,}/,
		severity: "critical",
	},
	{
		type: "BITBUCKET_APP_PASSWORD",
		pattern:
			/bitbucket[_\-.]?(?:app[_\-.]?)?password\s*[:=]\s*["']?([A-Za-z0-9+\/]{20,})["']?/i,
		severity: "high",
	},

	// Payment processors
	{
		type: "STRIPE_SECRET_KEY",
		pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,99}/,
		severity: "critical",
	},
	{
		type: "STRIPE_PUBLISHABLE_KEY",
		pattern: /pk_(?:live|test)_[A-Za-z0-9]{24,99}/,
		severity: "medium",
	},
	{
		type: "PAYPAL_SECRET",
		pattern:
			/paypal[_\-.]?(?:client[_\-.]?)?secret\s*[:=]\s*["']?([A-Za-z0-9\-_]{32,})["']?/i,
		severity: "critical",
	},

	// Authentication
	{
		type: "JWT_SECRET",
		pattern:
			/jwt[_\-.]?secret\s*[:=]\s*["']?([A-Za-z0-9!@#$%^&*()_+\-=[\]{};:'",.<>?/\\|`~]{16,})["']?/i,
		severity: "high",
	},
	{
		type: "JWT_TOKEN",
		pattern: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]{20,}/,
		severity: "medium",
	},
	{
		type: "OAUTH_CLIENT_SECRET",
		pattern:
			/(?:oauth|client)[_\-.]?secret\s*[:=]\s*["']?([A-Za-z0-9\-_]{20,})["']?/i,
		severity: "high",
	},

	// Database connection strings
	{
		type: "DATABASE_URL",
		pattern:
			/(?:postgres|mysql|mongodb|redis|mssql|sqlite):\/\/[^:]+:[^@]+@[^\s"']+/i,
		severity: "critical",
	},
	{
		type: "CONNECTION_STRING",
		pattern:
			/(?:Data Source|Server|Initial Catalog|User Id|Password)\s*=[^;]+;[^;]*(?:Password|Pwd)\s*=\s*[^\s;]+/i,
		severity: "critical",
	},

	// Cryptographic material
	{
		type: "RSA_PRIVATE_KEY",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
		severity: "critical",
	},
	{
		type: "PGP_PRIVATE_KEY",
		pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/,
		severity: "critical",
	},
	{
		type: "CERTIFICATE_PRIVATE_KEY",
		pattern: /-----BEGIN PRIVATE KEY-----/,
		severity: "critical",
	},

	// API keys (generic and service-specific)
	{
		type: "SLACK_WEBHOOK",
		pattern:
			/https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
		severity: "high",
	},
	{
		type: "TWILIO_AUTH_TOKEN",
		pattern:
			/twilio[_\-.]?auth[_\-.]?token\s*[:=]\s*["']?([A-Za-z0-9]{32})["']?/i,
		severity: "high",
	},
	{
		type: "SENDGRID_API_KEY",
		pattern: /SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}/,
		severity: "high",
	},
	{
		type: "GENERIC_API_KEY",
		pattern: /api[_\-.]?key\s*[:=]\s*["']?([A-Za-z0-9\-_]{20,64})["']?/i,
		severity: "medium",
	},
	{
		type: "GENERIC_SECRET",
		pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*["']([^"'\s]{8,})["']/i,
		severity: "medium",
	},
	{
		type: "ENCRYPTION_KEY",
		pattern:
			/(?:encryption|aes)[_\-.]?key\s*[:=]\s*["']?([A-Fa-f0-9]{32,64})["']?/i,
		severity: "high",
	},
];

const IGNORED_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".ico",
	".svg",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".mp4",
	".mp3",
	".pdf",
	".zip",
	".gz",
	".tar",
	".lock",
	".sum",
]);

/**
 * Scans a directory tree for hardcoded secrets using original detection patterns.
 * Skips binary files, lockfiles, and common non-source assets.
 */
export async function scanSecrets(dirPath: string): Promise<SecretFinding[]> {
	const findings: SecretFinding[] = [];
	await walkDir(dirPath, async (filePath) => {
		const ext = path.extname(filePath).toLowerCase();
		if (IGNORED_EXTENSIONS.has(ext)) return;

		let content: string;
		try {
			content = await fs.readFile(filePath, "utf8");
		} catch {
			return;
		}

		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === undefined) continue;
			for (const { type, pattern, severity } of SECRET_PATTERNS) {
				if (pattern.test(line)) {
					const matchPreview = line.trim().slice(0, 80);
					findings.push({
						file: filePath,
						line: i + 1,
						type,
						pattern: pattern.source.slice(0, 60),
						severity,
						matchPreview,
					});
					break; // one finding per line is sufficient
				}
			}
		}
	});
	return findings;
}

async function walkDir(
	dir: string,
	fn: (file: string) => Promise<void>,
): Promise<void> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	const SKIP_DIRS = new Set([
		"node_modules",
		".git",
		"dist",
		"build",
		".next",
		"coverage",
		"__pycache__",
	]);
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) await walkDir(full, fn);
		} else if (e.isFile()) {
			await fn(full);
		}
	}
}

export { cvssToSeverity };
