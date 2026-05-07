import { createMachine } from "xstate";

export const ISSUE_STATUSES = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"done",
	"cancelled",
] as const;
export const ISSUE_PRIORITIES = [
	"none",
	"urgent",
	"high",
	"medium",
	"low",
] as const;
export const ISSUE_LIFECYCLE_STAGES = [
	"backlog",
	"branched",
	"committed",
	"pr_open",
	"in_review",
	"merged",
	"deployed",
	"verified",
	"cancelled",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export type IssueLifecycleStage = (typeof ISSUE_LIFECYCLE_STAGES)[number];
export type IssueLifecycleActor = "agent" | "human" | "system";

export interface IssueRecord {
	id: string;
	projectId: string;
	companyId: string | null;
	slug: string;
	title: string;
	description: string | null;
	status: IssueStatus;
	priority: IssuePriority;
	lifecycleStage: IssueLifecycleStage;
}

export const issueLifecycleMachine = createMachine({
	id: "issueLifecycle",
	initial: "backlog",
	states: {
		backlog: { on: { BRANCH: "branched", CANCEL: "cancelled" } },
		branched: {
			on: { COMMIT: "committed", OPEN_PR: "pr_open", CANCEL: "cancelled" },
		},
		committed: {
			on: { COMMIT: "committed", OPEN_PR: "pr_open", CANCEL: "cancelled" },
		},
		pr_open: {
			on: { REQUEST_REVIEW: "in_review", MERGE: "merged", CANCEL: "cancelled" },
		},
		in_review: { on: { MERGE: "merged", CANCEL: "cancelled" } },
		merged: { on: { DEPLOY: "deployed", CANCEL: "cancelled" } },
		deployed: { on: { VERIFY: "verified", CANCEL: "cancelled" } },
		verified: { type: "final" },
		cancelled: { type: "final" },
	},
});

const ISSUE_STAGE_TARGETS: Record<
	IssueLifecycleStage,
	readonly IssueLifecycleStage[]
> = {
	backlog: ["branched", "cancelled"],
	branched: ["committed", "pr_open", "cancelled"],
	committed: ["committed", "pr_open", "cancelled"],
	pr_open: ["in_review", "merged", "cancelled"],
	in_review: ["merged", "cancelled"],
	merged: ["deployed", "cancelled"],
	deployed: ["verified", "cancelled"],
	verified: [],
	cancelled: [],
};

export function mapIssueLifecycleStageToStatus(
	stage: IssueLifecycleStage,
): IssueStatus {
	switch (stage) {
		case "backlog":
			return "backlog";
		case "branched":
			return "todo";
		case "committed":
		case "pr_open":
			return "in_progress";
		case "in_review":
		case "merged":
			return "in_review";
		case "deployed":
		case "verified":
			return "done";
		case "cancelled":
			return "cancelled";
	}
}

export function canTransitionIssueLifecycleStage(
	from: IssueLifecycleStage | null,
	to: IssueLifecycleStage,
): boolean {
	const current = from ?? "backlog";
	return ISSUE_STAGE_TARGETS[current].includes(to);
}
