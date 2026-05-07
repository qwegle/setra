/**
 * Sentinel — Scan orchestrator.
 * Coordinates playbook execution, delegates tool calls, feeds results to the
 * AI analysis layer, and emits structured SSE-style events for real-time UIs.
 */

import * as crypto from "node:crypto";
import { FindingsStore } from "../findings/store.js";
import { tagFindingWithMitre } from "../mitre.js";
import {
	type AgentLogEntry,
	type Finding,
	type PlaybookStep,
	type ScanJob,
	type ScanPhase,
	ScanStatus,
} from "../types.js";
import { PLAYBOOKS, getPlaybookForTarget } from "./playbooks.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanOptions {
	target: string;
	playbook?: string;
	depth?: "quick" | "standard" | "thorough";
	offlineMode?: boolean;
	agentModel?: string;
	maxFindingsPerPhase?: number;
}

export type SentinelEvent =
	| { type: "phase-start"; phase: ScanPhase; stepName: string }
	| { type: "finding-discovered"; finding: Finding }
	| { type: "progress"; pct: number; message: string }
	| { type: "phase-complete"; phase: ScanPhase; findings: number }
	| { type: "scan-complete"; job: ScanJob }
	| { type: "error"; message: string };

interface StepResult {
	raw: string;
	findings: Finding[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeout multipliers per depth setting
// ─────────────────────────────────────────────────────────────────────────────

const DEPTH_MULTIPLIER: Record<string, number> = {
	quick: 0.5,
	standard: 1.0,
	thorough: 2.0,
};

// ─────────────────────────────────────────────────────────────────────────────
// ScanOrchestrator
// ─────────────────────────────────────────────────────────────────────────────

export class ScanOrchestrator {
	private options: Required<ScanOptions>;
	private findings: FindingsStore;
	private job: ScanJob;
	private listeners: Array<(event: SentinelEvent) => void> = [];
	private aborted = false;
	private paused = false;
	private stepIndex = 0;

	constructor(options: ScanOptions) {
		this.options = {
			target: options.target,
			playbook: options.playbook ?? "auto",
			depth: options.depth ?? "standard",
			offlineMode: options.offlineMode ?? false,
			agentModel: options.agentModel ?? "claude-sonnet-4",
			maxFindingsPerPhase: options.maxFindingsPerPhase ?? 50,
		};

		this.findings = new FindingsStore();
		this.job = {
			id: crypto.randomUUID(),
			target: options.target,
			phase: "surface-discovery",
			status: "queued",
			findings: [],
			agentLog: [],
		};
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async start(): Promise<ScanJob> {
		this.job.status = "running";
		this.job.startedAt = new Date();

		const playbook =
			this.options.playbook === "auto"
				? getPlaybookForTarget(this.options.target)
				: (PLAYBOOKS[this.options.playbook] ??
					getPlaybookForTarget(this.options.target));

		this.log(
			"surface-discovery",
			"orchestrator:start",
			`Starting ${playbook.name} on ${this.options.target}`,
		);
		this.emit({
			type: "progress",
			pct: 0,
			message: `Initialising ${playbook.name}`,
		});

		const steps = playbook.steps;

		for (let i = 0; i < steps.length; i++) {
			if (this.aborted) break;

			// Pause support — poll until unpaused
			while (this.paused && !this.aborted) {
				await sleep(500);
			}
			if (this.aborted) break;

			const step = steps[i];
			if (!step) continue;
			this.stepIndex = i;
			this.job.phase = step.phase;

			this.emit({
				type: "phase-start",
				phase: step.phase,
				stepName: step.name,
			});
			this.log(
				step.phase,
				`step:start`,
				`Running step "${step.name}" with tool "${step.toolName}"`,
			);

			const pctBefore = Math.round((i / steps.length) * 90);
			this.emit({ type: "progress", pct: pctBefore, message: step.name });

			try {
				const result = await this.runStep(step);
				const tagged = result.findings.map((f) => ({
					...f,
					mitreAttackIds: f.mitreAttackIds.length
						? f.mitreAttackIds
						: tagFindingWithMitre(f),
				}));

				const capped = tagged.slice(0, this.options.maxFindingsPerPhase);

				for (const finding of capped) {
					this.job.findings.push(finding);
					this.emit({ type: "finding-discovered", finding });
				}

				if (capped.length) {
					await this.findings.save(this.job.id, capped);
				}

				this.log(
					step.phase,
					`step:complete`,
					`${step.name} — ${capped.length} finding(s)`,
				);
				this.emit({
					type: "phase-complete",
					phase: step.phase,
					findings: capped.length,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.log(step.phase, `step:error`, msg);
				this.emit({
					type: "error",
					message: `Step "${step.name}" failed: ${msg}`,
				});
			}
		}

		this.job.phase = "reporting";
		this.job.status = this.aborted ? "failed" : "completed";
		this.job.completedAt = new Date();

		this.emit({ type: "progress", pct: 100, message: "Scan complete" });
		this.emit({ type: "scan-complete", job: this.job });

		return this.job;
	}

	async pause(): Promise<void> {
		this.paused = true;
		this.log(this.job.phase, "orchestrator:pause", "Scan paused by operator");
	}

	async resume(): Promise<void> {
		this.paused = false;
		this.log(this.job.phase, "orchestrator:resume", "Scan resumed by operator");
	}

	async abort(): Promise<string> {
		this.aborted = true;
		this.job.status = "failed";
		this.job.completedAt = new Date();
		this.log(this.job.phase, "orchestrator:abort", "Scan aborted by operator");

		// Return partial markdown report
		const partialReport = await this.findings
			.exportMarkdownReport(this.job.id)
			.catch(
				() =>
					`# Partial Report\n\nScan aborted after ${this.job.findings.length} finding(s).`,
			);
		return partialReport;
	}

	getProgress(): {
		phase: ScanPhase;
		step: string;
		pct: number;
		findingsCount: number;
	} {
		const playbook =
			this.options.playbook === "auto"
				? getPlaybookForTarget(this.options.target)
				: (PLAYBOOKS[this.options.playbook] ??
					getPlaybookForTarget(this.options.target));

		const totalSteps = playbook.steps.length;
		const pct = totalSteps
			? Math.round((this.stepIndex / totalSteps) * 100)
			: 0;
		const step = playbook.steps[this.stepIndex]?.name ?? "Initialising";

		return {
			phase: this.job.phase,
			step,
			pct,
			findingsCount: this.job.findings.length,
		};
	}

	streamEvents(callback: (event: SentinelEvent) => void): () => void {
		this.listeners.push(callback);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== callback);
		};
	}

	// ── Internal step runner ───────────────────────────────────────────────────

	private async runStep(step: PlaybookStep): Promise<StepResult> {
		// Dynamically import tool modules to keep startup cost low
		const toolOutput = await this.dispatchTool(step);
		const raw = JSON.stringify(toolOutput, null, 2);

		const findings = await this.analyzeWithAgent(raw, step);
		return { raw, findings };
	}

	/**
	 * Routes a playbook step to the correct tool function.
	 */
	private async dispatchTool(step: PlaybookStep): Promise<unknown> {
		const target = this.options.target;
		const tool = step.toolName;

		if (tool === "port_scan") {
			const { portScan } = await import("../tools/network.js");
			return portScan(target);
		}
		if (tool === "service_banner") {
			const { portScan, serviceBanner } = await import("../tools/network.js");
			const scan = await portScan(target);
			const banners = await Promise.allSettled(
				scan.ports
					.filter((p) => p.state === "open")
					.slice(0, 5)
					.map((p) => serviceBanner(target, p.port)),
			);
			return banners.map((r) => (r.status === "fulfilled" ? r.value : null));
		}
		if (tool === "traceroute") {
			const { traceroute } = await import("../tools/network.js");
			return traceroute(target);
		}
		if (tool === "osint") {
			const { whoisLookup, gatherSubdomains, certTransparency } = await import(
				"../tools/osint.js"
			);
			const domain = extractDomain(target);
			const [whois, subs, certs] = await Promise.allSettled([
				whoisLookup(domain),
				gatherSubdomains(domain),
				certTransparency(domain),
			]);
			return {
				whois: whois.status === "fulfilled" ? whois.value : null,
				subdomains: subs.status === "fulfilled" ? subs.value : [],
				certs: certs.status === "fulfilled" ? certs.value.slice(0, 10) : [],
			};
		}
		if (tool === "detect_technologies") {
			const { detectTechnologies } = await import("../tools/web.js");
			return detectTechnologies(ensureHttps(target));
		}
		if (tool === "crawl_endpoints") {
			const { crawlEndpoints } = await import("../tools/web.js");
			const depth =
				this.options.depth === "quick"
					? 1
					: this.options.depth === "thorough"
						? 3
						: 2;
			return crawlEndpoints(ensureHttps(target), depth);
		}
		if (tool === "check_security_headers") {
			const { checkSecurityHeaders } = await import("../tools/web.js");
			return checkSecurityHeaders(ensureHttps(target));
		}
		if (tool === "test_ssl_tls") {
			const { testSslTls } = await import("../tools/web.js");
			return testSslTls(extractDomain(target));
		}
		if (tool === "detect_waf") {
			const { detectWaf } = await import("../tools/network.js");
			return detectWaf(ensureHttps(target));
		}
		if (tool === "check_known_defaults") {
			const { checkKnownDefaults } = await import("../tools/vuln.js");
			return checkKnownDefaults("generic");
		}
		if (tool === "lookup_cve") {
			const { searchCveByKeyword } = await import("../tools/vuln.js");
			return searchCveByKeyword(target.split("/").pop() ?? target, 5);
		}
		if (tool === "audit_dependencies") {
			const { auditDependencies } = await import("../tools/vuln.js");
			const pkgPath = target.endsWith("package.json")
				? target
				: `${target}/package.json`;
			return auditDependencies(pkgPath);
		}
		if (tool === "scan_secrets") {
			const { scanSecrets } = await import("../tools/vuln.js");
			return scanSecrets(target);
		}
		if (tool === "find_insecure_functions") {
			const { findInsecureFunctions } = await import("../tools/code-audit.js");
			return findInsecureFunctions({ path: target });
		}
		if (tool === "lint_dockerfile") {
			const { lintDockerfile } = await import("../tools/code-audit.js");
			const dockerfilePath = target.endsWith("Dockerfile")
				? target
				: `${target}/Dockerfile`;
			return lintDockerfile(dockerfilePath);
		}
		if (tool === "check_sbom") {
			const { checkSbom } = await import("../tools/code-audit.js");
			return checkSbom({ path: target });
		}
		if (tool === "report") {
			return {
				message: "Findings consolidation step — no additional tool data.",
			};
		}

		return { _unknown_tool: tool, _skipped: true };
	}

	/**
	 * Uses a lightweight heuristic analysis to extract structured findings from tool output.
	 * In a full setra deployment, this would call the configured LLM via @setra/agent-runner.
	 * Here we provide a deterministic fallback that still produces valid Finding objects.
	 */
	private async analyzeWithAgent(
		rawOutput: string,
		step: PlaybookStep,
	): Promise<Finding[]> {
		this.log(
			step.phase,
			"agent:analyze",
			`Analysing ${step.name} output (${rawOutput.length} bytes)`,
		);
		return heuristicFindingExtractor(rawOutput, step, this.options.target);
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private log(phase: ScanPhase, action: string, detail: string): void {
		const entry: AgentLogEntry = { ts: new Date(), phase, action, detail };
		this.job.agentLog.push(entry);
	}

	private emit(event: SentinelEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				/* listener errors must not abort the scan */
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic finding extractor
// Converts raw JSON tool output into Finding objects without requiring an LLM call.
// This keeps the orchestrator fully self-contained for offline / test use.
// ─────────────────────────────────────────────────────────────────────────────

function heuristicFindingExtractor(
	rawOutput: string,
	step: PlaybookStep,
	target: string,
): Finding[] {
	const findings: Finding[] = [];

	try {
		const data = JSON.parse(rawOutput);

		// Security header findings
		if (data?.findings && Array.isArray(data.findings)) {
			for (const f of data.findings) {
				if (f.severity && f.header && f.detail) {
					findings.push(
						makeFinding({
							title: `Missing or misconfigured: ${f.header}`,
							description: f.detail,
							severity: f.severity,
							target,
							toolUsed: step.toolName,
							evidence: `Header check on ${target}: ${f.header} — ${f.detail}`,
							remediation: headerRemediation(f.header),
						}),
					);
				}
			}
		}

		// Open ports with weak services
		if (data?.ports && Array.isArray(data.ports)) {
			for (const p of data.ports) {
				if (p.state === "open" && isRiskyService(p.service)) {
					findings.push(
						makeFinding({
							title: `Exposed service: ${p.service ?? "unknown"} on port ${p.port}`,
							description: `Port ${p.port}/${p.protocol} is open and running ${p.service ?? "an unidentified service"}${p.version ? ` (${p.version})` : ""}.`,
							severity: riskySeverity(p.service),
							target,
							toolUsed: step.toolName,
							evidence:
								`nmap: ${p.port}/${p.protocol} open ${p.service ?? ""} ${p.version ?? ""}`.trim(),
							remediation: `Restrict access to port ${p.port} via firewall rules. If the service is not required, disable it.`,
						}),
					);
				}
			}
		}

		// Dependency vulnerabilities
		if (
			data?.findings &&
			Array.isArray(data.findings) &&
			data.vulnerable !== undefined
		) {
			for (const f of data.findings) {
				if (f.package && f.cveIds) {
					findings.push(
						makeFinding({
							title: `Vulnerable dependency: ${f.package}@${f.version}`,
							description: `Package ${f.package} version ${f.version} has known vulnerabilities: ${(f.cveIds as string[]).join(", ")}.`,
							severity: f.severity ?? "medium",
							target,
							toolUsed: step.toolName,
							evidence: `npm audit: ${f.package}@${f.version} — ${(f.cveIds as string[]).join(", ")}`,
							remediation: f.fixedIn
								? `Upgrade ${f.package} to version ${f.fixedIn} or later.`
								: `Upgrade ${f.package} to the latest available version.`,
							cveIds: f.cveIds as string[],
						}),
					);
				}
			}
		}

		// TLS weaknesses
		if (data?.weaknesses && Array.isArray(data.weaknesses) && data.grade) {
			for (const w of data.weaknesses as string[]) {
				findings.push(
					makeFinding({
						title: `TLS weakness: ${w}`,
						description: `TLS assessment of ${target} detected: ${w}. Overall grade: ${data.grade as string}.`,
						severity:
							data.grade === "F" || data.grade === "D" ? "high" : "medium",
						target,
						toolUsed: step.toolName,
						evidence: `openssl grade=${data.grade as string}: ${w}`,
						remediation: tlsRemediation(w),
					}),
				);
			}
		}

		// Secrets / insecure functions from code audit
		if (
			Array.isArray(data) &&
			data.length > 0 &&
			data[0]?.type &&
			data[0]?.file
		) {
			for (const f of data as Array<{
				file: string;
				line: number;
				type: string;
				severity: string;
				matchPreview?: string;
				reason?: string;
				function?: string;
			}>) {
				findings.push(
					makeFinding({
						title: f.function
							? `Insecure function: ${f.function}`
							: `Hardcoded secret: ${f.type}`,
						description:
							f.reason ?? `${f.type} detected at ${f.file}:${f.line}`,
						severity: (f.severity as Finding["severity"]) ?? "high",
						target,
						toolUsed: step.toolName,
						evidence: `${f.file}:${f.line} — ${f.matchPreview ?? f.function ?? f.type}`,
						remediation: f.function
							? `Replace ${f.function} with a secure equivalent. See project documentation.`
							: `Remove the hardcoded ${f.type} from source code and store it in a secrets manager.`,
					}),
				);
			}
		}
	} catch {
		// Unparseable output — no heuristic findings generated
	}

	return findings;
}

function makeFinding(partial: {
	title: string;
	description: string;
	severity: Finding["severity"];
	target: string;
	toolUsed: string;
	evidence: string;
	remediation: string;
	cveIds?: string[];
}): Finding {
	return {
		id: crypto.randomUUID(),
		title: partial.title,
		description: partial.description,
		severity: partial.severity,
		cveIds: partial.cveIds ?? [],
		mitreAttackIds: [],
		remediation: partial.remediation,
		references: [],
		discoveredAt: new Date(),
		target: partial.target,
		toolUsed: partial.toolUsed,
		evidence: partial.evidence,
		falsePositive: false,
	};
}

function isRiskyService(service?: string): boolean {
	if (!service) return false;
	const risky = ["ftp", "telnet", "finger", "rsh", "rlogin", "vnc", "rdp"];
	return risky.some((r) => service.toLowerCase().includes(r));
}

function riskySeverity(service?: string): Finding["severity"] {
	const critical = ["telnet", "rsh", "rlogin"];
	if (service && critical.some((c) => service.toLowerCase().includes(c)))
		return "high";
	return "medium";
}

function headerRemediation(header: string): string {
	const map: Record<string, string> = {
		"Content-Security-Policy":
			"Define a CSP that restricts allowed script, style, and media sources. Start with 'default-src \\'self\\'' and harden from there.",
		"Strict-Transport-Security":
			"Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload' to all HTTPS responses.",
		"X-Frame-Options":
			"Add 'X-Frame-Options: DENY' or use CSP frame-ancestors 'none' to prevent clickjacking.",
		"X-Content-Type-Options":
			"Add 'X-Content-Type-Options: nosniff' to all responses to disable MIME sniffing.",
		"Referrer-Policy":
			"Add 'Referrer-Policy: strict-origin-when-cross-origin' to limit cross-origin referrer leakage.",
		"Permissions-Policy":
			"Add a Permissions-Policy header restricting access to camera, microphone, and geolocation.",
		"Set-Cookie":
			"Ensure all session cookies carry HttpOnly, Secure, and SameSite=Lax attributes.",
		"Access-Control-Allow-Origin":
			"Replace wildcard CORS with an explicit allowlist of trusted origins.",
	};
	return (
		map[header] ??
		`Configure the ${header} header following current security best practices.`
	);
}

function tlsRemediation(weakness: string): string {
	if (weakness.includes("expired"))
		return "Renew the TLS certificate before it expires and automate renewal with ACME/Let's Encrypt.";
	if (weakness.includes("deprecated") || weakness.includes("TLSv1"))
		return "Disable TLS 1.0 and 1.1 on the server. Configure a minimum of TLS 1.2, preferring TLS 1.3.";
	if (weakness.includes("Weak cipher"))
		return "Remove RC4, DES, 3DES, EXPORT, and anonymous cipher suites from the server TLS configuration.";
	if (weakness.includes("not trusted"))
		return "Install the full certificate chain including intermediate certificates from a trusted CA.";
	return "Review TLS configuration against Mozilla's Server Side TLS guidelines.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function extractDomain(target: string): string {
	try {
		return new URL(target.includes("://") ? target : `https://${target}`)
			.hostname;
	} catch {
		return target;
	}
}

function ensureHttps(target: string): string {
	if (/^https?:\/\//i.test(target)) return target;
	return `https://${target}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
