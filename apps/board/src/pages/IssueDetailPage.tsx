import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	GitPullRequest,
	Link2,
	PanelRight,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { IssueActivityFeed } from "../components/IssueActivityFeed";
import { IssueChatThread } from "../components/IssueChatThread";
import { IssuePropertiesPanel } from "../components/IssuePropertiesPanel";
import { PriorityIcon, StatusIcon } from "../components/KanbanBoard";
import { Badge, Button, Input, Modal, Select } from "../components/ui";
import {
	type Issue,
	type IssuePriority,
	type IssueStatus,
	type LifecycleStage,
	type Plan,
	type Project,
	api,
} from "../lib/api";
import { cn } from "../lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Tab = "chat" | "activity" | "related";

const STATUS_LABELS: Record<IssueStatus, string> = {
	backlog: "Backlog",
	todo: "Todo",
	in_progress: "In Progress",
	in_review: "In Review",
	blocked: "Blocked",
	done: "Done",
	cancelled: "Cancelled",
};

// ─── Inline editable title ────────────────────────────────────────────────────

function EditableTitle({
	value,
	onSave,
}: {
	value: string;
	onSave: (next: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);

	function commit() {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== value) onSave(trimmed);
		setEditing(false);
	}

	if (editing) {
		return (
			<input
				autoFocus
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") {
						setDraft(value);
						setEditing(false);
					}
				}}
				className="w-full bg-transparent text-xl font-semibold text-foreground outline-none border-b border-setra-500/50"
			/>
		);
	}

	return (
		<h1 className="leading-tight">
			<button
				type="button"
				onClick={() => {
					setDraft(value);
					setEditing(true);
				}}
				className="text-left text-xl font-semibold text-foreground hover:text-setra-200 transition-colors"
				aria-label="Edit issue title"
			>
				{value}
			</button>
		</h1>
	);
}

// ─── Status dropdown inline ────────────────────────────────────────────────────

