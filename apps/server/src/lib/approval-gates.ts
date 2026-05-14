import * as approvalsRepo from "../repositories/approvals.repo.js";
import { emit } from "../sse/handler.js";
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

/**
 * Centralized gate for governance-controlled actions outside the
 * issue/PR lifecycle (agent hires and deployments).
 *
 * Returns one of:
 *   - { allow: true } — no approval required, proceed.
 *   - { allow: false, approvalId, status: "pending" } — already gated,
 *     awaiting human resolution.
 *   - { allow: false, approvalId, status: "approved" } — operationally
 *     identical to allow:true, returned for symmetry so callers can
 *     audit which approval cleared the action.
 *   - { allow: false, approvalId, status: "rejected" } — terminal;
 *     caller must surface the rejection to the requester.
 *
 * The helper de-duplicates open approvals: calling it twice for the
 * same (companyId, entityType, entityId, action) returns the existing
 * pending approval rather than creating a duplicate row.
 */
export interface GovernanceGateResult {
	allow: boolean;
	approvalId?: string;
	status?: "pending" | "approved" | "rejected";
}

export interface GovernanceGateInput {
	companyId: string | null;
	action: GovernanceApprovalAction;
	entityType: string;
	entityId: string;
	title: string;
	description: string;
	requestedBy: string;
	riskLevel?: string;
	estimatedCostUsd?: number;
}

export async function ensureGovernanceApproval(
	input: GovernanceGateInput,
): Promise<GovernanceGateResult> {
	if (!input.companyId) return { allow: true };
	if (!companyRequiresApproval(input.companyId, input.action)) {
		return { allow: true };
	}

	const existing = await approvalsRepo.getLatestEntityApproval(
		input.entityId,
		input.companyId,
		input.action,
		input.entityType,
	);
	if (existing) {
		const status = existing.status as "pending" | "approved" | "rejected";
		if (status === "approved") return { allow: true, approvalId: existing.id };
		return { allow: false, approvalId: existing.id, status };
	}

	const created = await approvalsRepo.createApproval({
		companyId: input.companyId,
		type: input.action,
		entityType: input.entityType,
		entityId: input.entityId,
		title: input.title,
		description: input.description,
		requestedBy: input.requestedBy,
		riskLevel: input.riskLevel ?? "medium",
		estimatedCostUsd: input.estimatedCostUsd ?? null,
	});
	if (created) {
		try {
			emit("review_requested", {
				id: created.id,
				type: created.type,
				companyId: input.companyId,
				entityType: input.entityType,
				entityId: input.entityId,
			});
		} catch {
			/* SSE failures must not break the gate */
		}
	}
	return {
		allow: false,
		...(created?.id ? { approvalId: created.id } : {}),
		status: "pending",
	};
}
