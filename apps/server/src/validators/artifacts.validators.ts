import { z } from "zod";

export const CreateArtifactSchema = z.object({
	name: z.string().min(1),
	issueId: z.string().optional(),
	agentSlug: z.string().optional(),
	mimeType: z.string().optional(),
	content: z.string().optional(),
	companyId: z.string().optional(),
});
