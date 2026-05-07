/**
 * Sentinel — setra.sh security intelligence engine
 * Core type definitions and Zod schemas for all security domain objects.
 */

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Primitive enumerations
// ─────────────────────────────────────────────────────────────────────────────

export const SeverityLevelSchema = z.enum([
	"critical",
	"high",
	"medium",
	"low",
	"info",
]);
export type SeverityLevel = z.infer<typeof SeverityLevelSchema>;

export const ScanPhaseSchema = z.enum([
	"surface-discovery",
	"service-enumeration",
	"vulnerability-assessment",
	"exploitation-check",
	"reporting",
]);
export type ScanPhase = z.infer<typeof ScanPhaseSchema>;

export const ScanStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
]);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

export const ProtocolSchema = z.enum(["tcp", "udp"]);
export type Protocol = z.infer<typeof ProtocolSchema>;

export const PortStateSchema = z.enum(["open", "closed", "filtered"]);
export type PortState = z.infer<typeof PortStateSchema>;

export const MethodologySchema = z.enum([
	"PTES",
	"OWASP-WSTG",
	"NIST-CSF",
	"custom",
]);
export type Methodology = z.infer<typeof MethodologySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CVSS Vector
// ─────────────────────────────────────────────────────────────────────────────

export const CvssVectorSchema = z.object({
	cvssVersion: z.enum(["2.0", "3.0", "3.1", "4.0"]).default("3.1"),
	attackVector: z.enum(["Network", "Adjacent", "Local", "Physical"]),
	attackComplexity: z.enum(["Low", "High"]),
	privilegesRequired: z.enum(["None", "Low", "High"]),
	userInteraction: z.enum(["None", "Required"]),
	scope: z.enum(["Unchanged", "Changed"]),
	confidentialityImpact: z.enum(["None", "Low", "High"]),
	integrityImpact: z.enum(["None", "Low", "High"]),
	availabilityImpact: z.enum(["None", "Low", "High"]),
	baseScore: z.number().min(0).max(10),
});
export type CvssVector = z.infer<typeof CvssVectorSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Network primitives
// ─────────────────────────────────────────────────────────────────────────────

export const PortInfoSchema = z.object({
	port: z.number().int().min(1).max(65535),
	protocol: ProtocolSchema,
	state: PortStateSchema,
	service: z.string().optional(),
	version: z.string().optional(),
	banner: z.string().optional(),
});
export type PortInfo = z.infer<typeof PortInfoSchema>;

export const ServiceInfoSchema = z.object({
	name: z.string(),
	version: z.string().optional(),
	port: z.number().int().min(1).max(65535),
	cpe: z.string().optional(),
	vulnCount: z.number().int().min(0).default(0),
});
export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

export const WebEndpointSchema = z.object({
	url: z.string().url(),
	method: z.array(z.string()),
	statusCode: z.number().int(),
	contentType: z.string().optional(),
	parameters: z.array(z.string()),
	technologies: z.array(z.string()),
});
export type WebEndpoint = z.infer<typeof WebEndpointSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// DNS and certificate primitives
// ─────────────────────────────────────────────────────────────────────────────

export const DnsRecordSchema = z.object({
	type: z.string(),
	name: z.string(),
	value: z.string(),
	ttl: z.number().optional(),
});
export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export const CertInfoSchema = z.object({
	commonName: z.string(),
	issuer: z.string(),
	notBefore: z.date(),
	notAfter: z.date(),
	subjectAltNames: z.array(z.string()),
});
export type CertInfo = z.infer<typeof CertInfoSchema>;

export const LeakedCredEntrySchema = z.object({
	email: z.string().optional(),
	username: z.string().optional(),
	source: z.string(),
	breachDate: z.date().optional(),
	dataTypes: z.array(z.string()),
});
export type LeakedCredEntry = z.infer<typeof LeakedCredEntrySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Security Finding
// ─────────────────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	severity: SeverityLevelSchema,
	cvss: CvssVectorSchema.optional(),
	cveIds: z.array(z.string()),
	mitreAttackIds: z.array(z.string()),
	remediation: z.string(),
	references: z.array(z.string()),
	discoveredAt: z.date(),
	target: z.string(),
	toolUsed: z.string(),
	evidence: z.string(),
	falsePositive: z.boolean().default(false),
});
export type Finding = z.infer<typeof FindingSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Attack Surface
// ─────────────────────────────────────────────────────────────────────────────

export const AttackSurfaceSchema = z.object({
	id: z.string(),
	target: z.string(),
	hostname: z.string().optional(),
	ipAddress: z.string().optional(),
	openPorts: z.array(PortInfoSchema),
	services: z.array(ServiceInfoSchema),
	webEndpoints: z.array(WebEndpointSchema),
	technologies: z.array(z.string()),
	discoveredAt: z.date(),
});
export type AttackSurface = z.infer<typeof AttackSurfaceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Agent log and scan job
// ─────────────────────────────────────────────────────────────────────────────

export const AgentLogEntrySchema = z.object({
	ts: z.date(),
	phase: ScanPhaseSchema,
	action: z.string(),
	detail: z.string(),
	tokensUsed: z.number().int().optional(),
});
export type AgentLogEntry = z.infer<typeof AgentLogEntrySchema>;

export const ScanJobSchema = z.object({
	id: z.string(),
	target: z.string(),
	phase: ScanPhaseSchema,
	status: ScanStatusSchema,
	startedAt: z.date().optional(),
	completedAt: z.date().optional(),
	findings: z.array(FindingSchema),
	surface: AttackSurfaceSchema.optional(),
	agentLog: z.array(AgentLogEntrySchema),
});
export type ScanJob = z.infer<typeof ScanJobSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Playbook primitives
// ─────────────────────────────────────────────────────────────────────────────

export const PlaybookStepSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	phase: ScanPhaseSchema,
	toolName: z.string(),
	requiredCapabilities: z.array(z.string()),
	estimatedMinutes: z.number().int().min(1),
});
export type PlaybookStep = z.infer<typeof PlaybookStepSchema>;

export const PlaybookSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	methodology: MethodologySchema,
	steps: z.array(PlaybookStepSchema),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// MITRE ATT&CK
// ─────────────────────────────────────────────────────────────────────────────

export const MitreAttackSchema = z.object({
	techniqueId: z.string(),
	name: z.string(),
	tactic: z.string(),
	description: z.string(),
	mitigationIds: z.array(z.string()),
});
export type MitreAttack = z.infer<typeof MitreAttackSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// OSINT profile
// ─────────────────────────────────────────────────────────────────────────────

export const OsintProfileSchema = z.object({
	target: z.string(),
	emails: z.array(z.string()),
	subdomains: z.array(z.string()),
	ipRanges: z.array(z.string()),
	technologies: z.array(z.string()),
	certificates: z.array(CertInfoSchema),
	dnsRecords: z.array(DnsRecordSchema),
	leakedCredentials: z.array(LeakedCredEntrySchema),
});
export type OsintProfile = z.infer<typeof OsintProfileSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Secret finding (for code-audit tools)
// ─────────────────────────────────────────────────────────────────────────────

export const SecretFindingSchema = z.object({
	file: z.string(),
	line: z.number().int().min(1),
	type: z.string(),
	pattern: z.string(),
	severity: SeverityLevelSchema,
	matchPreview: z.string(),
});
export type SecretFinding = z.infer<typeof SecretFindingSchema>;
