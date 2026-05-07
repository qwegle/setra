import { z } from "zod";

export const CreateRoutineSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	schedule: z.string().optional(),
	agentId: z.string().optional(),
	prompt: z.string().optional(),
	isActive: z.boolean().optional(),
	companyId: z.string().optional(),
});

export const UpdateRoutineSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	schedule: z.string().optional(),
	agentId: z.string().optional(),
	prompt: z.string().optional(),
	isActive: z.boolean().optional(),
});
