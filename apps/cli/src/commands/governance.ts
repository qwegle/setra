/**
 * setra governance <subcommand>
 *
 * Commands:
 *   setra governance status                  → show current policy (table format)
 *   setra governance set-mode <mode>         → update deploymentMode in policy file
 *   setra governance audit                   → tail last 50 lines of audit log
 *   setra governance check <model>           → validate if model is allowed by policy
 */

import {
	type GovernancePolicy,
	getGovernancePolicyPath,
	isGovernancePolicyFilePresent,
	loadGovernancePolicy,
	readAuditLog,
	saveGovernancePolicy,
	validateModelChoice,
} from "@setra/agent-runner";

// ─── setra governance status ─────────────────────────────────────────────────

export async function runGovernanceStatus(): Promise<void> {
	const policy = loadGovernancePolicy();
	const policyPath = getGovernancePolicyPath();
	const fromFile = isGovernancePolicyFilePresent();

	const noColor = process.env["NO_COLOR"] === "1";
	const green = noColor ? "" : "\x1b[32m";
	const blue = noColor ? "" : "\x1b[34m";
	const yellow = noColor ? "" : "\x1b[33m";
	const reset = noColor ? "" : "\x1b[0m";
	const bold = noColor ? "" : "\x1b[1m";
	const dim = noColor ? "" : "\x1b[2m";

	const modeColor =
		policy.deploymentMode === "offline"
			? green
			: policy.deploymentMode === "hybrid"
				? yellow
				: blue;

	console.log(`\n${bold}setra Governance Policy${reset}`);
	console.log("─".repeat(48));
	console.log(
		`  Policy file : ${dim}${policyPath}${reset} ${fromFile ? `${green}(loaded)${reset}` : `${yellow}(defaults)${reset}`}`,
	);
	console.log(
		`  Mode        : ${modeColor}${bold}${policy.deploymentMode}${reset}`,
	);
	console.log(
		`  Org         : ${policy.organization ?? dim + "not set" + reset}`,
	);
	console.log(
		`  Email       : ${policy.contactEmail ?? dim + "not set" + reset}`,
	);
	console.log(
		`  Residency   : ${policy.dataResidency ?? dim + "not set" + reset}`,
	);
	console.log();
	console.log("  Security:");
	console.log(
		`    Block network access      : ${policy.blockNetworkAccess ? `${green}yes${reset}` : `${dim}no${reset}`}`,
	);
	console.log(
		`    Require tool approval     : ${policy.requireApprovalForToolUse ? `${green}yes${reset}` : `${dim}no${reset}`}`,
	);
	console.log(
		`    Max cost per run (USD)    : ${policy.maxCostPerRunUsd === 0 ? `${dim}unlimited${reset}` : `$${policy.maxCostPerRunUsd}`}`,
	);
	console.log();
	console.log("  Audit log:");
	console.log(
		`    Enabled : ${policy.auditLog.enabled ? `${green}yes${reset}` : `${dim}no${reset}`}`,
	);
	console.log(`    Path    : ${dim}${policy.auditLog.path}${reset}`);
	console.log();

	if (policy.allowedProviders && policy.allowedProviders.length > 0) {
		console.log(`  Allowed providers : ${policy.allowedProviders.join(", ")}`);
	}
	if (policy.allowedModels && policy.allowedModels.length > 0) {
		console.log(`  Allowed models    : ${policy.allowedModels.join(", ")}`);
	}
	console.log();
}

// ─── setra governance set-mode ────────────────────────────────────────────────

export async function runGovernanceSetMode(mode: string): Promise<void> {
	if (mode !== "cloud" && mode !== "hybrid" && mode !== "offline") {
		console.error(
			`Error: invalid mode "${mode}". Must be one of: cloud, hybrid, offline`,
		);
		process.exit(1);
	}

	const policy = loadGovernancePolicy();
	const updated: GovernancePolicy = {
		...policy,
		deploymentMode: mode as GovernancePolicy["deploymentMode"],
		// Offline mode implies blockNetworkAccess and zero cost
		...(mode === "offline"
			? { blockNetworkAccess: true, maxCostPerRunUsd: 0 }
			: {}),
	};

	saveGovernancePolicy(updated);

	const noColor = process.env["NO_COLOR"] === "1";
	const green = noColor ? "" : "\x1b[32m";
	const reset = noColor ? "" : "\x1b[0m";

	console.log(`${green}✓${reset} Deployment mode set to "${mode}".`);
	console.log(`  Policy saved to ${getGovernancePolicyPath()}`);
	if (mode === "offline") {
		console.log(
			`  ${green}Block network access${reset} and ${green}zero cost cap${reset} automatically applied.`,
		);
	}
}

// ─── setra governance audit ───────────────────────────────────────────────────

export async function runGovernanceAudit(): Promise<void> {
	const policy = loadGovernancePolicy();

	if (!policy.auditLog.enabled) {
		console.log(
			"Audit logging is disabled. Enable it in the governance policy to start recording.",
		);
		return;
	}

	const entries = readAuditLog(policy, 50);

	if (entries.length === 0) {
		console.log("Audit log is empty.");
		return;
	}

	const noColor = process.env["NO_COLOR"] === "1";
	const dim = noColor ? "" : "\x1b[2m";
	const reset = noColor ? "" : "\x1b[0m";
	const yellow = noColor ? "" : "\x1b[33m";
	const red = noColor ? "" : "\x1b[31m";
	const green = noColor ? "" : "\x1b[32m";
	const cyan = noColor ? "" : "\x1b[36m";

	const eventColor = (event: string): string => {
		if (noColor) return "";
		if (event.startsWith("run:")) return cyan;
		if (event.includes("denied")) return red;
		if (event.includes("approved")) return green;
		if (event.includes("downgraded")) return yellow;
		return dim;
	};

	console.log(
		`\nAudit Log — last ${entries.length} entries (${policy.auditLog.path})\n`,
	);
	console.log(`${"─".repeat(90)}`);

	for (const entry of [...entries].reverse()) {
		const ts = new Date(entry.ts).toLocaleString();
		const detail = entry.detail
			? ` ${dim}${JSON.stringify(entry.detail)}${reset}`
			: "";
		const agent = entry.agentId ? ` ${dim}[${entry.agentId}]${reset}` : "";
		const model = entry.model ? ` ${dim}${entry.model}${reset}` : "";
		console.log(
			`${dim}${ts}${reset}  ${eventColor(entry.event)}${entry.event}${reset}${agent}${model}${detail}`,
		);
	}
	console.log();
}

// ─── setra governance check ───────────────────────────────────────────────────

export async function runGovernanceCheck(modelId: string): Promise<void> {
	const policy = loadGovernancePolicy();
	const error = validateModelChoice(modelId, policy);

	const noColor = process.env["NO_COLOR"] === "1";
	const green = noColor ? "" : "\x1b[32m";
	const red = noColor ? "" : "\x1b[31m";
	const reset = noColor ? "" : "\x1b[0m";

	if (error === null) {
		console.log(
			`${green}✓${reset} Model "${modelId}" is allowed by the governance policy.`,
		);
		console.log(`  Mode: ${policy.deploymentMode}`);
	} else {
		console.log(`${red}✗${reset} Model "${modelId}" is BLOCKED.`);
		console.log(`  Reason: ${error}`);
		process.exit(1);
	}
}
