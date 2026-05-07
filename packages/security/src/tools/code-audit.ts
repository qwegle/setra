/**
 * Sentinel — Static code analysis and supply chain security tools.
 * Scans source trees for hardcoded secrets, dangerous function usage,
 * software bill-of-materials issues, and Dockerfile misconfigurations.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SecretFinding, SeverityLevel } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditOptions {
	path: string;
	include?: string[];
	exclude?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// File system helpers
// ─────────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".nuxt",
	"coverage",
	"__pycache__",
	".tox",
	"venv",
	".venv",
]);

async function* walkFiles(
	dir: string,
	opts: AuditOptions,
): AsyncGenerator<string> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const e of entries) {
		const full = path.join(dir, e.name);
		const rel = path.relative(opts.path, full);

		if (opts.exclude?.some((pat) => rel.includes(pat))) continue;

		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) yield* walkFiles(full, opts);
		} else if (e.isFile()) {
			if (opts.include && !opts.include.some((ext) => full.endsWith(ext)))
				continue;
			yield full;
		}
	}
}

async function readTextFile(filePath: string): Promise<string | null> {
	try {
		const buf = await fs.readFile(filePath);
		// Skip binary files by checking for null bytes in the first 512 bytes
		const sample = buf.slice(0, 512);
		for (const byte of sample) {
			if (byte === 0) return null;
		}
		return buf.toString("utf8");
	} catch {
		return null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hardcoded secret detection
// ─────────────────────────────────────────────────────────────────────────────

const HARDCODED_PATTERNS: Array<{
	type: string;
	pattern: RegExp;
	severity: SeverityLevel;
}> = [
	// Cloud credentials
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
		type: "AZURE_CONN_STRING",
		pattern:
			/DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+\/=]{60,}/,
		severity: "critical",
	},
	{
		type: "GCP_SERVICE_ACCOUNT",
		pattern: /"type"\s*:\s*"service_account"/,
		severity: "critical",
	},

	// Source control tokens
	{ type: "GITHUB_PAT", pattern: /ghp_[A-Za-z0-9]{36}/, severity: "critical" },
	{
		type: "GITHUB_OAUTH_TOKEN",
		pattern: /gho_[A-Za-z0-9]{36}/,
		severity: "critical",
	},
	{
		type: "GITHUB_APP_TOKEN",
		pattern: /ghs_[A-Za-z0-9]{36}/,
		severity: "critical",
	},
	{
		type: "GITLAB_TOKEN",
		pattern: /glpat-[A-Za-z0-9\-_]{20,}/,
		severity: "critical",
	},
	{
		type: "NPM_AUTH_TOKEN",
		pattern: /\/\/registry\.npmjs\.org\/:_authToken=([A-Za-z0-9\-_.]+)/,
		severity: "high",
	},

	// Payment & communication APIs
	{
		type: "STRIPE_SECRET",
		pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,99}/,
		severity: "critical",
	},
	{
		type: "SENDGRID_KEY",
		pattern: /SG\.[A-Za-z0-9\-_]{22}\.[A-Za-z0-9\-_]{43}/,
		severity: "high",
	},
	{ type: "TWILIO_SID", pattern: /AC[a-f0-9]{32}/, severity: "high" },
	{
		type: "TWILIO_AUTH",
		pattern: /twilio[_\-.]?auth[_\-.]?token\s*[:=]\s*["']?([a-f0-9]{32})["']?/i,
		severity: "high",
	},
	{
		type: "SLACK_TOKEN",
		pattern: /xox[bpoa]-[0-9]+-[0-9]+-[A-Za-z0-9]+/,
		severity: "high",
	},
	{
		type: "SLACK_WEBHOOK",
		pattern:
			/https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
		severity: "high",
	},

	// Cryptographic material
	{
		type: "RSA_PRIVATE_KEY",
		pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
		severity: "critical",
	},
	{
		type: "EC_PRIVATE_KEY",
		pattern: /-----BEGIN EC PRIVATE KEY-----/,
		severity: "critical",
	},
	{
		type: "OPENSSH_PRIVATE_KEY",
		pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/,
		severity: "critical",
	},
	{
		type: "PGP_PRIVATE_KEY",
		pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/,
		severity: "critical",
	},

	// Database URLs
	{
		type: "DATABASE_URL",
		pattern:
			/(?:postgres|mysql|mongodb(?:\+srv)?|redis|mssql):\/\/[^:]+:[^@\s"']+@[^\s"']+/i,
		severity: "critical",
	},

	// Authentication secrets
	{
		type: "JWT_SECRET",
		pattern: /jwt[_\-.]?secret\s*[:=]\s*["']([^"'\s]{16,})["']/i,
		severity: "high",
	},
	{
		type: "SESSION_SECRET",
		pattern: /session[_\-.]?secret\s*[:=]\s*["']([^"'\s]{16,})["']/i,
		severity: "high",
	},
	{
		type: "GENERIC_PASSWORD",
		pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']([^"'\s]{8,})["']/i,
		severity: "medium",
	},
];

/**
 * Scans source files for hardcoded credentials and secrets using original detection patterns.
 */
