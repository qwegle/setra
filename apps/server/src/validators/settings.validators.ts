import { z } from "zod";

const ApprovalActionSchema = z.enum([
	"task_start",
	"pr_merge",
	"agent_hire",
	"deploy",
]);

export const SaveSettingsSchema = z.object({
	companyId: z.string().optional(),
	anthropicApiKey: z.string().optional(),
	openaiApiKey: z.string().optional(),
	openrouterApiKey: z.string().optional(),
	groqApiKey: z.string().optional(),
	geminiApiKey: z.string().optional(),
	togetherApiKey: z.string().optional(),
	tavilyApiKey: z.string().optional(),
	braveApiKey: z.string().optional(),
	serperApiKey: z.string().optional(),
	webSearchEnabled: z.boolean().optional(),
	defaultModel: z.string().optional(),
	smallModel: z.string().optional(),
	budget: z
		.object({
			dailyUsd: z.number().optional(),
			perRunUsd: z.number().optional(),
			alertAt: z.number().optional(),
		})
		.optional(),
	governance: z
		.object({
			deployMode: z.string().optional(),
			autoApprove: z.boolean().optional(),
			approvalActions: z.array(ApprovalActionSchema).optional(),
			reviewRisk: z.string().optional(),
		})
		.optional(),
	autonomy: z
		.object({
			autoDispatchEnabled: z.boolean().optional(),
			maxParallelRuns: z.number().int().min(1).max(50).optional(),
		})
		.optional(),
	memory: z
		.object({
			compactionEnabled: z.boolean().optional(),
			maxChunks: z.number().int().min(100).max(5000).optional(),
			keepChunks: z.number().int().min(20).max(1000).optional(),
		})
		.optional(),
	appearance: z
		.object({
			theme: z.enum(["dark", "light", "system"]).optional(),
			fontFamily: z.string().optional(),
			fontSize: z.number().int().min(10).max(24).optional(),
			uiScale: z.number().int().min(80).max(120).optional(),
			sidebarPosition: z.enum(["left", "right"]).optional(),
		})
		.optional(),
});

export const PatchSettingsSchema = z.object({
	companyId: z.string().optional(),
	defaultModel: z.string().optional(),
	smallModel: z.string().optional(),
	webSearchEnabled: z.boolean().optional(),
	governance: z
		.object({
			deployMode: z.string().optional(),
			autoApprove: z.boolean().optional(),
			approvalActions: z.array(ApprovalActionSchema).optional(),
			reviewRisk: z.string().optional(),
		})
		.optional(),
	autonomy: z
		.object({
			autoDispatchEnabled: z.boolean().optional(),
			maxParallelRuns: z.number().int().min(1).max(50).optional(),
		})
		.optional(),
	memory: z
		.object({
			compactionEnabled: z.boolean().optional(),
			maxChunks: z.number().int().min(100).max(5000).optional(),
			keepChunks: z.number().int().min(20).max(1000).optional(),
		})
		.optional(),
	appearance: z
		.object({
			theme: z.enum(["dark", "light", "system"]).optional(),
			fontFamily: z.string().optional(),
			fontSize: z.number().int().min(10).max(24).optional(),
			uiScale: z.number().int().min(80).max(120).optional(),
			sidebarPosition: z.enum(["left", "right"]).optional(),
		})
		.optional(),
});
