import { z } from "zod";

export const CreateSkillSchema = z.object({
	name: z.string().min(1),
	slug: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(),
	trigger: z.string().optional(),
	prompt: z.string().optional(),
	isActive: z.boolean().optional(),
	companyId: z.string().optional(),
});

export const UpdateSkillSchema = z.object({
	name: z.string().optional(),
	slug: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(),
	trigger: z.string().optional(),
	prompt: z.string().optional(),
	isActive: z.boolean().optional(),
});