export async function detectHardcodedSecrets(
	opts: AuditOptions,
): Promise<SecretFinding[]> {
	const findings: SecretFinding[] = [];

	for await (const filePath of walkFiles(opts.path, opts)) {
		const content = await readTextFile(filePath);
		if (!content) continue;

		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line == null) continue;
			// Skip obvious test fixtures and placeholder values
			if (
				/(?:example|placeholder|your[_\-]?key|changeme|xxxx|todo)/i.test(line)
			)
				continue;

			for (const { type, pattern, severity } of HARDCODED_PATTERNS) {
				if (pattern.test(line)) {
					findings.push({
						file: filePath,
						line: i + 1,
						type,
						pattern: pattern.source.slice(0, 60),
						severity,
						matchPreview: line.trim().slice(0, 100),
					});
					break;
				}
			}
		}
	}

	return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insecure function detection
// ─────────────────────────────────────────────────────────────────────────────

interface InsecureFunction {
	file: string;
	line: number;
	function: string;
	language: string;
	reason: string;
	severity: SeverityLevel;
}

type LanguageRule = {
	language: string;
	extensions: string[];
	rules: Array<{
		name: string;
		pattern: RegExp;
		reason: string;
		severity: SeverityLevel;
	}>;
};

const LANGUAGE_RULES: LanguageRule[] = [
	{
		language: "JavaScript/TypeScript",
		extensions: [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"],
		rules: [
			{
				name: "eval()",
				pattern: /\beval\s*\(/,
				reason:
					"Executes arbitrary code from a string — critical remote code execution vector.",
				severity: "critical",
			},
			{
				name: "new Function()",
				pattern: /\bnew\s+Function\s*\(/,
				reason:
					"Constructs a function from a string — equivalent to eval() in risk.",
				severity: "critical",
			},
			{
				name: "innerHTML assignment",
				pattern: /\.innerHTML\s*=(?!=)/,
				reason:
					"Direct HTML injection without sanitisation enables DOM-based XSS.",
				severity: "high",
			},
			{
				name: "outerHTML assignment",
				pattern: /\.outerHTML\s*=(?!=)/,
				reason: "Replaces element HTML without sanitisation — XSS risk.",
				severity: "high",
			},
			{
				name: "dangerouslySetInnerHTML",
				pattern: /dangerouslySetInnerHTML\s*=\s*\{/,
				reason:
					"React's escape hatch for raw HTML — verify content is sanitised before use.",
				severity: "high",
			},
			{
				name: "document.write()",
				pattern: /document\.write\s*\(/,
				reason: "Injects raw HTML into the document — XSS and injection risk.",
				severity: "medium",
			},
			{
				name: "setTimeout(string)",
				pattern: /setTimeout\s*\(\s*["'`]/,
				reason:
					"Passing a string to setTimeout evaluates it — equivalent to eval().",
				severity: "high",
			},
			{
				name: "setInterval(string)",
				pattern: /setInterval\s*\(\s*["'`]/,
				reason:
					"Passing a string to setInterval evaluates it — equivalent to eval().",
				severity: "high",
			},
			{
				name: "child_process exec shell",
				pattern: /exec\s*\([^)]*,\s*\{[^}]*shell\s*:\s*true/,
				reason:
					"Shell execution enabled — command injection possible if args contain user input.",
				severity: "high",
			},
		],
	},
	{
		language: "Python",
		extensions: [".py"],
		rules: [
			{
				name: "exec()",
				pattern: /\bexec\s*\(/,
				reason:
					"Executes arbitrary Python code from a string — remote code execution risk.",
				severity: "critical",
			},
			{
				name: "eval()",
				pattern: /\beval\s*\(/,
				reason:
					"Evaluates a Python expression from a string — code injection risk.",
				severity: "critical",
			},
			{
				name: "pickle.loads()",
				pattern: /pickle\.loads\s*\(/,
				reason:
					"Deserialises arbitrary Python objects — enables code execution on untrusted data.",
				severity: "critical",
			},
			{
				name: "subprocess shell=True",
				pattern: /subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True/,
				reason: "Shell metacharacters in arguments lead to command injection.",
				severity: "high",
			},
			{
				name: "os.system()",
				pattern: /\bos\.system\s*\(/,
				reason:
					"Passes a string to the shell — command injection if input is not sanitised.",
				severity: "high",
			},
			{
				name: "yaml.load() without Loader",
				pattern: /yaml\.load\s*\([^,)]+\)(?!\s*,)/,
				reason:
					"PyYAML's unsafe loader can execute arbitrary Python objects — use yaml.safe_load().",
				severity: "high",
			},
			{
				name: "marshal.loads()",
				pattern: /marshal\.loads\s*\(/,
				reason:
					"Deserialises Python bytecode — can execute arbitrary code on untrusted input.",
				severity: "critical",
			},
		],
	},
	{
		language: "SQL (inline concatenation)",
		extensions: [".py", ".js", ".ts", ".java", ".php", ".rb", ".go"],
		rules: [
			{
				name: "SQL string concatenation",
				pattern:
					/(?:SELECT|INSERT|UPDATE|DELETE)\s+.*\+\s*(?:req\.|request\.|params\.|input\.|user|query|body)/,
				reason:
					"User-controlled data concatenated into SQL — SQL injection risk.",
				severity: "critical",
			},
			{
				name: "raw SQL format string (Python)",
				pattern: /cursor\.execute\s*\(\s*[f"'].*%s/,
				reason:
					"SQL query built with % formatting — prefer parameterised queries.",
				severity: "high",
			},
		],
	},
	{
		language: "PHP",
		extensions: [".php"],
		rules: [
			{
				name: "shell_exec()",
				pattern: /\bshell_exec\s*\(/,
				reason:
					"Executes shell commands — remote code execution if input is unsanitised.",
				severity: "critical",
			},
			{
				name: "system()",
				pattern: /\bsystem\s*\(/,
				reason: "Passes a string to the shell — command injection risk.",
				severity: "critical",
			},
			{
				name: "preg_replace /e modifier",
				pattern: /preg_replace\s*\(\s*['"].*\/e/,
				reason:
					"The /e modifier evaluates the replacement as PHP code — remote code execution.",
				severity: "critical",
			},
			{
				name: "unserialize()",
				pattern: /\bunserialize\s*\(/,
				reason:
					"Deserialises PHP objects — object injection and code execution on untrusted input.",
				severity: "high",
			},
		],
	},
];

/**
 * Identifies dangerous function usage across multiple languages using original rule sets.
 */
export async function findInsecureFunctions(
	opts: AuditOptions,
): Promise<InsecureFunction[]> {
	const findings: InsecureFunction[] = [];

	for await (const filePath of walkFiles(opts.path, opts)) {
		const ext = path.extname(filePath).toLowerCase();
		const content = await readTextFile(filePath);
		if (!content) continue;

		const lines = content.split("\n");
		for (const langRule of LANGUAGE_RULES) {
			if (!langRule.extensions.includes(ext)) continue;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line == null) continue;
				if (line.trim().startsWith("//") || line.trim().startsWith("#"))
					continue; // skip comments
				for (const rule of langRule.rules) {
					if (rule.pattern.test(line)) {
						findings.push({
							file: filePath,
							line: i + 1,
							function: rule.name,
							language: langRule.language,
							reason: rule.reason,
							severity: rule.severity,
						});
					}
				}
			}
		}
	}

	return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// SBOM and dependency analysis
// ─────────────────────────────────────────────────────────────────────────────

interface SbomResult {
	totalPackages: number;
	licenseIssues: Array<{ pkg: string; license: string; risk: string }>;
	outdatedPackages: Array<{
		pkg: string;
		current: string;
		latest: string;
		daysBehind: number;
	}>;
}

const RISKY_LICENSES = new Set([
	"GPL-2.0",
	"GPL-3.0",
	"AGPL-3.0",
	"LGPL-2.0",
	"LGPL-2.1",
	"LGPL-3.0",
	"CDDL-1.0",
	"EUPL-1.1",
	"OSL-3.0",
]);

/**
 * Analyses a project's dependency manifest for license compliance issues
 * and stale packages. Queries npm registry for latest versions.
 */
export async function checkSbom(opts: AuditOptions): Promise<SbomResult> {
	const pkgPath = path.join(opts.path, "package.json");
	let raw: string;
	try {
		raw = await fs.readFile(pkgPath, "utf8");
	} catch {
		return { totalPackages: 0, licenseIssues: [], outdatedPackages: [] };
	}

	const pkg = JSON.parse(raw) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const all = { ...pkg.dependencies, ...pkg.devDependencies };
	const totalPackages = Object.keys(all).length;

	const licenseIssues: SbomResult["licenseIssues"] = [];
	const outdatedPackages: SbomResult["outdatedPackages"] = [];

	const BATCH = 5;
	const entries = Object.entries(all);
	for (let i = 0; i < entries.length; i += BATCH) {
		const batch = entries.slice(i, i + BATCH);
		await Promise.allSettled(
			batch.map(async ([name, specifier]) => {
				const current = specifier.replace(/^[^0-9]*/, "");
				try {
					const resp = await fetch(
						`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
						{
							signal: AbortSignal.timeout(5_000),
							headers: { Accept: "application/json" },
						},
					);
					if (!resp.ok) return;
					const meta = (await resp.json()) as {
						version: string;
						license?: string;
						time?: string;
					};

					if (meta.license && RISKY_LICENSES.has(meta.license)) {
						licenseIssues.push({
							pkg: name,
							license: meta.license,
							risk: "Copyleft — may impose distribution obligations",
						});
					}

					const latest = meta.version;
					if (
						latest &&
						current &&
						latest !== current &&
						isSemanticNewer(latest, current)
					) {
						const pubDate = meta.time ? new Date(meta.time) : new Date();
						const daysBehind = Math.floor(
							(Date.now() - pubDate.getTime()) / 86_400_000,
						);
						if (daysBehind > 30) {
							outdatedPackages.push({ pkg: name, current, latest, daysBehind });
						}
					}
				} catch {
					/* network unavailable — skip */
				}
			}),
		);
	}

	return { totalPackages, licenseIssues, outdatedPackages };
}

function isSemanticNewer(latest: string, current: string): boolean {
	const parse = (v: string) =>
		v.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const [lMaj = 0, lMin = 0, lPatch = 0] = parse(latest);
	const [cMaj = 0, cMin = 0, cPatch = 0] = parse(current);
	if (lMaj !== cMaj) return lMaj > cMaj;
	if (lMin !== cMin) return lMin > cMin;
	return lPatch > cPatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dockerfile linting
// ─────────────────────────────────────────────────────────────────────────────

interface DockerFinding {
	line: number;
	rule: string;
	severity: SeverityLevel;
	message: string;
}

const DOCKERFILE_RULES: Array<{
	id: string;
	severity: SeverityLevel;
	pattern: RegExp;
	message: string;
	lineFilter?: RegExp;
}> = [
	{
		id: "DF001",
		severity: "high",
		pattern: /^USER\s+root\b/i,
		message:
			"Container runs as root — use a non-privileged user (e.g., USER 1000).",
	},
	{
		id: "DF002",
		severity: "medium",
		pattern: /^FROM\s+\S+:latest\b/i,
		message:
			"Using ':latest' tag prevents reproducible builds — pin to a specific version digest.",
	},
	{
		id: "DF003",
		severity: "critical",
		pattern: /ENV\s+\S*(?:PASSWORD|SECRET|KEY|TOKEN)\s*=\s*\S+/i,
		message:
			"Secret value baked into ENV instruction — use runtime secrets or ARG at build time only.",
	},
	{
		id: "DF004",
		severity: "critical",
		pattern: /ARG\s+\S*(?:PASSWORD|SECRET|KEY|TOKEN)\s*=/i,
		message:
			"Secret ARG value may appear in image history — use Docker secrets or external vault.",
	},
	{
		id: "DF005",
		severity: "high",
		pattern: /curl\s+.*\s*\|\s*(?:bash|sh)/i,
		message:
			"Piping curl output directly into a shell is a supply chain attack vector.",
	},
	{
		id: "DF006",
		severity: "high",
		pattern: /wget\s+.*\s*\|\s*(?:bash|sh)/i,
		message:
			"Piping wget output directly into a shell is a supply chain attack vector.",
	},
	{
		id: "DF007",
		severity: "medium",
		pattern: /^ADD\s+(?!https?:\/\/)/i,
		message:
			"Prefer COPY over ADD for local files — ADD silently extracts archives and has broader scope.",
	},
	{
		id: "DF008",
		severity: "medium",
		pattern: /--no-check-certificate|--insecure/i,
		message:
			"TLS certificate verification disabled — man-in-the-middle attack possible.",
	},
	{
		id: "DF009",
		severity: "low",
		pattern: /apt-get install(?!.*--no-install-recommends)/i,
		message:
			"Add --no-install-recommends to reduce image attack surface and size.",
	},
	{
		id: "DF010",
		severity: "low",
		pattern: /^EXPOSE\s+22\b/i,
		message:
			"Exposing SSH port 22 — strongly discourage SSH in containers; use exec or orchestrator features.",
	},
	{
		id: "DF011",
		severity: "medium",
		pattern: /chmod\s+(?:777|a\+x|ugo\+rwx)/i,
		message:
			"Overly permissive chmod — restrict to minimum necessary permissions.",
	},
	{
		id: "DF012",
		severity: "low",
		pattern: /^MAINTAINER\s/i,
		message: "MAINTAINER is deprecated — use LABEL maintainer= instead.",
	},
];

/**
 * Lints a Dockerfile against Sentinel's original security rule set.
 */
export async function lintDockerfile(
	dockerfilePath: string,
): Promise<DockerFinding[]> {
	let content: string;
	try {
		content = await fs.readFile(dockerfilePath, "utf8");
	} catch {
		return [
			{
				line: 0,
				rule: "IO_ERROR",
				severity: "info",
				message: `Cannot read Dockerfile: ${dockerfilePath}`,
			},
		];
	}

	const findings: DockerFinding[] = [];
	const lines = content.split("\n");

	// Track whether a non-root USER was set
	let hasNonRootUser = false;
	for (const line of lines) {
		const m = line.match(/^USER\s+(\S+)/i);
		if (m && m[1] !== "root" && m[1] !== "0") hasNonRootUser = true;
	}

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line == null) continue;
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		for (const rule of DOCKERFILE_RULES) {
			if (rule.pattern.test(line)) {
				findings.push({
					line: i + 1,
					rule: rule.id,
					severity: rule.severity,
					message: rule.message,
				});
			}
		}
	}

	// Holistic check: no USER instruction means running as root
	if (!hasNonRootUser) {
		findings.push({
			line: 0,
			rule: "DF013",
			severity: "high",
			message:
				"No USER instruction found — container defaults to root. Add 'USER nonroot' before CMD/ENTRYPOINT.",
		});
	}

	return findings;
}
