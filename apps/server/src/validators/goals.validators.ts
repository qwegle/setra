import { z } from "zod";

export const CreateGoalSchema = z.object({
	companyId: z.string().optional(),
	title: z.string().min(1),
	description: z.string().optional(),
	status: z.string().optional(),
	parentGoalId: z.string().optional(),
});

export const UpdateGoalSchema = z.object({
	companyId: z.string().optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	status: z.string().optional(),
	parentGoalId: z.string().optional(),
});
