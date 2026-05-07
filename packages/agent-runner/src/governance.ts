/**
 * Governance policies for setra.sh on-prem / air-gap deployments.
 *
 * Policies are loaded from ~/.setra/governance.json or a path set in
 * the SETRA_GOVERNANCE_POLICY env var.
 *
 * Example governance.json:
 * {
 *   "deploymentMode": "offline",
 *   "allowedProviders": ["ollama"],
 *   "allowedModels": ["qwen2.5-coder:7b", "phi4"],
 *   "blockNetworkAccess": true,
 *   "requireApprovalForToolUse": true,
 *   "auditLog": { "enabled": true, "path": "/var/log/setra/audit.jsonl" },
 *   "dataResidency": "on-prem",
 *   "maxCostPerRunUsd": 0,
 *   "organization": "Odisha Government IT Dept",
 *   "contactEmail": "admin@example.gov.in"
 * }
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GovernancePolicy {
	deploymentMode: "cloud" | "hybrid" | "offline";
	/** If set, only these provider IDs are allowed. */
	allowedProviders?: string[];
	/** If set, only these model IDs are allowed. */
	allowedModels?: string[];
	/** Block ALL outbound network from agent subprocesses (sets SETRA_NO_NET=1). */
	blockNetworkAccess: boolean;
	/** Require human approval before any tool (file write, shell exec) runs. */
	requireApprovalForToolUse: boolean;
	/** Audit log for all agent actions (governance/compliance). */
	auditLog: {
		enabled: boolean;
		/** Absolute path; default: ~/.setra/audit.jsonl */
		path: string;
	};
	/** Max cost per run in USD (0 = unlimited; for offline this is always 0). */
	maxCostPerRunUsd: number;
	/** Organization metadata shown in UI. */
	organization?: string;
	contactEmail?: string;
	dataResidency?: string;
}

export interface AuditEntry {
	ts: string;
	event:
		| "run:start"
		| "run:end"
		| "tool:call"
		| "tool:approved"
		| "tool:denied"
		| "model:downgraded"
		| "policy:loaded"
		| "policy:saved";
	agentId?: string;
	model?: string;
	plotId?: string;
	detail?: Record<string, unknown>;
}

// ─── Default policy ───────────────────────────────────────────────────────────

export const DEFAULT_POLICY: GovernancePolicy = {
	deploymentMode: "cloud",
	blockNetworkAccess: false,
	requireApprovalForToolUse: false,
	auditLog: {
		enabled: false,
		path: join(homedir(), ".setra", "audit.jsonl"),
	},
	maxCostPerRunUsd: 0,
};

// ─── Policy file path ─────────────────────────────────────────────────────────

function getPolicyPath(): string {
	return (
		process.env["SETRA_GOVERNANCE_POLICY"] ??
		join(homedir(), ".setra", "governance.json")
	);
}

// ─── Load / save ──────────────────────────────────────────────────────────────

/**
 * Load governance policy from disk.
 * Falls back to DEFAULT_POLICY if the file doesn't exist or is malformed.
 */
