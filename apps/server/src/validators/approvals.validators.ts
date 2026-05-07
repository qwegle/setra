import { z } from "zod";

export const RejectApprovalSchema = z
	.object({
		reason: z.string().optional(),
	})
	.passthrough();
