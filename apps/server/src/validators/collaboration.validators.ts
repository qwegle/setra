import { z } from "zod";

export const CreateMessageSchema = z.object({
	channel: z.string().optional(),
	body: z.string().optional(),
	agentSlug: z.string().optional(),
	companyId: z.string().optional(),
});
