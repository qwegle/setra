import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
	AlertTriangle,
	Archive,
	ArrowRight,
	Filter,
	Inbox,
	ShieldCheck,
	X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApprovalCard } from "../components/ApprovalCard";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { type Issue, api } from "../lib/api";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/utils";

type Tab = "mine" | "unread" | "all";

const PRIORITY_DOT: Record<Issue["priority"], string> = {
	none: "bg-muted-foreground/40",
	low: "bg-setra-400",
	medium: "bg-accent-yellow",
	high: "bg-accent-orange",
	urgent: "bg-accent-red animate-pulse",
};

const STATUS_DOT: Record<Issue["status"], string> = {
	backlog: "bg-muted-foreground/30",
	todo: "bg-muted-foreground",
	in_progress: "bg-setra-400 animate-pulse",
	in_review: "bg-accent-purple",
	done: "bg-accent-green",
	cancelled: "bg-muted-foreground/20",
	blocked: "bg-accent-red",
};

const STATUS_GROUPS = [
	{ status: "in_progress" as Issue["status"], label: "In Progress" },
	{ status: "in_review" as Issue["status"], label: "In Review" },
	{ status: "todo" as Issue["status"], label: "Todo" },
	{ status: "backlog" as Issue["status"], label: "Backlog" },
	{ status: "done" as Issue["status"], label: "Done" },
];

function SkeletonRow() {
	return (
		<div className="flex items-center gap-3 px-3 py-2.5 animate-pulse">
			<div className="w-2.5 h-2.5 rounded-full bg-muted/30 shrink-0" />
			<div className="h-3 bg-muted/30 rounded w-16" />
			<div className="h-3 bg-muted/30 rounded flex-1" />
			<div className="h-3 bg-muted/30 rounded w-12" />
		</div>
	);
}

function IssueRow({
	issue,
	onArchive,
	archiving,
}: {
	issue: Issue;
	onArchive: (id: string) => void;
	archiving: boolean;
}) {
	return (
		<motion.div
			layout
			initial={{ opacity: 1 }}
			exit={{ opacity: 0, x: 40 }}
			transition={{ duration: 0.2 }}
			className="group flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/30 transition-colors"
		>
			<span
				className={cn(
					"w-2.5 h-2.5 rounded-full shrink-0",
					STATUS_DOT[issue.status],
				)}
			/>
			<span className="text-xs text-muted-foreground/60 font-mono shrink-0">
				{issue.slug}
			</span>
			<span className="flex-1 text-sm text-foreground truncate">
				{issue.title}
			</span>
			<span
				className={cn(
					"w-2 h-2 rounded-full shrink-0",
					PRIORITY_DOT[issue.priority],
				)}
				title={issue.priority}
			/>
			<span className="text-xs text-muted-foreground/50 shrink-0 w-16 text-right">
				{timeAgo(issue.updatedAt)}
			</span>
			<button
				onClick={() => onArchive(issue.id)}
				disabled={archiving}
				className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground/50 hover:text-accent-yellow hover:bg-muted/50 transition-all shrink-0"
				title="Archive"
			>
				<Archive className="w-3.5 h-3.5" />
			</button>
		</motion.div>
	);
}

