import { z } from "zod";

export const TestProviderSchema = z
	.object({
		apiKey: z.string().optional(),
	})
	.passthrough();

export const PullModelSchema = z.object({
	name: z.string().min(1),
});

export const UpdateLlmSettingsSchema = z.object({
	ollamaUrl: z.string().optional(),
	lmstudioUrl: z.string().optional(),
	defaultOfflineModel: z.string().optional(),
	maxConcurrentPulls: z.number().optional(),
	defaultModel: z.string().optional(),
	defaultReasoningTier: z.string().optional(),
	budgetAlertPercent: z.number().optional(),
	openrouterApiKey: z.string().optional(),
	groqApiKey: z.string().optional(),
	togetherApiKey: z.string().optional(),
});
