import { z } from "zod";

export const UpdateBudgetSettingsSchema = z.object({
	limitUsd: z.number().nullable().optional(),
	periodDays: z.number().optional(),
	alertPercent: z.number().optional(),
});
