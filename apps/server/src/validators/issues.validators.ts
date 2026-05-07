import {
	AddCommentSchema,
	CreateIssueSchema as BaseCreateIssueSchema,
	UpdateIssueSchema as BaseUpdateIssueSchema,
	BranchIssueSchema,
	CommitIssueSchema,
	LifecycleStageSchema,
	MergePrSchema,
	OpenPrSchema,
	PRIORITY_ENUM,
	STATUS_ENUM,
	TEST_STATUS_ENUM,
} from "@setra/contracts/issues";
import { z } from "zod";

export { STATUS_ENUM, PRIORITY_ENUM, TEST_STATUS_ENUM };

export const CreateIssueSchema = BaseCreateIssueSchema.extend({
	acceptance_criteria: z.string().optional(),
	test_command: z.string().optional(),
	test_status: z.enum(TEST_STATUS_ENUM).optional(),
});

export const UpdateIssueSchema = BaseUpdateIssueSchema.extend({
	dueDate: z.string().nullable().optional(),
	acceptance_criteria: z.string().optional(),
	test_command: z.string().optional(),
	test_status: z.enum(TEST_STATUS_ENUM).optional(),
});

export const LinkIssueSchema = z.object({
	commitSha: z
		.string()
		.trim()
		.regex(/^[a-f0-9]{7,40}$/i)
		.optional(),
	prUrl: z.string().trim().url().optional(),
	prState: z.enum(["open", "merged", "closed"]).optional(),
});

export {
	AddCommentSchema,
	BranchIssueSchema,
	CommitIssueSchema,
	OpenPrSchema,
	MergePrSchema,
	LifecycleStageSchema,
};
