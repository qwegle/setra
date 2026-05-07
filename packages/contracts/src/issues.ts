import {
	ISSUE_LIFECYCLE_STAGES,
	ISSUE_PRIORITIES,
	ISSUE_STATUSES,
} from "@setra/domain";
import { z } from "zod";

export const STATUS_ENUM = ISSUE_STATUSES;
export const PRIORITY_ENUM = ISSUE_PRIORITIES;

export const TEST_STATUS_ENUM = [
	"none",
	"pending",
	"running",
	"passed",
	"failed",
] as const;

export const CreateIssueSchema = z.object({
	projectId: z.string().uuid(),
	title: z.string().min(1),
	description: z.string().optional(),
	status: z.enum(STATUS_ENUM).optional(),
	priority: z.enum(PRIORITY_ENUM).optional(),
	parentIssueId: z.string().min(1).optional(),
	acceptanceCriteria: z.string().optional(),
	testCommand: z.string().optional(),
	testStatus: z.enum(TEST_STATUS_ENUM).optional(),
});

export const UpdateIssueSchema = z.object({
	title: z.string().optional(),
	description: z.string().nullable().optional(),
	status: z.enum(STATUS_ENUM).optional(),
	priority: z.enum(PRIORITY_ENUM).optional(),
	assignedAgentId: z.string().nullable().optional(),
	dueDate: z.string().nullable().optional(),
	labels: z.string().optional(),
	tags: z.string().optional(),
	acceptanceCriteria: z.string().optional(),
	testCommand: z.string().optional(),
	testStatus: z.enum(TEST_STATUS_ENUM).optional(),
});

export const AddCommentSchema = z.object({
	body: z.string().min(1),
	author: z.string().optional(),
});

export const BranchIssueSchema = z.object({}).passthrough();
export const CommitIssueSchema = z.object({
	message: z.string().min(1),
	files: z.array(z.string()).optional(),
});
export const OpenPrSchema = z.object({
	title: z.string().min(1),
	body: z.string().default(""),
});
export const MergePrSchema = z.object({}).passthrough();
export const LifecycleStageSchema = z.object({
	stage: z.enum(ISSUE_LIFECYCLE_STAGES),
});
