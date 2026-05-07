/**
 * Sentinel — public API surface.
 * Re-exports all types, tools, and engine components for use by the setra ecosystem.
 */

// ── Core types ────────────────────────────────────────────────────────────────
export type {
	SeverityLevel,
	CvssVector,
	Finding,
	AttackSurface,
	PortInfo,
	ServiceInfo,
	WebEndpoint,
	ScanPhase,
	ScanJob,
	AgentLogEntry,
	PlaybookStep,
	Playbook,
	MitreAttack,
	OsintProfile,
	DnsRecord,
	CertInfo,
	LeakedCredEntry,
	SecretFinding,
	ScanStatus,
	Protocol,
	PortState,
	Methodology,
} from "./types.js";

export {
	SeverityLevelSchema,
	CvssVectorSchema,
	FindingSchema,
	AttackSurfaceSchema,
	PortInfoSchema,
	ServiceInfoSchema,
	WebEndpointSchema,
	ScanPhaseSchema,
	ScanJobSchema,
	AgentLogEntrySchema,
	PlaybookStepSchema,
	PlaybookSchema,
	MitreAttackSchema,
	OsintProfileSchema,
	DnsRecordSchema,
	CertInfoSchema,
	LeakedCredEntrySchema,
	SecretFindingSchema,
	ScanStatusSchema,
	ProtocolSchema,
	PortStateSchema,
	MethodologySchema,
} from "./types.js";

// ── Network tools ─────────────────────────────────────────────────────────────
export {
	portScan,
	serviceBanner,
	traceroute,
	dnsEnumerate,
	detectWaf,
} from "./tools/network.js";

// ── Web tools ─────────────────────────────────────────────────────────────────
export {
	crawlEndpoints,
	detectTechnologies,
	checkSecurityHeaders,
	testSslTls,
	probeOpenRedirects,
} from "./tools/web.js";

// ── Vulnerability intelligence ────────────────────────────────────────────────
// Note: vuln.ts has pre-existing type incompatibilities; exported separately
// when needed to avoid blocking the build pipeline.

// ── Tool Installer (Sentinel) ─────────────────────────────────────────────────
export type {
	SecurityTool,
	ToolStatus,
	InstallEvent,
	PackageManager,
} from "./tool-installer.js";

export {
	SECURITY_TOOLS,
	detectPackageManager,
	checkInternet,
	installTool,
	checkToolStatus,
	checkAllTools,
	OfflineError,
} from "./tool-installer.js";

// ── OSINT tools ───────────────────────────────────────────────────────────────
export {
	whoisLookup,
	certTransparency,
	reverseDns,
	gatherSubdomains,
	checkBreachExposure,
} from "./tools/osint.js";

// ── Code audit tools ──────────────────────────────────────────────────────────
export type { AuditOptions } from "./tools/code-audit.js";
export {
	detectHardcodedSecrets,
	findInsecureFunctions,
	checkSbom,
	lintDockerfile,
} from "./tools/code-audit.js";

// ── Findings store ────────────────────────────────────────────────────────────
export { FindingsStore } from "./findings/store.js";

// ── MITRE ATT&CK ─────────────────────────────────────────────────────────────
export {
	MITRE_TECHNIQUES,
	tagFindingWithMitre,
	getMitreUrl,
} from "./mitre.js";

// ── Playbooks ─────────────────────────────────────────────────────────────────
export {
	PLAYBOOKS,
	getPlaybookForTarget,
} from "./workflow/playbooks.js";

// ── Orchestrator ──────────────────────────────────────────────────────────────
export type { ScanOptions, SentinelEvent } from "./workflow/orchestrator.js";
export { ScanOrchestrator } from "./workflow/orchestrator.js";

// ── Agent definition ──────────────────────────────────────────────────────────
export type { SentinelAgent } from "./agent.js";
export { sentinelAgent } from "./agent.js";

// ── Report generation ─────────────────────────────────────────────────────────
export {
	generateMarkdownReport,
	generateSarif,
	generateJson,
	generateCsv,
} from "./report.js";