function StatusDropdown({
	status,
	onChange,
}: {
	status: IssueStatus;
	onChange: (s: IssueStatus) => void;
}) {
	const [open, setOpen] = useState(false);
	const ALL: IssueStatus[] = [
		"backlog",
		"todo",
		"in_progress",
		"in_review",
		"blocked",
		"done",
		"cancelled",
	];

	return (
		<div className="relative">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={() => setOpen((v) => !v)}
				onKeyDown={(event) => {
					if (event.key === "Escape") setOpen(false);
				}}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`Issue status: ${STATUS_LABELS[status]}`}
				className="h-auto px-1 py-0.5"
			>
				<Badge variant={statusBadgeVariant(status)} className="gap-1.5">
					<StatusIcon status={status} />
					<span>{STATUS_LABELS[status]}</span>
				</Badge>
			</Button>
			{open && (
				<div
					role="menu"
					aria-label="Change issue status"
					className="absolute top-full left-0 mt-1 z-50 min-w-[180px] rounded-lg border border-border/50 bg-card shadow-xl py-1"
				>
					{ALL.map((s) => (
						<button
							key={s}
							type="button"
							role="menuitemradio"
							aria-checked={status === s}
							onClick={() => {
								onChange(s);
								setOpen(false);
							}}
							className={cn(
								"flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors",
								status === s && "text-setra-300",
							)}
						>
							<StatusIcon status={s} />
							{STATUS_LABELS[s]}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ─── Lifecycle stepper ────────────────────────────────────────────────────────

const LIFECYCLE_STEPS: { key: LifecycleStage; label: string }[] = [
	{ key: "backlog", label: "Backlog" },
	{ key: "branched", label: "Branched" },
	{ key: "committed", label: "Committed" },
	{ key: "pr_open", label: "PR Open" },
	{ key: "in_review", label: "In Review" },
	{ key: "merged", label: "Merged" },
	{ key: "deployed", label: "Deployed" },
	{ key: "verified", label: "Verified" },
];

function actorLabel(actorType: string | null | undefined): string {
	if (actorType === "human") return "Human";
	if (actorType === "agent") return "Agent";
	return "System";
}

function statusBadgeVariant(
	status: IssueStatus,
): "default" | "success" | "warning" | "danger" | "info" {
	switch (status) {
		case "done":
			return "success";
		case "in_progress":
			return "info";
		case "in_review":
		case "blocked":
			return "warning";
		case "cancelled":
			return "danger";
		default:
			return "default";
	}
}

function priorityBadgeVariant(
	priority: IssuePriority,
): "default" | "success" | "warning" | "danger" | "info" {
	switch (priority) {
		case "urgent":
			return "danger";
		case "high":
			return "warning";
		case "medium":
			return "info";
		case "low":
			return "success";
		default:
			return "default";
	}
}

function prStateBadgeVariant(
	state: "open" | "merged" | "closed" | null | undefined,
): "default" | "success" | "warning" | "danger" | "info" {
	switch (state) {
		case "merged":
			return "success";
		case "closed":
			return "danger";
		case "open":
			return "info";
		default:
			return "default";
	}
}

function priorityLabel(priority: IssuePriority): string {
	if (priority === "none") return "No priority";
	return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function SubIssuesSection({
	issue,
	parentIssue,
	subIssues,
}: {
	issue: Issue;
	parentIssue?: Issue | undefined;
	subIssues: Issue[];
}) {
	const total = subIssues.length;
	const completed = subIssues.filter(
		(subIssue) => subIssue.status === "done",
	).length;
	const show = total > 0 || !!issue.parentIssueId;
	if (!show) return null;

	const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

	return (
		<div className="mt-4 rounded-xl border border-border/40 bg-card/60 p-4 space-y-3">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
					Sub-issues
				</h3>
				{total > 0 && (
					<span className="text-xs text-muted-foreground/60">
						{completed} of {total} done
					</span>
				)}
			</div>

			{issue.parentIssueId && (
				<div className="text-sm text-muted-foreground/70">
					Parent:{" "}
					<Link
						to={`/issues/${issue.parentIssueId}`}
						className="text-setra-300 hover:text-setra-200 transition-colors"
					>
						{parentIssue?.title ?? issue.parentIssueId}
					</Link>
				</div>
			)}

			{total > 0 && (
				<>
					<div className="h-2 w-full rounded-full bg-muted/30 overflow-hidden">
						<div
							className="h-full bg-setra-500 transition-all"
							style={{ width: `${progress}%` }}
						/>
					</div>
					<div className="space-y-2">
						{subIssues.map((subIssue) => (
							<Link
								key={subIssue.id}
								to={`/issues/${subIssue.id}`}
								className="flex items-center justify-between gap-3 rounded-lg border border-border/30 px-3 py-2 hover:bg-muted/30 transition-colors"
							>
								<div className="min-w-0 flex items-center gap-2">
									<StatusIcon status={subIssue.status} />
									<div className="min-w-0">
										<p className="truncate text-sm text-foreground">
											{subIssue.title}
										</p>
										<p className="text-xs text-muted-foreground/60 font-mono">
											{subIssue.identifier ?? subIssue.slug}
										</p>
									</div>
								</div>
								<Badge
									variant={statusBadgeVariant(subIssue.status)}
									className="text-[11px]"
								>
									{STATUS_LABELS[subIssue.status]}
								</Badge>
							</Link>
						))}
					</div>
				</>
			)}
		</div>
	);
}

function LifecycleStepper({ issue }: { issue: Issue }) {
	const current = (issue.lifecycleStage ?? "backlog") as LifecycleStage;
	const events = issue.lifecycle ?? [];

	// Map each stage to the most recent event that landed on it (for timestamp
	// + actor display).
	const lastEventByStage = new Map<LifecycleStage, (typeof events)[number]>();
	for (const ev of events) {
		if (!lastEventByStage.has(ev.toStage)) {
			lastEventByStage.set(ev.toStage, ev);
		}
	}

	const cancelled = current === "cancelled";
	const currentIdx = LIFECYCLE_STEPS.findIndex((s) => s.key === current);
	const completedCount = currentIdx >= 0 ? currentIdx : 0;
	const progressPct = Math.round(
		(completedCount / (LIFECYCLE_STEPS.length - 1)) * 100,
	);

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
					Delivery Lifecycle
				</h3>
				{!cancelled && (
					<span className="text-xs text-muted-foreground/60 tabular-nums">
						{progressPct}%
					</span>
				)}
				{cancelled && (
					<span className="text-xs text-accent-red">Cancelled</span>
				)}
			</div>

			{!cancelled && (
				<div className="h-1 w-full rounded-full bg-muted/30 overflow-hidden">
					<div
						className="h-full bg-setra-500 transition-all"
						style={{ width: `${progressPct}%` }}
					/>
				</div>
			)}

			<ol className="space-y-1.5 mt-2">
				{LIFECYCLE_STEPS.map((step, i) => {
					const isPast = !cancelled && i < currentIdx;
					const isCurrent = !cancelled && i === currentIdx;
					const ev = lastEventByStage.get(step.key);

					return (
						<li
							key={step.key}
							className={cn(
								"flex items-center gap-2.5 text-xs rounded-md px-2 py-1",
								isCurrent && "bg-setra-600/10",
							)}
						>
							<div
								className={cn(
									"w-4 h-4 rounded-full border flex items-center justify-center shrink-0",
									isPast &&
										"bg-accent-green/20 border-accent-green/50 text-accent-green",
									isCurrent &&
										"bg-setra-500/20 border-setra-500 text-setra-300",
									!isPast &&
										!isCurrent &&
										"border-border/40 text-muted-foreground/40",
								)}
							>
								{isPast ? (
									<Check className="w-2.5 h-2.5" />
								) : (
									<span className="text-[8px]">{i + 1}</span>
								)}
							</div>
							<span
								className={cn(
									"flex-1",
									isCurrent
										? "text-foreground font-medium"
										: isPast
											? "text-muted-foreground"
											: "text-muted-foreground/40",
								)}
							>
								{step.label}
							</span>
							{ev && (
								<span className="text-[10px] text-muted-foreground/60 font-mono">
									{actorLabel(ev.actorType)} ·{" "}
									{new Date(ev.occurredAt).toLocaleString()}
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</div>
	);
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
	active,
	onChange,
}: { active: Tab; onChange: (t: Tab) => void }) {
	const tabs: { id: Tab; label: string }[] = [
		{ id: "chat", label: "Chat" },
		{ id: "activity", label: "Activity" },
		{ id: "related", label: "Related Work" },
	];

	return (
		<div
			className="flex border-b border-border/50"
			role="tablist"
			aria-label="Issue detail tabs"
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					id={`issue-detail-tab-${tab.id}`}
					aria-selected={active === tab.id}
					aria-controls={`issue-detail-panel-${tab.id}`}
					onClick={() => onChange(tab.id)}
					className={cn(
						"px-4 py-2.5 text-sm font-medium transition-colors",
						active === tab.id
							? "text-foreground border-b-2 border-setra-400 -mb-px"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

// ─── Related Work Tab ─────────────────────────────────────────────────────────

function RelatedWorkTab({
	issue,
	project,
}: { issue: Issue; project: Project | undefined }) {
	const qc = useQueryClient();
	const [actionError, setActionError] = useState<string | null>(null);
	const [dialog, setDialog] = useState<
		| { type: "commit"; message: string }
		| { type: "pr"; title: string }
		| { type: "linkCommit"; commitSha: string }
		| { type: "linkPr"; prUrl: string; prState: "open" | "merged" | "closed" }
		| null
	>(null);
	const blocked = issue.blockedByIssueIds ?? [];
	const workspacePath = project?.workspacePath?.trim() ?? "";
	const hasWorkspace = workspacePath.length > 0;
	const commits: string[] = (() => {
		if (!issue.commitShas) return [];
		try {
			const parsed = JSON.parse(issue.commitShas);
			return Array.isArray(parsed)
				? parsed.filter((v): v is string => typeof v === "string")
				: [];
		} catch {
			return issue.commitShas
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		}
	})();

	const refreshIssue = () => {
		setActionError(null);
		qc.invalidateQueries({ queryKey: ["issue", issue.id] });
		qc.invalidateQueries({ queryKey: ["issue-activity", issue.id] });
	};
	const refreshIssueAndCloseDialog = () => {
		setDialog(null);
		refreshIssue();
	};
	const openDialog = (
		next:
			| { type: "commit"; message: string }
			| { type: "pr"; title: string }
			| { type: "linkCommit"; commitSha: string }
			| {
					type: "linkPr";
					prUrl: string;
					prState: "open" | "merged" | "closed";
			  },
	) => {
		setActionError(null);
		setDialog(next);
	};

	const branchMut = useMutation({
		mutationFn: () => api.issues.branch(issue.id),
		onSuccess: refreshIssue,
		onError: (err) =>
			setActionError(
				err instanceof Error ? err.message : "Failed to create branch",
			),
	});
	const commitMut = useMutation({
		mutationFn: (message: string) => api.issues.commit(issue.id, { message }),
		onSuccess: refreshIssueAndCloseDialog,
		onError: (err) =>
			setActionError(
				err instanceof Error ? err.message : "Failed to add commit",
			),
	});
	const prMut = useMutation({
		mutationFn: (title: string) =>
			api.issues.openPr(issue.id, {
				title,
				body: `Linked from issue ${issue.identifier ?? issue.slug}`,
			}),
		onSuccess: refreshIssueAndCloseDialog,
		onError: (err) =>
			setActionError(err instanceof Error ? err.message : "Failed to open PR"),
	});
	const linkMut = useMutation({
		mutationFn: (body: {
			commitSha?: string;
			prUrl?: string;
			prState?: "open" | "merged" | "closed";
		}) => api.issues.link(issue.id, body),
		onSuccess: refreshIssueAndCloseDialog,
		onError: (err) =>
			setActionError(
				err instanceof Error ? err.message : "Failed to link git refs",
			),
	});

	const dialogTitle =
		dialog?.type === "commit"
			? "Add commit"
			: dialog?.type === "pr"
				? "Open PR"
				: dialog?.type === "linkCommit"
					? "Link commit"
					: dialog?.type === "linkPr"
						? "Link PR"
						: "";
	const dialogSubmitLabel =
		dialog?.type === "commit"
			? "Add commit"
			: dialog?.type === "pr"
				? "Open PR"
				: dialog?.type === "linkCommit"
					? "Link commit"
					: "Link PR";
	const dialogBusy =
		dialog?.type === "commit"
			? commitMut.isPending
			: dialog?.type === "pr"
				? prMut.isPending
				: dialog?.type === "linkCommit" || dialog?.type === "linkPr"
					? linkMut.isPending
					: false;
	const dialogSubmitDisabled =
		!dialog ||
		(dialog.type === "commit" && !dialog.message.trim()) ||
		(dialog.type === "pr" && !dialog.title.trim()) ||
		(dialog.type === "linkCommit" && !dialog.commitSha.trim()) ||
		(dialog.type === "linkPr" && !dialog.prUrl.trim());

	const handleDialogSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!dialog) return;
		if (dialog.type === "commit") {
			commitMut.mutate(dialog.message.trim());
			return;
		}
		if (dialog.type === "pr") {
			prMut.mutate(dialog.title.trim());
			return;
		}
		if (dialog.type === "linkCommit") {
			linkMut.mutate({ commitSha: dialog.commitSha.trim() });
			return;
		}
		linkMut.mutate({
			prUrl: dialog.prUrl.trim(),
			prState: dialog.prState,
		});
	};

	return (
		<>
			<div className="flex flex-col gap-6 px-4 py-4">
				<section>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
						Blocked By
					</h3>
					{blocked.length === 0 ? (
						<p className="text-xs text-muted-foreground/40">None</p>
					) : (
						<div className="space-y-1">
							{blocked.map((id) => (
								<div
									key={id}
									className="flex items-center gap-2 rounded-md border border-border/30 bg-muted/20 p-2"
								>
									<Link2 className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
									<span className="text-xs font-mono text-muted-foreground">
										{id}
									</span>
								</div>
							))}
						</div>
					)}
					<p className="mt-2 text-xs text-muted-foreground/40">
						Use Git + PR actions below to attach branch, commit, and PR links.
					</p>
				</section>

				<section>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
						Related Issues
					</h3>
					<p className="text-xs text-muted-foreground/40">No related issues.</p>
				</section>

				<section>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
						Pull Requests
					</h3>
					{issue.prUrl ? (
						<div className="flex flex-wrap items-center gap-2">
							<a
								href={issue.prUrl}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-2 text-xs text-setra-300 hover:text-setra-200 transition-colors"
							>
								<GitPullRequest className="w-3.5 h-3.5" aria-hidden="true" />
								{issue.prUrl}
							</a>
							{issue.prState && (
								<Badge variant={prStateBadgeVariant(issue.prState)}>
									{issue.prState}
								</Badge>
							)}
						</div>
					) : (
						<div className="flex items-center gap-2 text-xs text-muted-foreground/40">
							<GitPullRequest className="w-3.5 h-3.5" aria-hidden="true" />
							No linked PRs
						</div>
					)}
					{commits.length > 0 && (
						<div className="mt-2 space-y-1" role="status" aria-live="polite">
							{commits.map((sha) => (
								<div
									key={sha}
									className="text-xs font-mono text-muted-foreground/70"
								>
									{sha}
								</div>
							))}
						</div>
					)}
					{!hasWorkspace && (
						<p
							className="mt-2 text-xs text-amber-300/90"
							role="status"
							aria-live="polite"
						>
							Set this project’s workspace path in Projects before creating
							branches or commits.
						</p>
					)}
					{actionError && (
						<p
							className="mt-2 break-words text-xs text-accent-red"
							role="alert"
						>
							{actionError}
						</p>
					)}
					<div className="mt-3 flex flex-wrap gap-2">
						<Button
							type="button"
							variant={issue.branchName ? "secondary" : "ghost"}
							size="sm"
							onClick={() => branchMut.mutate()}
							loading={branchMut.isPending}
							disabled={!hasWorkspace || Boolean(issue.branchName)}
						>
							{issue.branchName ? "Branch created" : "Create branch"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() =>
								openDialog({
									type: "commit",
									message: `feat: update ${issue.identifier ?? issue.slug}`,
								})
							}
							disabled={!hasWorkspace || !issue.branchName}
						>
							Add commit
						</Button>
						<Button
							type="button"
							variant={issue.prUrl ? "secondary" : "ghost"}
							size="sm"
							onClick={() => openDialog({ type: "pr", title: issue.title })}
							disabled={
								!hasWorkspace || !issue.branchName || Boolean(issue.prUrl)
							}
						>
							{issue.prUrl ? "PR linked" : "Open PR"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => openDialog({ type: "linkCommit", commitSha: "" })}
							disabled={linkMut.isPending}
						>
							Link commit
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() =>
								openDialog({
									type: "linkPr",
									prUrl: issue.prUrl ?? "",
									prState: issue.prState ?? "open",
								})
							}
							disabled={linkMut.isPending}
						>
							Link PR URL
						</Button>
					</div>
				</section>
			</div>

			<Modal
				open={dialog !== null}
				onClose={() => setDialog(null)}
				title={dialogTitle}
				actions={
					<>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setDialog(null)}
							disabled={dialogBusy}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							form="issue-detail-git-ref-form"
							loading={dialogBusy}
							disabled={dialogSubmitDisabled}
						>
							{dialogSubmitLabel}
						</Button>
					</>
				}
			>
				{dialog && (
					<form
						id="issue-detail-git-ref-form"
						onSubmit={handleDialogSubmit}
						className="space-y-4"
					>
						{dialog.type === "commit" && (
							<Input
								autoFocus
								label="Commit message"
								value={dialog.message}
								onChange={(event) =>
									setDialog({ type: "commit", message: event.target.value })
								}
								placeholder="feat: update issue"
								disabled={dialogBusy}
							/>
						)}
						{dialog.type === "pr" && (
							<Input
								autoFocus
								label="PR title"
								value={dialog.title}
								onChange={(event) =>
									setDialog({ type: "pr", title: event.target.value })
								}
								placeholder="Pull request title"
								disabled={dialogBusy}
							/>
						)}
						{dialog.type === "linkCommit" && (
							<Input
								autoFocus
								label="Commit SHA"
								value={dialog.commitSha}
								onChange={(event) =>
									setDialog({
										type: "linkCommit",
										commitSha: event.target.value,
									})
								}
								placeholder="abcdef123456"
								disabled={dialogBusy}
							/>
						)}
						{dialog.type === "linkPr" && (
							<>
								<Input
									autoFocus
									label="PR URL"
									value={dialog.prUrl}
									onChange={(event) =>
										setDialog({
											type: "linkPr",
											prUrl: event.target.value,
											prState: dialog.prState,
										})
									}
									placeholder="https://github.com/.../pull/..."
									disabled={dialogBusy}
								/>
								<Select
									label="PR state"
									value={dialog.prState}
									onChange={(event) =>
										setDialog({
											type: "linkPr",
											prUrl: dialog.prUrl,
											prState: event.target.value as
												| "open"
												| "merged"
												| "closed",
										})
									}
									disabled={dialogBusy}
								>
									<option value="open">Open</option>
									<option value="merged">Merged</option>
									<option value="closed">Closed</option>
								</Select>
							</>
						)}
					</form>
				)}
			</Modal>
		</>
	);
}

function PendingPlanSection({
	plan,
	onApprove,
	onReject,
	isLoading,
}: {
	plan?: Plan | undefined;
	onApprove: () => void;
	onReject: () => void;
	isLoading: boolean;
}) {
	if (!plan) return null;
	const completed = plan.subtasks.filter(
		(subtask) => subtask.status === "done",
	).length;
	return (
		<div className="mt-4 rounded-xl border border-setra-500/25 bg-setra-500/5 p-4 space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-xs font-semibold uppercase tracking-wider text-setra-300">
						Execution plan
					</h3>
					<p className="mt-1 text-sm font-semibold text-foreground">
						{plan.title}
					</p>
					<p className="mt-1 text-sm text-muted-foreground/75">
						{plan.approach}
					</p>
				</div>
				<Badge
					variant={plan.status === "pending_approval" ? "warning" : "info"}
				>
					{plan.status.replace("_", " ")}
				</Badge>
			</div>
			<div className="space-y-2">
				<div className="flex items-center justify-between text-xs text-muted-foreground/70">
					<span>
						{completed} of {plan.subtasks.length} subtasks complete
					</span>
					<span>{plan.createdBy}</span>
				</div>
				<div className="h-2 w-full overflow-hidden rounded-full bg-muted/30">
					<div
						className="h-full bg-setra-500 transition-all"
						style={{
							width: `${plan.subtasks.length > 0 ? (completed / plan.subtasks.length) * 100 : 0}%`,
						}}
					/>
				</div>
				<div className="space-y-2">
					{plan.subtasks.map((subtask) => (
						<div
							key={subtask.id}
							className="rounded-lg border border-border/30 bg-card/50 px-3 py-2"
						>
							<div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
								<span className="font-medium">{subtask.title}</span>
								<span className="text-xs text-muted-foreground/60">
									{subtask.assignTo} · {subtask.status.replace("_", " ")}
								</span>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{subtask.description}
							</p>
						</div>
					))}
				</div>
			</div>
			{plan.status === "pending_approval" && (
				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onReject}
						disabled={isLoading}
					>
						Reject
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={onApprove}
						disabled={isLoading}
					>
						Approve plan
					</Button>
				</div>
			)}
		</div>
	);
}

// ─── IssueDetailPage ──────────────────────────────────────────────────────────

export function IssueDetailPage() {
	const { issueId } = useParams<{ issueId: string }>();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [activeTab, setActiveTab] = useState<Tab>("chat");
	const [propertiesOpen, setPropertiesOpen] = useState(true);
	const [descExpanded, setDescExpanded] = useState(false);
	const [chatHeight, setChatHeight] = useState<number | null>(null);

	const { data: issue, isLoading: issueLoading } = useQuery({
		queryKey: ["issue", issueId],
		queryFn: () => api.issues.get(issueId!),
		enabled: !!issueId,
	});

	const { data: comments = [] } = useQuery({
		queryKey: ["issue-comments", issueId],
		queryFn: () => api.issues.comments.list(issueId!),
		enabled: !!issueId,
	});

	const { data: subIssues = [] } = useQuery({
		queryKey: ["issue-sub-issues", issueId],
		queryFn: () => api.issues.subIssues(issueId!),
		enabled: !!issueId,
	});

	const { data: activity = [] } = useQuery({
		queryKey: ["issue-activity", issueId],
		queryFn: () => api.issues.activity(issueId!),
		enabled: !!issueId,
	});
	const { data: plans = [] } = useQuery({
		queryKey: ["plans", issueId],
		queryFn: () => api.plans.list({ issueId: issueId! }),
		enabled: !!issueId,
	});

	const { data: agents = [] } = useQuery({
		queryKey: ["agents"],
		queryFn: () => api.agents.list(),
	});

	const { data: projects = [] } = useQuery({
		queryKey: ["projects"],
		queryFn: () => api.projects.list(),
	});

	const { data: parentIssue } = useQuery({
		queryKey: ["issue", issue?.parentIssueId],
		queryFn: () => api.issues.get(issue!.parentIssueId!),
		enabled: !!issue?.parentIssueId,
	});

	const updateIssue = useMutation({
		mutationFn: (data: Partial<Issue>) =>
			api.issueDetail.update(issueId!, data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["issue", issueId] });
			qc.invalidateQueries({ queryKey: ["issue-sub-issues", issueId] });
			qc.invalidateQueries({ queryKey: ["issues"] });
			if (issue?.parentIssueId) {
				qc.invalidateQueries({ queryKey: ["issue", issue.parentIssueId] });
			}
		},
	});
	const runTests = useMutation({
		mutationFn: () => api.issues.runTests(issueId!),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["issue", issueId] });
			qc.invalidateQueries({ queryKey: ["issues"] });
		},
	});

	const createComment = useMutation({
		mutationFn: (body: string) =>
			api.issues.comments.create(issueId!, { body }),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: ["issue-comments", issueId] }),
	});
	const approvePlan = useMutation({
		mutationFn: (planId: string) => api.plans.approve(planId),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["plans", issueId] });
			qc.invalidateQueries({ queryKey: ["issue", issueId] });
			qc.invalidateQueries({ queryKey: ["issue-sub-issues", issueId] });
		},
	});
	const rejectPlan = useMutation({
		mutationFn: ({ planId, feedback }: { planId: string; feedback?: string }) =>
			api.plans.reject(planId, feedback),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["plans", issueId] });
			qc.invalidateQueries({ queryKey: ["issue", issueId] });
		},
	});

	const deleteComment = useMutation({
		mutationFn: (commentId: string) =>
			api.issues.comments.delete(issueId!, commentId),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: ["issue-comments", issueId] }),
	});

	const adjustChatHeight = (delta: number) => {
		setChatHeight((current) => {
			const baseHeight = current ?? Math.max(300, window.innerHeight - 420);
			return Math.max(
				200,
				Math.min(baseHeight + delta, window.innerHeight - 300),
			);
		});
	};

	const activePlan = plans[0];

	if (issueLoading || !issue) {
		return (
			<div
				className="flex h-full items-center justify-center"
				role="status"
				aria-live="polite"
			>
				<div
					className="h-4 w-4 animate-spin rounded-full border-2 border-setra-400 border-t-transparent"
					aria-hidden="true"
				/>
				<span className="sr-only">Loading issue details</span>
			</div>
		);
	}

	return (
		<div className="flex h-full overflow-hidden relative">
			<div className="flex-1 min-w-0 flex flex-col overflow-hidden">
				{/* Top bar */}
				<div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5 shrink-0">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => navigate(-1)}
						icon={<ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
						className="text-xs text-muted-foreground/60 hover:text-foreground"
					>
						Back to Issues
					</Button>
					<Button
						type="button"
						variant={propertiesOpen ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setPropertiesOpen((v) => !v)}
						icon={<PanelRight className="h-3.5 w-3.5" aria-hidden="true" />}
						aria-pressed={propertiesOpen}
						className={cn(
							"text-xs",
							propertiesOpen &&
								"border-setra-600/30 bg-setra-600/15 text-setra-300",
						)}
					>
						Properties
					</Button>
				</div>

				{/* Issue header */}
				<div className="px-6 pt-5 pb-3 border-b border-border/30 shrink-0">
					<div className="flex items-center gap-3 mb-3">
						<StatusDropdown
							status={issue.status}
							onChange={(s) => updateIssue.mutate({ status: s })}
						/>
						{(issue.identifier ?? issue.slug) && (
							<span className="text-xs font-mono text-muted-foreground/50">
								{issue.identifier ?? issue.slug}
							</span>
						)}
						<div className="ml-auto">
							<Badge
								variant={priorityBadgeVariant(issue.priority)}
								className="gap-1.5"
							>
								<PriorityIcon priority={issue.priority} />
								<span>{priorityLabel(issue.priority)}</span>
							</Badge>
						</div>
					</div>
					<EditableTitle
						value={issue.title}
						onSave={(title) => updateIssue.mutate({ title })}
					/>
					{issue.description && (
						<div className="mt-2 relative">
							<div
								className={cn(
									"text-sm text-muted-foreground/70 leading-relaxed prose prose-invert prose-sm max-w-none",
									!descExpanded && "max-h-[4.5em] overflow-hidden",
								)}
							>
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{issue.description}
								</ReactMarkdown>
							</div>
							{issue.description.length > 200 && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setDescExpanded((v) => !v)}
									className="mt-1 px-0 text-xs text-setra-400 hover:text-setra-300"
									aria-expanded={descExpanded}
								>
									{descExpanded ? "Show less" : "Show more"}
								</Button>
							)}
						</div>
					)}
					<details className="mt-3 group">
						<summary className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 cursor-pointer select-none flex items-center gap-1.5 list-none">
							<ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
							Lifecycle ·{" "}
							{(issue.lifecycleStage ?? "backlog").replace("_", " ")}
						</summary>
						<div className="mt-2">
							<LifecycleStepper issue={issue} />
						</div>
					</details>
					<PendingPlanSection
						plan={activePlan}
						onApprove={() => activePlan && approvePlan.mutate(activePlan.id)}
						onReject={() => {
							if (!activePlan) return;
							const feedback = window.prompt(
								"Optional feedback for the CEO",
								"",
							);
							if (feedback === null) return;
							rejectPlan.mutate({ planId: activePlan.id, feedback });
						}}
						isLoading={approvePlan.isPending || rejectPlan.isPending}
					/>
					<SubIssuesSection
						issue={issue}
						parentIssue={parentIssue}
						subIssues={subIssues}
					/>
				</div>

				{/* Tabs */}
				<div className="px-4 shrink-0">
					<TabBar active={activeTab} onChange={setActiveTab} />
				</div>

				{/* Drag handle to resize chat area */}
				<div
					className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center transition-colors hover:bg-setra-500/30 active:bg-setra-500/50"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize issue detail content"
					tabIndex={0}
					onKeyDown={(event) => {
						if (event.key === "ArrowUp") {
							event.preventDefault();
							adjustChatHeight(24);
						}
						if (event.key === "ArrowDown") {
							event.preventDefault();
							adjustChatHeight(-24);
						}
					}}
					onMouseDown={(e) => {
						e.preventDefault();
						const startY = e.clientY;
						const container = e.currentTarget.parentElement;
						if (!container) return;
						const tabContent = container.querySelector(
							"[data-chat-content]",
						) as HTMLElement | null;
						if (!tabContent) return;
						const startHeight = tabContent.offsetHeight;

						const onMove = (ev: MouseEvent) => {
							const delta = startY - ev.clientY;
							const newHeight = Math.max(
								200,
								Math.min(startHeight + delta, window.innerHeight - 300),
							);
							setChatHeight(newHeight);
						};
						const onUp = () => {
							document.removeEventListener("mousemove", onMove);
							document.removeEventListener("mouseup", onUp);
						};
						document.addEventListener("mousemove", onMove);
						document.addEventListener("mouseup", onUp);
					}}
				>
					<div className="h-0.5 w-8 rounded-full bg-border/50 group-hover:bg-setra-400/50" />
				</div>

				{/* Tab content */}
				<div
					className="min-h-0 overflow-hidden"
					data-chat-content
					style={
						chatHeight
							? { height: `${chatHeight}px`, flex: "none" }
							: { flex: "1" }
					}
				>
					{activeTab === "chat" && (
						<motion.div
							key="chat"
							id="issue-detail-panel-chat"
							role="tabpanel"
							aria-labelledby="issue-detail-tab-chat"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							className="h-full"
						>
							<IssueChatThread
								comments={comments}
								activity={activity}
								onSendComment={async (body) => {
									await createComment.mutateAsync(body);
								}}
								onDeleteComment={(cid) => deleteComment.mutate(cid)}
							/>
						</motion.div>
					)}

					{activeTab === "activity" && (
						<motion.div
							key="activity"
							id="issue-detail-panel-activity"
							role="tabpanel"
							aria-labelledby="issue-detail-tab-activity"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							className="h-full overflow-y-auto"
						>
							<IssueActivityFeed activity={activity} />
						</motion.div>
					)}

					{activeTab === "related" && (
						<motion.div
							key="related"
							id="issue-detail-panel-related"
							role="tabpanel"
							aria-labelledby="issue-detail-tab-related"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							className="h-full overflow-y-auto"
						>
							<RelatedWorkTab
								issue={issue}
								project={projects.find((p) => p.id === issue.projectId)}
							/>
						</motion.div>
					)}
				</div>
			</div>

			{/* Properties panel */}
			<IssuePropertiesPanel
				issue={issue}
				agents={agents}
				projects={projects}
				onUpdate={(data) => updateIssue.mutate(data)}
				onRunTests={() => runTests.mutate()}
				isRunningTests={runTests.isPending}
				onClose={() => setPropertiesOpen(false)}
				isOpen={propertiesOpen}
			/>
		</div>
	);
}
