import { z } from "zod";

export const ParseGoalSchema = z
	.object({
		goal: z.string().optional(),
	})
	.passthrough();
