import { getCompanySettings } from "./company-settings.js";

export const GOVERNANCE_APPROVAL_ACTIONS = [
	"task_start",
	"pr_merge",
	"agent_hire",
	"deploy",
] as const;

export type GovernanceApprovalAction =
	(typeof GOVERNANCE_APPROVAL_ACTIONS)[number];

function coerceApprovalActions(value: unknown): GovernanceApprovalAction[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(action): action is GovernanceApprovalAction =>
			typeof action === "string" &&
			(GOVERNANCE_APPROVAL_ACTIONS as readonly string[]).includes(action),
	);
}

export function getApprovalActionsFromSettings(
	settings: Record<string, unknown>,
): GovernanceApprovalAction[] {
	if (settings["governance_auto_approve"] === true) return [];
	const configured = coerceApprovalActions(
		settings["governance_approval_actions"],
	);
	return configured.length > 0 ? configured : [...GOVERNANCE_APPROVAL_ACTIONS];
}

export function getApprovalActionsForCompany(
	companyId: string | null | undefined,
): GovernanceApprovalAction[] {
	return getApprovalActionsFromSettings(getCompanySettings(companyId));
}

export function companyRequiresApproval(
	companyId: string | null | undefined,
	action: GovernanceApprovalAction,
): boolean {
	return getApprovalActionsForCompany(companyId).includes(action);
}
