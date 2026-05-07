import { z } from "zod";

export const SaveFileSchema = z.object({
	projectId: z.string().min(1),
	path: z.string().min(1),
	content: z.string(),
});

export const CreateFileSchema = z.object({
	projectId: z.string().min(1),
	path: z.string().min(1),
	content: z.string().optional(),
});

export const CreateFolderSchema = z.object({
	projectId: z.string().min(1),
	path: z.string().min(1),
});

export const RenamePathSchema = z.object({
	projectId: z.string().min(1),
	fromPath: z.string().min(1),
	toPath: z.string().min(1),
});