export function InboxPage() {
	const [tab, setTab] = useState<Tab>("mine");
	const qc = useQueryClient();

	const { data, isLoading, isError } = useQuery({
		queryKey: ["inbox", tab],
		queryFn: () => api.inbox.list(tab),
	});

	const archiveMutation = useMutation({
		mutationFn: (id: string) => api.inbox.archive(id),
		onSuccess: (_data, id) => {
			qc.setQueryData(["inbox", tab], (prev: typeof data) =>
				prev
					? { ...prev, issues: prev.issues.filter((i) => i.id !== id) }
					: prev,
			);
		},
	});

	const approveMutation = useMutation({
		mutationFn: (id: string) => api.approvals.approve(id),
		onSuccess: (_data, id) => {
			qc.setQueryData(["inbox", tab], (prev: typeof data) =>
				prev
					? { ...prev, approvals: prev.approvals.filter((a) => a.id !== id) }
					: prev,
			);
		},
	});

	const rejectMutation = useMutation({
		mutationFn: (id: string) => api.approvals.reject(id),
		onSuccess: (_data, id) => {
			qc.setQueryData(["inbox", tab], (prev: typeof data) =>
				prev
					? { ...prev, approvals: prev.approvals.filter((a) => a.id !== id) }
					: prev,
			);
		},
	});

	const issues = data?.issues ?? [];
	const approvals = data?.approvals ?? [];
	const alerts = data?.alerts ?? [];

	const grouped = STATUS_GROUPS.map((g) => ({
		...g,
		items: issues.filter((i) => i.status === g.status),
	})).filter((g) => g.items.length > 0);

	const unreadCount = tab === "unread" ? issues.length : 0;

	const TABS: { id: Tab; label: string }[] = [
		{ id: "mine", label: "Mine" },
		{
			id: "unread",
			label: unreadCount > 0 ? `Unread ${unreadCount}` : "Unread",
		},
		{ id: "all", label: "All" },
	];

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="px-6 pt-6 pb-0 shrink-0">
				<PageHeader
					title="Inbox"
					subtitle="Triage work items, alerts, and pending approvals."
					actions={
						<Button
							type="button"
							variant="secondary"
							size="sm"
							icon={<Filter className="h-4 w-4" aria-hidden="true" />}
						>
							Filter
						</Button>
					}
				/>

				{/* Tabs */}
				<div className="flex items-center gap-0 border-b border-border/50">
					{TABS.map((t) => (
						<button
							key={t.id}
							onClick={() => setTab(t.id)}
							className={cn(
								"px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
								tab === t.id
									? "border-setra-400 text-setra-300"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							{t.label}
						</button>
					))}
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
				{isLoading && (
					<div className="space-y-1">
						{Array.from({ length: 6 }).map((_, i) => (
							<SkeletonRow key={i} />
						))}
					</div>
				)}

				{isError && (
					<p className="text-sm text-accent-red">Failed to load inbox.</p>
				)}

				{!isLoading && !isError && (
					<>
						{/* Alerts */}
						{alerts.length > 0 && (
							<div className="space-y-2">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Alerts
								</p>
								<AnimatePresence>
									{alerts.map((alert) => (
										<motion.div
											key={alert.id}
											layout
											exit={{ opacity: 0, height: 0 }}
											className={cn(
												"flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm",
												alert.severity === "error"
													? "bg-accent-red/10 border-accent-red/20 text-accent-red"
													: alert.severity === "warn"
														? "bg-accent-yellow/10 border-accent-yellow/20 text-accent-yellow"
														: "bg-muted/30 border-border/50 text-muted-foreground",
											)}
										>
											<AlertTriangle className="w-4 h-4 shrink-0" />
											<span className="flex-1">{alert.message}</span>
											<button className="p-1 rounded hover:bg-muted/50 transition-colors">
												<X className="w-3.5 h-3.5" />
											</button>
										</motion.div>
									))}
								</AnimatePresence>
							</div>
						)}

						{/* Work items */}
						{issues.length > 0 && (
							<div className="space-y-4">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Work Items
								</p>
								{grouped.map((group) => (
									<div key={group.status}>
										<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 px-3 mb-1">
											{group.label} ({group.items.length})
										</p>
										<AnimatePresence>
											{group.items.map((issue) => (
												<IssueRow
													key={issue.id}
													issue={issue}
													onArchive={(id) => archiveMutation.mutate(id)}
													archiving={
														archiveMutation.isPending &&
														archiveMutation.variables === issue.id
													}
												/>
											))}
										</AnimatePresence>
									</div>
								))}
							</div>
						)}

						{/* Approvals (mine tab) */}
						{tab === "mine" && approvals.length > 0 && (
							<div className="space-y-3">
								<div className="flex items-center justify-between">
									<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Approvals Pending
									</p>
									<Link
										to="/approvals"
										className="flex items-center gap-1 text-xs text-setra-400 hover:text-setra-300 transition-colors"
									>
										View all approvals
										<ArrowRight className="w-3 h-3" />
									</Link>
								</div>
								<AnimatePresence>
									{approvals.slice(0, 3).map((approval) => (
										<motion.div
											key={approval.id}
											layout
											exit={{ opacity: 0, height: 0 }}
										>
											<ApprovalCard
												approval={approval}
												onApprove={() => approveMutation.mutate(approval.id)}
												onReject={() => rejectMutation.mutate(approval.id)}
												isLoading={
													(approveMutation.isPending &&
														approveMutation.variables === approval.id) ||
													(rejectMutation.isPending &&
														rejectMutation.variables === approval.id)
												}
											/>
										</motion.div>
									))}
								</AnimatePresence>
							</div>
						)}

						{/* Empty state */}
						{issues.length === 0 &&
							approvals.length === 0 &&
							alerts.length === 0 && (
								<div className="flex flex-col items-center justify-center py-20 gap-3">
									<Inbox className="w-12 h-12 text-muted-foreground/30" />
									<p className="text-sm text-muted-foreground">Nothing here</p>
								</div>
							)}
					</>
				)}
			</div>
		</div>
	);
}
