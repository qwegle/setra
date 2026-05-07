import { z } from "zod";

export const UpdateCloneModeSchema = z.object({
	mode: z.enum(["training", "locked"]),
});

export const AnswerQuestionSchema = z.object({
	answer: z.string().min(1),
});

export const ObserveSchema = z.object({
	content: z.string().min(1),
	source: z.string().optional(),
	weight: z.number().optional(),
});
