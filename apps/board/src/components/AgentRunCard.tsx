import type { AgentRun } from "../lib/api";
import {
	formatCost,
	formatDuration,
	formatTokens,
	timeAgo,
} from "../lib/utils";
import { cn } from "../lib/utils";

interface Props {
	run: AgentRun;
	isSelected?: boolean;
	onClick?: () => void;
}

const RUN_STATUS_DOT: Partial<Record<AgentRun["status"], string>> = {
	running: "bg-accent-green animate-pulse",
	done: "bg-setra-400",
	completed: "bg-setra-400",
	pending: "bg-muted-foreground/50",
	failed: "bg-accent-red",
	cancelled: "bg-muted-foreground",
};

const RUN_STATUS_LABEL: Partial<Record<AgentRun["status"], string>> = {
	running: "Running",
	done: "Done",
	completed: "Completed",
	pending: "Pending",
	failed: "Failed",
	cancelled: "Cancelled",
};

export function AgentRunCard({ run, isSelected, onClick }: Props) {
	const dotClass = RUN_STATUS_DOT[run.status] ?? "bg-muted-foreground";
	const label = RUN_STATUS_LABEL[run.status] ?? run.status;
	const totalTokens = run.inputTokens + run.outputTokens;

	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"w-full text-left px-4 py-3 rounded-lg border transition-all",
				"flex flex-col gap-1.5 hover:border-setra-600/30",
				isSelected
					? "bg-setra-600/10 border-setra-500/50 ring-1 ring-setra-500/30"
					: "bg-card/40 border-border/40 hover:bg-card/60",
			)}
		>
			{/* Title row */}
			<div className="flex items-center gap-2 min-w-0">
				<span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotClass)} />
				<span className="text-sm font-medium text-foreground truncate flex-1">
					{run.issueTitle ?? "Untitled run"}
				</span>
				<span className="text-xs text-muted-foreground/60 flex-shrink-0">
					{label}
				</span>
			</div>

			{/* Meta row */}
			<div className="flex items-center gap-3 text-xs text-muted-foreground/60 pl-4">
				<span>{timeAgo(run.startedAt)}</span>
				{run.durationMs != null && (
					<span>{formatDuration(run.durationMs)}</span>
				)}
				<span>{formatTokens(totalTokens)} tok</span>
				<span className="ml-auto font-medium text-muted-foreground">
					{formatCost(run.costUsd)}
				</span>
			</div>
		</button>
	);
}
