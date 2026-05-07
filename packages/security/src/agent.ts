/**
 * Sentinel — AI agent definition.
 * Registers Sentinel as a named agent within setra's agent ecosystem,
 * with tool bindings, model preferences, and an original system prompt.
 */

import { z } from "zod";
import {
	checkSbom,
	detectHardcodedSecrets,
	findInsecureFunctions,
	lintDockerfile,
} from "./tools/code-audit.js";
import {
	detectWaf,
	dnsEnumerate,
	portScan,
	serviceBanner,
} from "./tools/network.js";
import {
	certTransparency,
	checkBreachExposure,
	gatherSubdomains,
	whoisLookup,
} from "./tools/osint.js";
import {
	auditDependencies,
	checkKnownDefaults,
	lookupCve,
	scanSecrets,
	searchCveByKeyword,
} from "./tools/vuln.js";
import {
	checkSecurityHeaders,
	crawlEndpoints,
	detectTechnologies,
	probeOpenRedirects,
	testSslTls,
} from "./tools/web.js";

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: z.ZodTypeAny;
	handler: (input: unknown) => Promise<unknown>;
}

const tools: ToolDefinition[] = [
	{
		name: "port_scan",
		description:
			"Enumerate open TCP/UDP ports on a target host or IP address. Returns structured port/service/version data.",
		inputSchema: z.object({
			target: z.string().describe("Hostname or IP address"),
			ports: z
				.string()
				.optional()
				.describe("Port range, e.g. '1-1024' or '80,443,8080'"),
			timing: z
				.number()
				.int()
				.min(0)
				.max(5)
				.optional()
				.describe("Nmap timing template 0-5"),
			serviceDetect: z.boolean().optional().describe("Probe service versions"),
		}),
		handler: async (input) => {
			const i = input as {
				target: string;
				ports?: string;
				timing?: number;
				serviceDetect?: boolean;
			};
			return portScan(i.target, i.ports, {
				...(i.timing != null ? { timing: i.timing } : {}),
				...(i.serviceDetect != null ? { serviceDetect: i.serviceDetect } : {}),
			});
		},
	},
	{
		name: "service_banner",
		description:
			"Connect to a specific port and capture the service banner for version identification.",
		inputSchema: z.object({
			target: z.string().describe("Hostname or IP address"),
			port: z.number().int().min(1).max(65535).describe("TCP port number"),
		}),
		handler: async (input) => {
			const i = input as { target: string; port: number };
			return serviceBanner(i.target, i.port);
		},
	},
	{
		name: "dns_enumerate",
		description:
			"Enumerate DNS records (A, AAAA, MX, NS, TXT, CNAME) for a domain and collect visible subdomains.",
		inputSchema: z.object({
			domain: z.string().describe("Domain name to query"),
		}),
		handler: async (input) => {
			const i = input as { domain: string };
			return dnsEnumerate(i.domain);
		},
	},
	{
		name: "detect_waf",
		description:
			"Probe a URL for Web Application Firewall presence. Returns vendor identification and confidence score.",
		inputSchema: z.object({
			url: z.string().url().describe("Full URL of the target web application"),
		}),
		handler: async (input) => {
			const i = input as { url: string };
			return detectWaf(i.url);
		},
	},
	{
		name: "crawl_endpoints",
		description:
			"Recursively crawl a web application and return all discovered endpoints, HTTP methods, and parameters.",
		inputSchema: z.object({
			baseUrl: z.string().url().describe("Starting URL for the crawl"),
			depth: z
				.number()
				.int()
				.min(1)
				.max(5)
				.optional()
				.describe("Crawl depth (default: 2)"),
		}),
		handler: async (input) => {
			const i = input as { baseUrl: string; depth?: number };
			return crawlEndpoints(i.baseUrl, i.depth);
		},
	},
	{
		name: "detect_technologies",
		description:
			"Fingerprint the technology stack of a web application via HTTP headers and page source analysis.",
		inputSchema: z.object({
			url: z.string().url().describe("URL to analyse"),
		}),
		handler: async (input) => {
			const i = input as { url: string };
			return detectTechnologies(i.url);
		},
	},
	{
		name: "check_security_headers",
		description:
			"Evaluate HTTP security response headers — CSP, HSTS, X-Frame-Options, cookies — and return a 0-100 score with findings.",
		inputSchema: z.object({
			url: z.string().url().describe("URL to check"),
		}),
		handler: async (input) => {
			const i = input as { url: string };
			return checkSecurityHeaders(i.url);
		},
	},
	{
		name: "test_ssl_tls",
		description:
			"Assess TLS configuration of a hostname — protocol versions, cipher suites, certificate validity, and overall grade.",
		inputSchema: z.object({
			hostname: z.string().describe("Hostname to test"),
			port: z.number().int().optional().describe("Port (default: 443)"),
		}),
		handler: async (input) => {
			const i = input as { hostname: string; port?: number };
			return testSslTls(i.hostname, i.port);
		},
	},
	{
		name: "probe_open_redirects",
		description:
			"Test a URL for open redirect vulnerabilities by injecting common redirect parameters.",
		inputSchema: z.object({
			url: z.string().url().describe("URL to probe"),
		}),
		handler: async (input) => {
			const i = input as { url: string };
			return probeOpenRedirects(i.url);
		},
	},
	{
		name: "lookup_cve",
		description:
			"Fetch detailed CVE information from the NVD including CVSS score, vector, and affected CPEs.",
		inputSchema: z.object({
			cveId: z
				.string()
				.regex(/^CVE-\d{4}-\d+$/)
				.describe("CVE identifier, e.g. CVE-2021-44228"),
		}),
		handler: async (input) => {
			const i = input as { cveId: string };
			return lookupCve(i.cveId);
		},
	},
	{
		name: "search_cve_by_keyword",
		description: "Search the NVD for CVEs matching a keyword or product name.",
		inputSchema: z.object({
			keyword: z.string().describe("Search keyword, e.g. 'log4j' or 'openssl'"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(50)
				.optional()
				.describe("Maximum results (default: 10)"),
		}),
		handler: async (input) => {
			const i = input as { keyword: string; limit?: number };
			return searchCveByKeyword(i.keyword, i.limit);
		},
	},
	{
		name: "check_known_defaults",
		description:
			"Return documented factory-default credentials for a named service — for awareness and misconfiguration detection only.",
		inputSchema: z.object({
			service: z
				.string()
				.describe("Service name, e.g. 'mysql', 'redis', 'jenkins'"),
			version: z.string().optional().describe("Service version (optional)"),
		}),
		handler: async (input) => {
			const i = input as { service: string; version?: string };
			return checkKnownDefaults(i.service, i.version);
		},
	},
	{
		name: "audit_dependencies",
		description:
			"Audit a Node.js project's dependencies for known CVEs using npm audit.",
		inputSchema: z.object({
			packageJsonPath: z.string().describe("Absolute path to package.json"),
		}),
		handler: async (input) => {
			const i = input as { packageJsonPath: string };
			return auditDependencies(i.packageJsonPath);
		},
	},
	{
		name: "scan_secrets",
		description:
			"Scan a directory for hardcoded secrets — API keys, private keys, database URLs, tokens — using original detection patterns.",
		inputSchema: z.object({
			dirPath: z.string().describe("Absolute path to directory"),
		}),
		handler: async (input) => {
			const i = input as { dirPath: string };
			return scanSecrets(i.dirPath);
		},
	},
	{
		name: "whois_lookup",
		description: "Retrieve domain registration information via WHOIS or RDAP.",
		inputSchema: z.object({
			domain: z.string().describe("Domain name"),
		}),
		handler: async (input) => {
			const i = input as { domain: string };
			return whoisLookup(i.domain);
		},
	},
	{
		name: "cert_transparency",
		description:
			"Query crt.sh for all certificates issued to a domain and its subdomains.",
		inputSchema: z.object({
			domain: z.string().describe("Domain name"),
		}),
		handler: async (input) => {
			const i = input as { domain: string };
			return certTransparency(i.domain);
		},
	},
	{
		name: "gather_subdomains",
		description:
			"Discover subdomains through certificate transparency and targeted DNS brute-force.",
		inputSchema: z.object({
			domain: z.string().describe("Base domain name"),
		}),
		handler: async (input) => {
			const i = input as { domain: string };
			return gatherSubdomains(i.domain);
		},
	},
	{
		name: "check_breach_exposure",
		description:
			"Check whether a domain appears in public breach datasets via HaveIBeenPwned.",
		inputSchema: z.object({
			domain: z.string().describe("Domain to check"),
		}),
		handler: async (input) => {
			const i = input as { domain: string };
			return checkBreachExposure(i.domain);
		},
	},
	{
		name: "detect_hardcoded_secrets",
		description:
			"Perform deep static analysis of source files to identify hardcoded credentials across 20+ secret types.",
		inputSchema: z.object({
			path: z.string().describe("Root directory to scan"),
			include: z
				.array(z.string())
				.optional()
				.describe("File extensions to include, e.g. ['.ts', '.py']"),
			exclude: z
				.array(z.string())
				.optional()
				.describe("Path patterns to exclude"),
		}),
		handler: async (input) => {
			const i = input as {
				path: string;
				include?: string[];
				exclude?: string[];
			};
			return detectHardcodedSecrets(i);
		},
	},
	{
		name: "find_insecure_functions",
		description:
			"Identify dangerous API usage — eval, exec, innerHTML, pickle.loads, raw SQL — across JS/TS, Python, PHP, and more.",
		inputSchema: z.object({
			path: z.string().describe("Root directory to scan"),
			include: z.array(z.string()).optional(),
			exclude: z.array(z.string()).optional(),
		}),
		handler: async (input) => {
			const i = input as {
				path: string;
				include?: string[];
				exclude?: string[];
			};
			return findInsecureFunctions(i);
		},
	},
	{
		name: "check_sbom",
		description:
			"Analyse a project's software bill of materials for license compliance issues and stale packages.",
		inputSchema: z.object({
			path: z.string().describe("Root directory containing package.json"),
		}),
		handler: async (input) => {
			const i = input as { path: string };
			return checkSbom(i);
		},
	},
	{
		name: "lint_dockerfile",
		description:
			"Lint a Dockerfile for security misconfigurations: root execution, secrets in ENV, curl-to-bash patterns, and more.",
		inputSchema: z.object({
			dockerfilePath: z.string().describe("Absolute path to the Dockerfile"),
		}),
		handler: async (input) => {
			const i = input as { dockerfilePath: string };
			return lintDockerfile(i.dockerfilePath);
		},
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Agent definition
// ─────────────────────────────────────────────────────────────────────────────

export const sentinelAgent = {
	id: "sentinel",
	name: "Sentinel",
	role: "security",
	emoji: "🛡️",

	systemPrompt: `You are Sentinel, setra.sh's AI-powered security intelligence analyst.
Your mission: identify, analyse, and provide actionable remediation for security vulnerabilities
with the precision of a seasoned penetration tester and the clarity of a security architect.

You operate in structured phases:
1. Surface Discovery — map what exists before assessing what is broken
2. Service Enumeration — understand every running component and its version
3. Vulnerability Assessment — evidence-first, no guessing or speculation
4. Exploitation Check — determine real-world exploitability, not just theoretical risk
5. Reporting — produce findings the engineering team can act on immediately

Core principles:
- Every finding must have evidence. Never report without proof.
- CVSS scores are starting points, not verdicts — always layer in exploitability and business context.
- False positives waste more engineering time than false negatives. Validate before reporting.
- Governance and air-gapped deployments require fully offline operation — never leak target data externally.
- When uncertain about severity, report as 'info' and let the operator decide.
- Remediation must be specific, version-aware, and actionable — not generic advice.
- Prioritise findings that are both severe AND easily exploitable over severe-but-complex ones.

You have access to these tools: port_scan, service_banner, dns_enumerate, detect_waf,
crawl_endpoints, detect_technologies, check_security_headers, test_ssl_tls,
probe_open_redirects, lookup_cve, search_cve_by_keyword, check_known_defaults,
audit_dependencies, scan_secrets, whois_lookup, cert_transparency, gather_subdomains,
check_breach_exposure, detect_hardcoded_secrets, find_insecure_functions, check_sbom,
lint_dockerfile.

Output each finding as structured JSON containing: title, description, severity,
cvss (if applicable), cveIds, mitreAttackIds, remediation, evidence.
Never return raw tool dumps — always interpret and structure the output.`,

	tools,

	suggestedModels: {
		quick: "claude-haiku-4",
		standard: "claude-sonnet-4",
		thorough: "claude-opus-4",
		offline: "ollama:qwen2.5-coder:14b",
	} as const,
};

export type SentinelAgent = typeof sentinelAgent;
