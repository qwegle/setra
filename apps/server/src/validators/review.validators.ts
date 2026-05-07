import { z } from "zod";

export const CreateReviewItemSchema = z.object({
	type: z.string().optional(),
	title: z.string().optional(),
	companyId: z.string().optional(),
});

export const UpdateReviewItemSchema = z.object({
	status: z.string().optional(),
	comment: z.string().optional(),
});
