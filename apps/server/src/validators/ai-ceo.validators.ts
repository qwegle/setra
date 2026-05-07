import { z } from "zod";

export const ChatSchema = z.object({
	messages: z.array(
		z.object({
			role: z.enum(["user", "assistant", "system"]),
			content: z.string(),
		}),
	),
	companyName: z.string().optional(),
	companyGoal: z.string().optional(),
	agentSlug: z.string().optional(),
});
