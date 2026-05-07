import { z } from "zod";

export const CreateWorkspaceSchema = z.object({
	name: z.string().min(1),
	type: z.string().optional(),
	isDefault: z.boolean().optional(),
	config: z.record(z.unknown()).optional(),
	companyId: z.string().optional(),
});

export const UpdateWorkspaceSchema = z.object({
	name: z.string().min(1).optional(),
	type: z.string().optional(),
	config: z.record(z.unknown()).optional(),
});