export function loadGovernancePolicy(): GovernancePolicy {
	const policyPath = getPolicyPath();

	if (!existsSync(policyPath)) {
		return { ...DEFAULT_POLICY };
	}

	try {
		const raw = readFileSync(policyPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<GovernancePolicy>;
		return mergeWithDefaults(parsed);
	} catch {
		return { ...DEFAULT_POLICY };
	}
}

/**
 * Persist governance policy to disk.
 * Creates the ~/.setra directory if needed.
 */
export function saveGovernancePolicy(policy: GovernancePolicy): void {
	const policyPath = getPolicyPath();
	mkdirSync(dirname(policyPath), { recursive: true });
	writeFileSync(policyPath, JSON.stringify(policy, null, 2) + "\n", "utf-8");
}

/** Deep-merge a partial policy object with defaults. */
function mergeWithDefaults(
	partial: Partial<GovernancePolicy>,
): GovernancePolicy {
	return {
		...DEFAULT_POLICY,
		...partial,
		auditLog: {
			...DEFAULT_POLICY.auditLog,
			...(partial.auditLog ?? {}),
		},
	};
}

// ─── Model validation ─────────────────────────────────────────────────────────

/**
 * Validate a model choice against the active policy.
 * @returns null if allowed, an error string if blocked.
 */
export function validateModelChoice(
	modelId: string,
	policy: GovernancePolicy,
): string | null {
	// In offline mode, reject cloud model IDs
	if (policy.deploymentMode === "offline") {
		const CLOUD_PREFIXES = [
			"claude",
			"gpt",
			"gemini",
			"codex",
			"opencode",
			"amp",
		];
		const isCloud = CLOUD_PREFIXES.some(
			(prefix) =>
				modelId === prefix ||
				modelId.startsWith(`${prefix}-`) ||
				modelId.startsWith(`${prefix}:`),
		);
		if (isCloud) {
			return `Governance policy (offline mode) blocks cloud model "${modelId}". Use a local Ollama model.`;
		}
	}

	// Provider allow-list check
	if (policy.allowedProviders && policy.allowedProviders.length > 0) {
		const provider = modelId.includes(":")
			? modelId.split(":")[0]
			: deriveProvider(modelId);
		if (provider && !policy.allowedProviders.includes(provider)) {
			return `Governance policy: provider "${provider}" is not in the allowed list (${policy.allowedProviders.join(", ")}).`;
		}
	}

	// Model allow-list check
	if (policy.allowedModels && policy.allowedModels.length > 0) {
		if (!policy.allowedModels.includes(modelId)) {
			return `Governance policy: model "${modelId}" is not in the allowed model list.`;
		}
	}

	return null;
}

/** Best-effort: derive a provider string from a model ID. */
function deriveProvider(modelId: string): string | null {
	if (modelId.startsWith("claude")) return "claude";
	if (modelId.startsWith("gpt") || modelId.startsWith("codex")) return "openai";
	if (modelId.startsWith("gemini")) return "gemini";
	if (modelId.startsWith("ollama")) return "ollama";
	if (
		modelId.startsWith("phi") ||
		modelId.startsWith("qwen") ||
		modelId.startsWith("deepseek")
	)
		return "ollama";
	return null;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

/**
 * Append an audit log entry as a single JSON line.
 * Creates the log file (and any parent directories) if needed.
 * No-ops if audit logging is disabled in the policy.
 */
export function appendAuditLog(
	entry: AuditEntry,
	policy: GovernancePolicy,
): void {
	if (!policy.auditLog.enabled) return;

	const logPath = policy.auditLog.path;
	try {
		mkdirSync(dirname(logPath), { recursive: true });
		const line = JSON.stringify({
			...entry,
			ts: entry.ts || new Date().toISOString(),
		});
		appendFileSync(logPath, line + "\n", "utf-8");
	} catch {
		// Audit log failures must never crash the agent
	}
}

/**
 * Read the last N lines of the audit log.
 * Returns an empty array if the log doesn't exist or audit is disabled.
 */
export function readAuditLog(
	policy: GovernancePolicy,
	limit = 50,
): AuditEntry[] {
	if (!policy.auditLog.enabled) return [];

	const logPath = policy.auditLog.path;
	if (!existsSync(logPath)) return [];

	try {
		const content = readFileSync(logPath, "utf-8");
		const lines = content
			.split("\n")
			.filter((l) => l.trim().length > 0)
			.slice(-limit);

		return lines.map((line) => JSON.parse(line) as AuditEntry);
	} catch {
		return [];
	}
}

/**
 * Clear (truncate) the audit log file.
 */
export function clearAuditLog(policy: GovernancePolicy): void {
	const logPath = policy.auditLog.path;
	if (existsSync(logPath)) {
		writeFileSync(logPath, "", "utf-8");
	}
}

// ─── Governance policy path exposure (for UI banners) ─────────────────────────

export function getGovernancePolicyPath(): string {
	return getPolicyPath();
}

export function isGovernancePolicyFilePresent(): boolean {
	return existsSync(getPolicyPath());
}
