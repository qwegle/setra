import { z } from "zod";

export const UpdateAdapterSchema = z.object({
	enabled: z.boolean().optional(),
	config: z.union([z.string(), z.record(z.unknown())]).optional(),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	defaultModel: z.string().optional(),
	isConfigured: z.boolean().optional(),
});

export const UpdatePluginConfigSchema = z.object({
	config: z.unknown(),
});

export const TogglePluginSchema = z
	.object({
		enabled: z.boolean().optional(),
	})
	.passthrough();

export const ToggleFlagSchema = z
	.object({
		enabled: z.boolean(),
	})
	.passthrough();
