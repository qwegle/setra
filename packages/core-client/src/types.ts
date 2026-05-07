// Canonical types for the setra.sh control-plane API.
// These mirror the DB types but are safe to publish (no drizzle imports).

export type IssueStatus =
	| "backlog"
	| "todo"
	| "in_progress"
	| "in_review"
	| "done"
	| "cancelled";
export type IssuePriority = "none" | "urgent" | "high" | "medium" | "low";
export type IssueTestStatus =
	| "none"
	| "pending"
	| "running"
	| "passed"
	| "failed";
export type AgentStatus =
	| "idle"
	| "running"
	| "waiting_approval"
	| "paused"
	| "error"
	| "done";

export interface BoardProject {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	issueCount: number;
	activeAgentCount: number;
	totalCostUsd: number;
	createdAt: string;
	updatedAt: string;
}

export interface Issue {
	id: string;
	projectId: string;
	slug: string;
	title: string;
	description: string | null;
	status: IssueStatus;
	priority: IssuePriority;
	assignedAgentId: string | null;
	linkedPlotId: string | null;
	acceptanceCriteria?: string;
	testCommand?: string;
	testStatus?: IssueTestStatus;
	estimatedCostUsd: number | null;
	actualCostUsd: number | null;
	createdAt: string;
	updatedAt: string;
}

export interface IssueComment {
	id: string;
	issueId: string;
	author: string;
	body: string;
	createdAt: string;
	updatedAt: string;
}

export interface Agent {
	id: string;
	slug: string;
	role: string;
	model: string;
	status: AgentStatus;
	currentIssueId: string | null;
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	lastActiveAt: string | null;
}

export interface BudgetSummary {
	dailyCostUsd: number;
	weeklyCostUsd: number;
	monthlyCostUsd: number;
	cacheHitRate: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	topAgents: Array<{ slug: string; costUsd: number; model: string }>;
}

export interface ApprovalRequest {
	id: string;
	issueId: string | null;
	agentSlug: string;
	prompt: string;
	context: string | null;
	status: "pending" | "approved" | "rejected" | "timed_out";
	resolution: string | null;
	resolvedAt: string | null;
	createdAt: string;
}

// Inputs
export interface CreateProjectInput {
	name: string;
	description?: string;
}
export interface CreateIssueInput {
	projectId: string;
	title: string;
	description?: string;
	status?: IssueStatus;
	priority?: IssuePriority;
	acceptanceCriteria?: string;
	testCommand?: string;
	testStatus?: IssueTestStatus;
}
export interface UpdateIssueInput {
	title?: string;
	description?: string | null;
	status?: IssueStatus;
	priority?: IssuePriority;
	assignedAgentId?: string | null;
	acceptanceCriteria?: string;
	testCommand?: string;
	testStatus?: IssueTestStatus;
}

// SSE event types emitted by the server
export type BoardEvent =
	| { type: "issue:updated"; data: { id: string; projectId: string } }
	| { type: "agent:updated"; data: { slug: string } }
	| { type: "run:completed"; data: { runId: string; agentSlug: string } }
	| { type: "project:updated"; data: { id: string } }
	| { type: "approval:pending"; data: { id: string; agentSlug: string } }
	| { type: "ping"; data: Record<string, never> };
