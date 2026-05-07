import { RUN_STATUSES } from "@setra/domain";
import { z } from "zod";

export const AgentRunModeSchema = z.enum([
	"on_demand",
	"continuous",
	"scheduled",
]);

export const CreateTemplateSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	agent: z.string().min(1),
	model: z.string().optional(),
	systemPrompt: z.string().optional(),
	tools: z.array(z.string()).optional(),
	contextInject: z.unknown().optional(),
	estimatedCostTier: z.string().optional(),
});

export const HireAgentSchema = z.object({
	templateId: z.string().min(1),
	displayName: z.string().min(1),
	reportsTo: z.string().nullable().optional(),
	modelId: z.string().nullable().optional(),
	adapterType: z.string().nullable().optional(),
	runMode: AgentRunModeSchema.optional(),
	continuousIntervalMs: z.number().int().positive().optional(),
	idlePrompt: z.string().nullable().optional(),
});

export const UpdateRosterSchema = z.object({
	displayName: z.string().optional(),
	reportsTo: z.string().nullable().optional(),
	isActive: z.boolean().optional(),
	runMode: AgentRunModeSchema.optional(),
	continuousIntervalMs: z.number().int().positive().optional(),
	idlePrompt: z.string().nullable().optional(),
});

export const UpdateRosterModeSchema = z.object({
	runMode: AgentRunModeSchema,
	continuousIntervalMs: z.number().int().positive().optional(),
	idlePrompt: z.string().nullable().optional(),
});

export const UpdateRunStatusSchema = z.object({
	status: z.enum(RUN_STATUSES),
	exitCode: z.number().optional(),
	errorMessage: z.string().optional(),
	costUsd: z.number().optional(),
	promptTokens: z.number().optional(),
	completionTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
});

export const CreateAgentRunSchema = z
	.object({
		task: z.string().optional(),
		agentArgs: z.array(z.string()).optional(),
		issueId: z.string().optional(),
		model: z.string().optional(),
		complexity: z.enum(["trivial", "standard", "complex"] as const).optional(),
	})
	.passthrough();

export const UpdateAgentSchema = z.object({
	displayName: z.string().optional(),
	model: z.string().optional(),
	modelId: z.string().optional(),
	status: z.string().optional(),
	systemPrompt: z.string().optional(),
	adapterType: z.string().optional(),
	command: z.string().optional(),
	commandArgs: z.string().optional(),
	httpUrl: z.string().optional(),
	envVars: z.union([z.string(), z.record(z.string())]).optional(),
	allowedPermissions: z.union([z.string(), z.array(z.string())]).optional(),
	skills: z
		.union([
			z.string(),
			z.array(z.string()),
			z.array(
				z
					.object({
						id: z.string(),
						name: z.string().optional(),
						slug: z.string().optional(),
					})
					.passthrough(),
			),
		])
		.optional(),
	isActive: z.boolean().optional(),
	mode: z.string().optional(),
	autonomyLevel: z.enum(["none", "basic", "plus", "semi", "full"]).optional(),
	runMode: AgentRunModeSchema.optional(),
	continuousIntervalMs: z.number().int().positive().optional(),
	idlePrompt: z.string().nullable().optional(),
});

export const UpsertAgentBudgetSchema = z.object({
	limitUsd: z.number().nullable().optional(),
	periodDays: z.number().optional(),
	alertPercent: z.number().optional(),
});

export const GenerateInstructionsSchema = z.object({
	role: z.string().optional(),
	companyGoal: z.string().optional(),
	companyName: z.string().optional(),
});
