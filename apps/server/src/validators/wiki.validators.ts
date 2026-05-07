import { z } from "zod";

export const CreateWikiSchema = z.object({
	title: z.string().min(1),
	slug: z.string().optional(),
	category: z.string().optional(),
	tags: z.string().optional(),
	authorSlug: z.string().optional(),
	content: z.string().optional(),
	companyId: z.string().optional(),
});

export const UpdateWikiSchema = z.object({
	title: z.string().optional(),
	slug: z.string().optional(),
	category: z.string().optional(),
	tags: z.string().optional(),
	authorSlug: z.string().optional(),
	content: z.string().optional(),
});
