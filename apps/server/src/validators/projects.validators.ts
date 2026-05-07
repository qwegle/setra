import {
	CreateProjectSchema as ContractsCreateProjectSchema,
	UpdateProjectSchema as ContractsUpdateProjectSchema,
} from "@setra/contracts/projects";
import { z } from "zod";

export const CreateProjectSchema = ContractsCreateProjectSchema;

export const UpdateProjectSchema = ContractsUpdateProjectSchema.extend({
	workspacePath: z.string().nullable().optional(),
	defaultBranch: z.string().trim().min(1).nullable().optional(),
});
