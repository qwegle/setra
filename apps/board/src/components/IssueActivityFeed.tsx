import type { ActivityEntry } from "../lib/api";
import { cn } from "../lib/utils";

interface IssueActivityFeedProps {
	activity: ActivityEntry[];
}

function formatRelativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

function initials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

function formatEventDescription(event: string, payload: string | null): string {
	try {
		const p = payload ? JSON.parse(payload) : null;
		switch (event) {
			case "created":
				return "created this issue";
			case "status_changed":
				return `changed status to ${p?.to ?? "unknown"}`;
			case "assigned":
				return `assigned to ${p?.to ?? "someone"}`;
			case "unassigned":
				return `unassigned from ${p?.from ?? "someone"}`;
			case "commented":
				return "left a comment";
			case "labeled":
				return `added label "${p?.label ?? ""}"`;
			case "unlabeled":
				return `removed label "${p?.label ?? ""}"`;
			case "priority_changed":
				return `changed priority to ${p?.to ?? "unknown"}`;
			case "escalated":
				return `escalated to ${p?.to ?? "review"}`;
			default:
				return event.replace(/_/g, " ");
		}
	} catch {
		return event.replace(/_/g, " ");
	}
}

function dotColorForEvent(event: string): string {
	switch (event) {
		case "created":
			return "bg-setra-400";
		case "status_changed":
			return "bg-blue-400";
		case "assigned":
			return "bg-purple-400";
		case "commented":
			return "bg-muted-foreground/50";
		case "labeled":
			return "bg-yellow-400";
		case "priority_changed":
			return "bg-orange-400";
		case "escalated":
			return "bg-amber-400";
		default:
			return "bg-muted-foreground/30";
	}
}

export function IssueActivityFeed({ activity }: IssueActivityFeedProps) {
	const sorted = [...activity].sort(
		(a, b) =>
			new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
	);

	if (sorted.length === 0) {
		return (
			<div className="px-4 py-8 text-center">
				<p className="text-xs text-muted-foreground/50">No activity yet.</p>
			</div>
		);
	}

	return (
		<div className="px-4 py-3">
			<div className="relative">
				{/* vertical timeline line */}
				<div className="absolute left-[15px] top-3 bottom-3 w-px bg-border/40" />

				<div className="space-y-4">
					{sorted.map((entry) => (
						<div key={entry.id} className="flex items-start gap-3 relative">
							{/* Timeline dot */}
							<div
								className={cn(
									"w-[10px] h-[10px] rounded-full shrink-0 mt-1 border-2 border-background z-10",
									dotColorForEvent(entry.event),
								)}
							/>

							{/* Content */}
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									{/* Actor avatar */}
									<div className="w-[20px] h-[20px] rounded-full bg-setra-600/70 flex items-center justify-center shrink-0">
										<span className="text-[8px] font-mono font-medium text-[#2b2418]">
											{initials(entry.actor)}
										</span>
									</div>
									<span className="text-xs font-medium text-foreground">
										{entry.actor}
									</span>
									<span className="text-xs text-muted-foreground/60">
										{formatEventDescription(entry.event, entry.payload)}
									</span>
									<span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">
										{formatRelativeTime(entry.created_at)}
									</span>
								</div>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
