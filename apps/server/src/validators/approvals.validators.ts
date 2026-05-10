import { z } from "zod";

export const RejectApprovalSchema = z
	.object({
		reason: z.string().optional(),
	})
	.passthrough();

/**
 * Structured 4-option approval outcomes - mirrors WUPHF's humanInterview
 * options ("approve", "approve_with_note", "reject", "reject_with_steer").
 *
 * - approve                : Proceed as proposed.
 * - approve_with_note      : Proceed with operator-supplied constraints
 *                            captured in `note` (required, 1..2000 chars).
 *                            The downstream consumer is expected to surface
 *                            the note to the agent as additional guidance.
 * - reject                 : Stop. `note` is optional.
 * - reject_with_steer      : Stop and redirect with a corrective prompt
 *                            captured in `note` (required).
 */
export const ApprovalOutcomeSchema = z.enum([
	"approve",
	"approve_with_note",
	"reject",
	"reject_with_steer",
]);

export const ResolveApprovalSchema = z
	.object({
		outcome: ApprovalOutcomeSchema,
		note: z.string().min(1).max(2000).optional(),
	})
	.passthrough()
	.refine(
		(v) =>
			!(
				v.outcome === "approve_with_note" || v.outcome === "reject_with_steer"
			) ||
			(typeof v.note === "string" && v.note.trim().length > 0),
		{
			message:
				"note is required when outcome is approve_with_note or reject_with_steer",
			path: ["note"],
		},
	);
