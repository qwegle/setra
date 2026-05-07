import { createMachine } from "xstate";

export const RUN_STATUSES = [
	"pending",
	"running",
	"completed",
	"failed",
	"cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunRecord {
	id: string;
	agentId: string;
	companyId: string | null;
	issueId: string | null;
	status: RunStatus;
}

export const runLifecycleMachine = createMachine({
	id: "runLifecycle",
	initial: "pending",
	states: {
		pending: { on: { START: "running", CANCEL: "cancelled" } },
		running: {
			on: {
				HEARTBEAT: "running",
				COMPLETE: "completed",
				FAIL: "failed",
				CANCEL: "cancelled",
			},
		},
		completed: { type: "final" },
		failed: { type: "final" },
		cancelled: { type: "final" },
	},
});

const RUN_STATUS_TARGETS: Record<RunStatus, readonly RunStatus[]> = {
	pending: ["running", "cancelled"],
	running: ["running", "completed", "failed", "cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

export function isTerminalRunStatus(status: RunStatus): boolean {
	return (
		status === "completed" || status === "failed" || status === "cancelled"
	);
}

export function canTransitionRunStatus(
	from: RunStatus,
	to: RunStatus,
): boolean {
	return from === to || RUN_STATUS_TARGETS[from].includes(to);
}
