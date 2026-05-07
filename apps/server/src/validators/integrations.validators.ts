import { z } from "zod";

export const CreateIntegrationSchema = z.object({
	type: z.string().min(1),
	name: z.string().optional(),
	config: z.record(z.string()).optional(),
});

export const UpdateIntegrationSchema = z.object({
	status: z.string().optional(),
	config: z.record(z.string()).optional(),
});

export const CreateSecretSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	value: z.string().optional(),
});

export const UpdateSecretSchema = z.object({
	value: z.string().min(1),
});
