import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const ProjectPlanStatusSchema = z.enum([
	"none",
	"draft",
	"approved",
	"in_progress",
	"completed",
]);

export const CreateProjectSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	companyId: z.string().optional(),
	color: z.string().regex(HEX_COLOR).optional(),
	workspacePath: z.string().optional(),
	repoUrl: z.string().url().nullable().optional(),
	requirements: z.string().optional(),
	planStatus: ProjectPlanStatusSchema.optional(),
});

export const UpdateProjectSchema = z.object({
	name: z.string().min(1).optional(),
	description: z.string().nullable().optional(),
	color: z.string().regex(HEX_COLOR).optional(),
	workspacePath: z.string().nullable().optional(),
	repoUrl: z.string().url().nullable().optional(),
	defaultBranch: z.string().trim().min(1).nullable().optional(),
	requirements: z.string().nullable().optional(),
	planStatus: ProjectPlanStatusSchema.optional(),
});
