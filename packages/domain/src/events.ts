import type { EventEmitter } from "node:events";
import type { IssueLifecycleActor, IssueLifecycleStage } from "./issues.js";
import type { RunStatus } from "./runs.js";

export type DomainEvent =
	| {
			type: "issue.updated";
			companyId: string;
			issueId: string;
			projectId?: string;
			event?:
				| "created"
				| "updated"
				| "branch_created"
				| "commit"
				| "pr_opened"
				| "pr_merged"
				| "lifecycle";
			branchName?: string;
			sha?: string;
			prUrl?: string;
			lifecycleStage?: IssueLifecycleStage;
	  }
	| {
			type: "issue.lifecycle.transitioned";
			companyId: string;
			issueId: string;
			projectId: string;
			fromStage: IssueLifecycleStage;
			toStage: IssueLifecycleStage;
			actorType: IssueLifecycleActor;
			actorId?: string | null;
			noop: boolean;
	  }
	| {
			type: "run.updated";
			companyId: string | null;
			runId: string;
			agentId: string;
			issueId?: string | null;
			status?: RunStatus;
			event?: "created" | "heartbeat" | "status_changed";
	  }
	| {
			type: "run.completed";
			companyId: string | null;
			runId: string;
			agentId: string;
			issueId?: string | null;
			status: Extract<RunStatus, "completed" | "failed" | "cancelled">;
	  };

export interface EventBus<TEvent extends { type: string }> {
	publish(event: TEvent): void;
	subscribe(
		type: TEvent["type"] | "*",
		handler: (event: TEvent) => void,
	): () => void;
}

export type DomainEventEmitter = EventEmitter;
