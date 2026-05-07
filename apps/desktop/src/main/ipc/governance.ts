import {
	type GovernancePolicy,
	appendAuditLog,
	clearAuditLog,
	getGovernancePolicyPath,
	isGovernancePolicyFilePresent,
	loadGovernancePolicy,
	readAuditLog,
	saveGovernancePolicy,
	validateModelChoice,
} from "@setra/agent-runner/governance";
import { ipcMain } from "electron";

export function registerGovernanceHandlers(): void {
	// governance:getPolicy → GovernancePolicy
	ipcMain.handle("governance:getPolicy", () => {
		const policy = loadGovernancePolicy();
		return {
			...policy,
			_policyFilePath: getGovernancePolicyPath(),
			_policyFilePresent: isGovernancePolicyFilePresent(),
		};
	});

	// governance:savePolicy → void
	ipcMain.handle(
		"governance:savePolicy",
		(_e, { policy }: { policy: GovernancePolicy }) => {
			saveGovernancePolicy(policy);
			appendAuditLog(
				{
					ts: new Date().toISOString(),
					event: "policy:saved",
					detail: { deploymentMode: policy.deploymentMode },
				},
				policy,
			);
		},
	);

	// governance:validate → { allowed: boolean; reason?: string }
	ipcMain.handle(
		"governance:validate",
		(_e, { modelId }: { modelId: string }) => {
			const policy = loadGovernancePolicy();
			const reason = validateModelChoice(modelId, policy);
			return { allowed: reason === null, reason: reason ?? undefined };
		},
	);

	// governance:getAuditLog → AuditEntry[]
	ipcMain.handle(
		"governance:getAuditLog",
		(_e, { limit }: { limit?: number } = {}) => {
			const policy = loadGovernancePolicy();
			return readAuditLog(policy, limit ?? 50);
		},
	);

	// governance:clearAuditLog → void
	ipcMain.handle("governance:clearAuditLog", () => {
		const policy = loadGovernancePolicy();
		clearAuditLog(policy);
	});
}
