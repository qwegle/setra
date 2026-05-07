/**
 * Sentinel — Structured pentest playbooks.
 * Pre-built methodologies for web apps, infrastructure, code review,
 * and on-premise governance audits. Written in setra's voice.
 */

import type { Playbook } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Playbook registry
// ─────────────────────────────────────────────────────────────────────────────

export const PLAYBOOKS: Record<string, Playbook> = {
	"web-app": {
		id: "web-app",
		name: "Web Application Assessment",
		description:
			"A comprehensive security evaluation of web applications following the OWASP Web Security Testing Guide. " +
			"Covers the full attack surface from external reconnaissance through session management and access control.",
		methodology: "OWASP-WSTG",
		steps: [
			{
				id: "recon",
				name: "Target Reconnaissance",
				description:
					"Gather publicly available information about the target: WHOIS registration, DNS records, " +
					"SSL certificate transparency logs, and subdomain enumeration before any direct interaction.",
				phase: "surface-discovery",
				toolName: "osint",
				requiredCapabilities: ["dns", "whois", "cert-transparency"],
				estimatedMinutes: 5,
			},
			{
				id: "tech-fingerprint",
				name: "Technology Fingerprinting",
				description:
					"Identify the web server, application framework, JavaScript libraries, CDN, and CMS by " +
					"analysing HTTP response headers, page source, and cookie names.",
				phase: "surface-discovery",
				toolName: "detect_technologies",
				requiredCapabilities: ["http"],
				estimatedMinutes: 3,
			},
			{
				id: "endpoint-crawl",
				name: "Endpoint Mapping",
				description:
					"Recursively crawl the application to enumerate all reachable URLs, form actions, API paths, " +
					"and query parameters. Respects robots.txt while building a complete attack surface map.",
				phase: "surface-discovery",
				toolName: "crawl_endpoints",
				requiredCapabilities: ["http"],
				estimatedMinutes: 10,
			},
			{
				id: "auth-test",
				name: "Authentication Mechanism Analysis",
				description:
					"Evaluate the authentication subsystem for weaknesses: default credentials, lack of MFA, " +
					"account enumeration via error message differences, and insecure password reset flows.",
				phase: "vulnerability-assessment",
				toolName: "check_known_defaults",
				requiredCapabilities: ["http"],
				estimatedMinutes: 8,
			},
			{
				id: "input-validation",
				name: "Input Handling Assessment",
				description:
					"Test all identified parameters for injection flaws — SQL injection, reflected and stored XSS, " +
					"SSTI, and path traversal — by submitting characteristically malformed inputs and observing responses.",
				phase: "vulnerability-assessment",
				toolName: "crawl_endpoints",
				requiredCapabilities: ["http"],
				estimatedMinutes: 15,
			},
			{
				id: "session-test",
				name: "Session State Verification",
				description:
					"Inspect session token entropy, cookie flags (HttpOnly, Secure, SameSite), session fixation " +
					"exposure, and CSRF protection posture across authenticated workflows.",
				phase: "vulnerability-assessment",
				toolName: "check_security_headers",
				requiredCapabilities: ["http"],
				estimatedMinutes: 6,
			},
			{
				id: "access-control",
				name: "Privilege Boundary Testing",
				description:
					"Verify that horizontal and vertical access controls prevent low-privilege accounts from " +
					"reaching restricted resources. Checks IDOR, missing function-level access controls, and " +
					"JWT signature bypass patterns.",
				phase: "exploitation-check",
				toolName: "crawl_endpoints",
				requiredCapabilities: ["http"],
				estimatedMinutes: 10,
			},
			{
				id: "header-audit",
				name: "Security Directive Audit",
				description:
					"Evaluate all HTTP security response headers: CSP, HSTS, X-Frame-Options, CORP, COOP, " +
					"Permissions-Policy, and CORS configuration. Score the overall security directive posture.",
				phase: "vulnerability-assessment",
				toolName: "check_security_headers",
				requiredCapabilities: ["http"],
				estimatedMinutes: 3,
			},
			{
				id: "tls-review",
				name: "Transport Layer Security Review",
				description:
					"Assess TLS configuration: protocol versions, cipher suites, certificate validity and chain " +
					"trust, HSTS preload eligibility, and BEAST/POODLE/SWEET32 exposure.",
				phase: "vulnerability-assessment",
				toolName: "test_ssl_tls",
				requiredCapabilities: ["tls"],
				estimatedMinutes: 5,
			},
			{
				id: "waf-detect",
				name: "Perimeter Control Detection",
				description:
					"Determine whether a WAF or rate-limiting proxy sits in front of the application, which " +
					"informs exploitation-phase payload selection and bypass strategies.",
				phase: "surface-discovery",
				toolName: "detect_waf",
				requiredCapabilities: ["http"],
				estimatedMinutes: 2,
			},
			{
				id: "report-web",
				name: "Findings Consolidation",
				description:
					"Aggregate all phase outputs, deduplicate findings, assign CVSS scores and MITRE ATT&CK tags, " +
					"and generate the final structured report with prioritised remediation guidance.",
				phase: "reporting",
				toolName: "report",
				requiredCapabilities: [],
				estimatedMinutes: 5,
			},
		],
	},

	infrastructure: {
		id: "infrastructure",
		name: "Infrastructure Penetration Test",
		description:
			"A network-layer assessment following the Penetration Testing Execution Standard (PTES). " +
			"Covers perimeter reconnaissance through post-exploitation analysis without causing service disruption.",
		methodology: "PTES",
		steps: [
			{
				id: "passive-recon",
				name: "Passive Intelligence Gathering",
				description:
					"Collect network-facing intelligence without touching the target directly: BGP prefixes, " +
					"WHOIS data, passive DNS history, and certificate transparency records.",
				phase: "surface-discovery",
				toolName: "osint",
				requiredCapabilities: ["dns", "whois"],
				estimatedMinutes: 8,
			},
			{
				id: "port-discovery",
				name: "Network Port Discovery",
				description:
					"Enumerate open TCP/UDP ports across the target IP range to build the initial attack surface. " +
					"Uses adaptive timing to balance speed against stealth.",
				phase: "surface-discovery",
				toolName: "port_scan",
				requiredCapabilities: ["network"],
				estimatedMinutes: 20,
			},
			{
				id: "service-enum",
				name: "Service Version Enumeration",
				description:
					"Identify software running on each open port through banner grabbing and protocol probing. " +
					"Produces a CPE-annotated service inventory for vulnerability matching.",
				phase: "service-enumeration",
				toolName: "service_banner",
				requiredCapabilities: ["network"],
				estimatedMinutes: 15,
			},
			{
				id: "vuln-match",
				name: "Vulnerability Correlation",
				description:
					"Cross-reference identified service versions against the NVD to surface CVEs affecting " +
					"the discovered software. Prioritise by exploitability and network exposure.",
				phase: "vulnerability-assessment",
				toolName: "lookup_cve",
				requiredCapabilities: ["internet"],
				estimatedMinutes: 10,
			},
			{
				id: "default-creds",
				name: "Default Credential Verification",
				description:
					"Check whether management interfaces, databases, and network devices respond to factory-default " +
					"credentials. Surfaces misconfigured services with zero exploitation complexity.",
				phase: "exploitation-check",
				toolName: "check_known_defaults",
				requiredCapabilities: ["network"],
				estimatedMinutes: 5,
			},
			{
				id: "network-path",
				name: "Network Path Analysis",
				description:
					"Trace routes to key target hosts to understand segmentation boundaries, identify filtering " +
					"devices, and map potential lateral movement paths.",
				phase: "service-enumeration",
				toolName: "traceroute",
				requiredCapabilities: ["network"],
				estimatedMinutes: 5,
			},
			{
				id: "report-infra",
				name: "Findings Consolidation",
				description:
					"Compile all phase findings into a structured report with CVSS scoring, MITRE tagging, " +
					"and a prioritised remediation roadmap.",
				phase: "reporting",
				toolName: "report",
				requiredCapabilities: [],
				estimatedMinutes: 5,
			},
		],
	},

	"code-review": {
		id: "code-review",
		name: "Source Code Security Audit",
		description:
			"Static analysis of a code repository covering secrets exposure, dangerous function usage, " +
			"supply chain risk, and container security — aligned with NIST CSF Identify and Protect functions.",
		methodology: "NIST-CSF",
		steps: [
			{
				id: "secret-scan",
				name: "Hardcoded Credential Detection",
				description:
					"Scan every source file for API keys, private keys, database URLs, and other secrets that " +
					"should never reside in version control.",
				phase: "surface-discovery",
				toolName: "scan_secrets",
				requiredCapabilities: ["filesystem"],
				estimatedMinutes: 5,
			},
			{
				id: "insecure-funcs",
				name: "Dangerous API Usage Analysis",
				description:
					"Identify calls to known-dangerous functions — eval, exec, innerHTML, pickle.loads, " +
					"subprocess with shell=True — that may introduce code injection vulnerabilities.",
				phase: "vulnerability-assessment",
				toolName: "find_insecure_functions",
				requiredCapabilities: ["filesystem"],
				estimatedMinutes: 8,
			},
			{
				id: "dep-audit",
				name: "Dependency Vulnerability Assessment",
				description:
					"Run npm audit against the project's dependency tree and cross-reference package versions " +
					"against the NVD to surface known vulnerable third-party libraries.",
				phase: "vulnerability-assessment",
				toolName: "audit_dependencies",
				requiredCapabilities: ["filesystem", "internet"],
				estimatedMinutes: 10,
			},
			{
				id: "sbom",
				name: "Software Bill-of-Materials Review",
				description:
					"Inventory all declared dependencies, flag restrictive open-source licenses, and identify " +
					"packages significantly behind their latest published release.",
				phase: "vulnerability-assessment",
				toolName: "check_sbom",
				requiredCapabilities: ["filesystem", "internet"],
				estimatedMinutes: 8,
			},
			{
				id: "dockerfile-lint",
				name: "Container Image Security Lint",
				description:
					"Analyse Dockerfiles for privileged execution, secrets in ENV/ARG, pinned base images, " +
					"and dangerous build patterns such as curl-to-bash installation.",
				phase: "vulnerability-assessment",
				toolName: "lint_dockerfile",
				requiredCapabilities: ["filesystem"],
				estimatedMinutes: 3,
			},
			{
				id: "report-code",
				name: "Findings Consolidation",
				description:
					"Produce a developer-oriented report with inline code references, severity scores, " +
					"and concrete remediation steps for each finding.",
				phase: "reporting",
				toolName: "report",
				requiredCapabilities: [],
				estimatedMinutes: 5,
			},
		],
	},

	"governance-audit": {
		id: "governance-audit",
		name: "On-Premise Governance & Compliance Audit",
		description:
			"An offline-capable assessment for government and regulated enterprise deployments. " +
			"Evaluates data classification controls, access management, network segmentation, and " +
			"audit log completeness against the NIST Cybersecurity Framework.",
		methodology: "NIST-CSF",
		steps: [
			{
				id: "asset-inventory",
				name: "Asset and Service Discovery",
				description:
					"Enumerate all hosts, listening services, and management interfaces within the defined " +
					"scope to establish a complete and accurate asset register.",
				phase: "surface-discovery",
				toolName: "port_scan",
				requiredCapabilities: ["network"],
				estimatedMinutes: 20,
			},
			{
				id: "access-control-audit",
				name: "Access Control Policy Verification",
				description:
					"Assess authentication strength, MFA adoption, privileged account management practices, " +
					"and whether the principle of least privilege is enforced across all systems.",
				phase: "vulnerability-assessment",
				toolName: "check_known_defaults",
				requiredCapabilities: ["network"],
				estimatedMinutes: 10,
			},
			{
				id: "network-segmentation",
				name: "Network Segmentation Analysis",
				description:
					"Verify that network zones are correctly isolated — production separate from development, " +
					"databases not directly reachable from untrusted segments — and that firewall rules enforce " +
					"the documented topology.",
				phase: "service-enumeration",
				toolName: "traceroute",
				requiredCapabilities: ["network"],
				estimatedMinutes: 10,
			},
			{
				id: "data-classification",
				name: "Data Store Exposure Assessment",
				description:
					"Identify databases, file shares, and object stores reachable from the network and " +
					"verify that data at rest is encrypted and access-controlled appropriately.",
				phase: "vulnerability-assessment",
				toolName: "port_scan",
				requiredCapabilities: ["network"],
				estimatedMinutes: 10,
			},
			{
				id: "secret-governance",
				name: "Secret Management Controls Review",
				description:
					"Check whether secrets are managed through a vault or key management system rather than " +
					"embedded in configuration files, environment variables, or source code.",
				phase: "vulnerability-assessment",
				toolName: "scan_secrets",
				requiredCapabilities: ["filesystem"],
				estimatedMinutes: 8,
			},
			{
				id: "audit-log-review",
				name: "Audit Log Completeness Check",
				description:
					"Confirm that authentication events, privileged operations, and data access are captured " +
					"in tamper-evident logs with sufficient retention for incident response and compliance.",
				phase: "vulnerability-assessment",
				toolName: "find_insecure_functions",
				requiredCapabilities: ["filesystem"],
				estimatedMinutes: 6,
			},
			{
				id: "report-governance",
				name: "Compliance Report Generation",
				description:
					"Produce a governance-oriented report mapping each finding to the relevant NIST CSF " +
					"subcategory, with risk ratings and control improvement recommendations.",
				phase: "reporting",
				toolName: "report",
				requiredCapabilities: [],
				estimatedMinutes: 10,
			},
		],
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Auto-selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects the most appropriate playbook based on the target string format.
 * - URL (http/https) → web-app
 * - IPv4 / CIDR / hostname without path → infrastructure
 * - Filesystem path → code-review
 * - Fallback → web-app
 */
export function getPlaybookForTarget(target: string): Playbook {
	const t = target.trim();

	if (/^https?:\/\//i.test(t)) {
		return PLAYBOOKS["web-app"]!;
	}

	if (/^\/|^\.\/|^~\/|^[A-Za-z]:\\/i.test(t)) {
		return PLAYBOOKS["code-review"]!;
	}

	if (
		/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d+)?$/.test(t) ||
		/^[a-f0-9:]+\/\d+$/i.test(t)
	) {
		return PLAYBOOKS["infrastructure"]!;
	}

	// Bare hostnames without protocol — treat as infrastructure unless they look like app domains
	if (/\.[a-z]{2,}$/i.test(t) && !t.includes("/")) {
		return PLAYBOOKS["web-app"]!;
	}

	return PLAYBOOKS["web-app"]!;
}
