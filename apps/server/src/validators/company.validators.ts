import { z } from "zod";

export const UpdateCompanySettingsSchema = z.object({
	name: z.string().optional(),
	slug: z.string().optional(),
	domain: z.string().optional(),
	timezone: z.string().optional(),
	defaultModel: z.string().optional(),
	isOfflineOnly: z.boolean().optional(),
	brandColor: z.string().optional(),
	logoUrl: z.string().optional(),
	// Tier 0.5 (CLI-only adapter pivot).
	preferredCli: z
		.enum(["claude", "codex", "gemini", "opencode", "cursor"])
		.nullable()
		.optional(),
	legacyApiKeysEnabled: z.boolean().optional(),
	env_vars: z.record(z.string()).optional(),
	envVars: z.record(z.string()).optional(),
});

export const UpdateMemberRoleSchema = z.object({
	role: z.string().min(1),
});

export const CreateInviteSchema = z.object({
	email: z.string().min(1),
	role: z.string().optional(),
});
