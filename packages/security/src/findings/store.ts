/**
 * Sentinel — Findings persistence layer.
 * Stores, deduplicates, and retrieves security findings backed by SQLite via @setra/db.
 * Supports SARIF 2.1.0 export for integration with GitHub Code Scanning and VS Code.
 */

import * as crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { type Finding, ScanJob, type SeverityLevel } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Schema bootstrap
// ─────────────────────────────────────────────────────────────────────────────

function ensureSchema(db: ReturnType<typeof getRawDb>): void {
	db.exec(`
    CREATE TABLE IF NOT EXISTS sentinel_findings (
      id           TEXT PRIMARY KEY,
      job_id       TEXT NOT NULL,
      dedup_hash   TEXT NOT NULL,
      target       TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      severity     TEXT NOT NULL,
      cvss_json    TEXT,
      cve_ids      TEXT NOT NULL DEFAULT '[]',
      mitre_ids    TEXT NOT NULL DEFAULT '[]',
      remediation  TEXT NOT NULL DEFAULT '',
      references   TEXT NOT NULL DEFAULT '[]',
      discovered_at TEXT NOT NULL,
      tool_used    TEXT NOT NULL,
      evidence     TEXT NOT NULL,
      false_positive INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sentinel_findings_job    ON sentinel_findings(job_id);
    CREATE INDEX IF NOT EXISTS idx_sentinel_findings_target ON sentinel_findings(target);
    CREATE INDEX IF NOT EXISTS idx_sentinel_findings_dedup  ON sentinel_findings(dedup_hash);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication hash
// ─────────────────────────────────────────────────────────────────────────────

function dedupHash(finding: Finding): string {
	const key = `${finding.target}::${finding.title}::${finding.toolUsed}`;
	return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// ─────────────────────────────────────────────────────────────────────────────
// FindingsStore
// ─────────────────────────────────────────────────────────────────────────────

export class FindingsStore {
	private db: ReturnType<typeof getRawDb>;

	constructor(_dbPath?: string) {
		// setra's DB singleton manages the path; _dbPath is accepted for compatibility
		this.db = getRawDb();
		ensureSchema(this.db);
	}

	/**
	 * Persists findings for a scan job, skipping exact duplicates.
	 */
	async save(jobId: string, findings: Finding[]): Promise<void> {
		const insert = this.db.prepare(`
      INSERT OR IGNORE INTO sentinel_findings
        (id, job_id, dedup_hash, target, title, description, severity,
         cvss_json, cve_ids, mitre_ids, remediation, references,
         discovered_at, tool_used, evidence, false_positive)
      VALUES
        (@id, @jobId, @dedupHash, @target, @title, @description, @severity,
         @cvssJson, @cveIds, @mitreIds, @remediation, @references,
         @discoveredAt, @toolUsed, @evidence, @falsePositive)
    `);

		const saveMany = this.db.transaction((rows: Finding[]) => {
			for (const f of rows) {
				insert.run({
					id: f.id,
					jobId,
					dedupHash: dedupHash(f),
					target: f.target,
					title: f.title,
					description: f.description,
					severity: f.severity,
					cvssJson: f.cvss ? JSON.stringify(f.cvss) : null,
					cveIds: JSON.stringify(f.cveIds),
					mitreIds: JSON.stringify(f.mitreAttackIds),
					remediation: f.remediation,
					references: JSON.stringify(f.references),
					discoveredAt: f.discoveredAt.toISOString(),
					toolUsed: f.toolUsed,
					evidence: f.evidence,
					falsePositive: f.falsePositive ? 1 : 0,
				});
			}
		});

		saveMany(findings);
	}

	/**
	 * Retrieves all findings for a specific scan job.
	 */
	async getByJob(jobId: string): Promise<Finding[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM sentinel_findings WHERE job_id = ? ORDER BY severity, discovered_at",
			)
			.all(jobId) as DbRow[];
		return rows.map(rowToFinding);
	}

	/**
	 * Retrieves all findings ever recorded against a target, across all scan jobs.
	 */
	async getByTarget(target: string): Promise<Finding[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM sentinel_findings WHERE target = ? ORDER BY discovered_at DESC",
			)
			.all(target) as DbRow[];
		return rows.map(rowToFinding);
	}

	/**
	 * Returns a severity breakdown count for a scan job.
	 */
	async getSeveritySummary(
		jobId: string,
	): Promise<Record<SeverityLevel, number>> {
		const rows = this.db
			.prepare(
				"SELECT severity, COUNT(*) as cnt FROM sentinel_findings WHERE job_id = ? GROUP BY severity",
			)
			.all(jobId) as Array<{ severity: string; cnt: number }>;

		const summary: Record<SeverityLevel, number> = {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
		};
		for (const row of rows) {
			if (row.severity in summary) {
				summary[row.severity as SeverityLevel] = row.cnt;
			}
		}
		return summary;
	}

	/**
	 * Marks a finding as a false positive so it is excluded from future reports.
	 */
	async markFalsePositive(findingId: string): Promise<void> {
		this.db
			.prepare("UPDATE sentinel_findings SET false_positive = 1 WHERE id = ?")
			.run(findingId);
	}

	/**
	 * Exports findings for a job in SARIF 2.1.0 format.
	 * Compatible with GitHub Code Scanning, VS Code SARIF Viewer, and Azure DevOps.
	 */
	async exportSarif(jobId: string): Promise<string> {
		const findings = await this.getByJob(jobId);
		const sarif = buildSarif(findings, jobId);
		return JSON.stringify(sarif, null, 2);
	}

	/**
	 * Generates a human-readable Markdown pentest report for a scan job.
	 */
	async exportMarkdownReport(jobId: string): Promise<string> {
		const findings = await this.getByJob(jobId);
		const summary = await this.getSeveritySummary(jobId);
		return buildMarkdownReport(findings, summary, jobId);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Row <-> Finding mapping
// ─────────────────────────────────────────────────────────────────────────────

interface DbRow {
	id: string;
	job_id: string;
	target: string;
	title: string;
	description: string;
	severity: string;
	cvss_json: string | null;
	cve_ids: string;
	mitre_ids: string;
	remediation: string;
	references: string;
	discovered_at: string;
	tool_used: string;
	evidence: string;
	false_positive: number;
}

function rowToFinding(row: DbRow): Finding {
	return {
		id: row.id,
		title: row.title,
		description: row.description,
		severity: row.severity as SeverityLevel,
		cvss: row.cvss_json ? JSON.parse(row.cvss_json) : undefined,
		cveIds: JSON.parse(row.cve_ids) as string[],
		mitreAttackIds: JSON.parse(row.mitre_ids) as string[],
		remediation: row.remediation,
		references: JSON.parse(row.references) as string[],
		discoveredAt: new Date(row.discovered_at),
		target: row.target,
		toolUsed: row.tool_used,
		evidence: row.evidence,
		falsePositive: row.false_positive === 1,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// SARIF builder
// ─────────────────────────────────────────────────────────────────────────────

function buildSarif(findings: Finding[], jobId: string): object {
	const rules = new Map<
		string,
		{ id: string; name: string; shortDescription: { text: string } }
	>();

	const results = findings
		.filter((f) => !f.falsePositive)
		.map((f) => {
			const ruleId =
				f.toolUsed +
				"/" +
				f.title.slice(0, 40).replace(/\s+/g, "-").toLowerCase();
			if (!rules.has(ruleId)) {
				rules.set(ruleId, {
					id: ruleId,
					name: f.title,
					shortDescription: { text: f.description.slice(0, 256) },
				});
			}
			return {
				ruleId,
				level: sarifLevel(f.severity),
				message: { text: `${f.description}\n\nRemediation: ${f.remediation}` },
				locations: [
					{
						physicalLocation: {
							artifactLocation: { uri: f.target },
						},
					},
				],
				properties: {
					cveIds: f.cveIds,
					mitreAttackIds: f.mitreAttackIds,
					evidence: f.evidence,
				},
			};
		});

	return {
		$schema:
			"https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
		version: "2.1.0",
		runs: [
			{
				tool: {
					driver: {
						name: "Sentinel",
						version: "1.0.0",
						informationUri: "https://setra.sh",
						rules: [...rules.values()],
					},
				},
				results,
				properties: { jobId },
			},
		],
	};
}

function sarifLevel(severity: SeverityLevel): string {
	switch (severity) {
		case "critical":
		case "high":
			return "error";
		case "medium":
			return "warning";
		case "low":
		case "info":
			return "note";
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown report builder
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: SeverityLevel[] = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
];

function buildMarkdownReport(
	findings: Finding[],
	summary: Record<SeverityLevel, number>,
	jobId: string,
): string {
	const target = findings[0]?.target ?? "unknown";
	const date = new Date().toISOString().slice(0, 10);
	const active = findings.filter((f) => !f.falsePositive);

	const lines: string[] = [
		`# Sentinel Security Report`,
		``,
		`**Job ID:** \`${jobId}\`  `,
		`**Target:** ${target}  `,
		`**Generated:** ${date}  `,
		``,
		`---`,
		``,
		`## Executive Summary`,
		``,
		`This report presents the findings from an automated security assessment conducted`,
		`by setra's Sentinel intelligence engine. The assessment identified **${active.length}** unique`,
		`security issues across the target environment.`,
		``,
		`### Risk Distribution`,
		``,
		`| Severity | Count |`,
		`|----------|-------|`,
		...SEVERITY_ORDER.map((s) => `| ${capitalise(s)} | ${summary[s]} |`),
		``,
		`---`,
		``,
		`## Findings`,
		``,
	];

	for (const sev of SEVERITY_ORDER) {
		const group = active.filter((f) => f.severity === sev);
		if (!group.length) continue;

		lines.push(`### ${capitalise(sev)} Severity (${group.length})`);
		lines.push(``);

		for (const f of group) {
			lines.push(`#### ${f.title}`);
			lines.push(``);
			lines.push(`**Tool:** ${f.toolUsed}  `);
			lines.push(`**Target:** ${f.target}  `);
			if (f.cvss) lines.push(`**CVSS Score:** ${f.cvss.baseScore}  `);
			if (f.cveIds.length) lines.push(`**CVEs:** ${f.cveIds.join(", ")}  `);
			if (f.mitreAttackIds.length)
				lines.push(`**MITRE ATT&CK:** ${f.mitreAttackIds.join(", ")}  `);
			lines.push(``);
			lines.push(`**Description**`);
			lines.push(``);
			lines.push(f.description);
			lines.push(``);
			lines.push(`**Evidence**`);
			lines.push(``);
			lines.push("```");
			lines.push(f.evidence.slice(0, 500));
			lines.push("```");
			lines.push(``);
			lines.push(`**Remediation**`);
			lines.push(``);
			lines.push(f.remediation);
			if (f.references.length) {
				lines.push(``);
				lines.push(`**References**`);
				lines.push(``);
				for (const ref of f.references) lines.push(`- ${ref}`);
			}
			lines.push(``);
			lines.push(`---`);
			lines.push(``);
		}
	}

	return lines.join("\n");
}

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export for use by orchestrator
// ─────────────────────────────────────────────────────────────────────────────
export type { Finding };
