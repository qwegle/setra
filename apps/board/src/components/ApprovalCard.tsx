import { CircleDot, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { Approval } from "../lib/api";
import { cn, timeAgo } from "../lib/utils";

interface Props {
	approval: Approval;
	onApprove: () => void;
	onReject: () => void;
	isLoading?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
	task_start: "Task start",
	pr_merge: "PR merge",
	agent_hire: "Agent setup",
	budget_override: "Budget override",
	approval: "Approval",
	code_review: "Code review",
	security_sign_off: "Security sign-off",
};

const TYPE_STYLES: Record<string, string> = {
	task_start: "bg-setra-500/10 text-setra-300 border-setra-500/20",
	pr_merge: "bg-accent-purple/10 text-accent-purple border-accent-purple/20",
	agent_hire: "bg-accent-green/10 text-accent-green border-accent-green/20",
	budget_override:
		"bg-accent-yellow/10 text-accent-yellow border-accent-yellow/20",
};

export function ApprovalCard({
	approval,
	onApprove,
	onReject,
	isLoading,
}: Props) {
	const typeLabel =
		TYPE_LABELS[approval.type ?? ""] ?? approval.type ?? "Approval";
	const typeStyle =
		TYPE_STYLES[approval.type ?? ""] ??
		"bg-muted/40 text-muted-foreground border-border/50";

	return (
		<div className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-lg p-4 space-y-3">
			<div className="flex items-start gap-3">
				<ShieldCheck className="w-4 h-4 text-setra-400 shrink-0 mt-0.5" />
				<div className="min-w-0 flex-1 space-y-2">
					<div className="flex flex-wrap items-center gap-2 text-sm">
						<span className="font-medium text-foreground">
							{approval.requestedBy ?? "Unknown agent"}
						</span>
						<span
							className={cn(
								"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
								typeStyle,
							)}
						>
							{typeLabel}
						</span>
						<span className="ml-auto text-xs text-muted-foreground/50 shrink-0">
							{timeAgo(approval.createdAt)}
						</span>
					</div>

					{approval.title && (
						<p className="text-sm font-medium text-foreground">
							{approval.title}
						</p>
					)}

					{approval.description && (
						<p className="text-sm text-foreground/90 leading-relaxed">
							{approval.description}
						</p>
					)}

					{(approval.entityTitle ||
						approval.entitySlug ||
						approval.entityUrl) && (
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<CircleDot className="w-3.5 h-3.5 shrink-0" />
							{approval.entityType === "issue" && approval.entityId ? (
								<Link
									to={`/issues/${approval.entityId}`}
									className="text-setra-400 hover:text-setra-300 transition-colors"
								>
									{approval.entitySlug ??
										approval.entityTitle ??
										approval.entityId}
								</Link>
							) : (
								<span>
									{approval.entitySlug ??
										approval.entityTitle ??
										approval.entityId}
								</span>
							)}
							{approval.entityTitle && (
								<span className="text-muted-foreground/70 truncate">
									{approval.entityTitle}
								</span>
							)}
							{approval.entityUrl && (
								<a
									href={approval.entityUrl}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-setra-400 hover:text-setra-300 transition-colors"
								>
									PR <ExternalLink className="w-3 h-3" />
								</a>
							)}
						</div>
					)}

					{approval.comment && (
						<p className="text-xs text-muted-foreground border-t border-border/30 pt-2">
							{approval.comment}
						</p>
					)}
				</div>
			</div>

			{approval.status === "pending" && (
				<div className="flex items-center justify-end gap-2 pt-1">
					<button
						type="button"
						onClick={onReject}
						disabled={isLoading}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent-red/15 text-accent-red border border-accent-red/20 hover:bg-accent-red/25 transition-colors disabled:opacity-50"
					>
						{isLoading ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : null}
						Reject
					</button>
					<button
						type="button"
						onClick={onApprove}
						disabled={isLoading}
						className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-accent-green/15 text-accent-green border border-accent-green/20 hover:bg-accent-green/25 transition-colors disabled:opacity-50"
					>
						{isLoading ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : null}
						Approve
					</button>
				</div>
			)}

			{approval.status !== "pending" && (
				<div
					className={cn(
						"flex items-center justify-end text-xs font-medium",
						approval.status === "approved"
							? "text-accent-green"
							: "text-accent-red",
					)}
				>
					{approval.status === "approved" ? "Approved" : "Rejected"}
				</div>
			)}
		</div>
	);
}
