import { z } from "zod";

export const CreateCompanySchema = z.object({
	name: z.string().min(1),
	goal: z.string().optional(),
	type: z.string().optional(),
	size: z.string().optional(),
	isOfflineOnly: z.boolean().optional(),
	brandColor: z.string().optional(),
	logoUrl: z.string().optional(),
});

export const UpdateCompanySchema = z
	.object({
		name: z.string().optional(),
		goal: z.string().optional(),
		type: z.string().optional(),
		size: z.string().optional(),
		brandColor: z.string().optional(),
		logoUrl: z.string().optional(),
		isOfflineOnly: z.boolean().optional(),
	})
	.passthrough();
