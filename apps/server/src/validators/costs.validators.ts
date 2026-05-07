import { z } from "zod";

export const UpdateAgentBudgetSchema = z.object({
	limitUsd: z.number().optional(),
	periodDays: z.number().optional(),
	alertPercent: z.number().optional(),
});
