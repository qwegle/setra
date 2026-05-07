import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	ChevronDown,
	Clock,
	Loader2,
	MessageSquare,
	Pencil,
	Tag,
	Trash2,
	User,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	type ActivityEntry,
	type Issue,
	type IssueComment,
	type IssuePriority,
	type IssueStatus,
	api,
} from "../lib/api";
import { cn } from "../lib/utils";

interface Props {
	issueId: string | null;
	projectId: string;
	onClose: () => void;
}

const STATUS_OPTIONS: { value: IssueStatus; label: string; color: string }[] = [
	{ value: "backlog", label: "Backlog", color: "text-muted-foreground" },
	{ value: "todo", label: "Todo", color: "text-foreground" },
	{ value: "in_progress", label: "In Progress", color: "text-setra-400" },
	{ value: "in_review", label: "In Review", color: "text-accent-purple" },
	{ value: "done", label: "Done", color: "text-accent-green" },
	{ value: "cancelled", label: "Cancelled", color: "text-muted-foreground/60" },
];

const PRIORITY_OPTIONS: {
	value: IssuePriority;
	label: string;
	dotClass: string;
}[] = [
	{ value: "none", label: "None", dotClass: "bg-muted-foreground/40" },
	{ value: "low", label: "Low", dotClass: "bg-setra-400" },
	{ value: "medium", label: "Medium", dotClass: "bg-accent-yellow" },
	{ value: "high", label: "High", dotClass: "bg-accent-orange" },
	{ value: "urgent", label: "Urgent", dotClass: "bg-accent-red animate-pulse" },
];

function formatRelativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

function authorInitial(author: string): string {
	return author.charAt(0).toUpperCase();
}

function SelectDropdown<
	T extends string,
	O extends { value: T; label: string } = { value: T; label: string },
>({
	value,
	options,
	onChange,
	renderOption,
	renderSelected,
}: {
	value: T;
	options: O[];
	onChange: (v: T) => void;
	renderOption?: (opt: O) => React.ReactNode;
	renderSelected?: (opt: O | undefined) => React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const current = options.find((o) => o.value === value);

	useEffect(() => {
		function handler(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		}
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((p) => !p)}
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/50 bg-muted/30 hover:bg-muted/50 text-xs transition-colors"
			>
				{renderSelected ? (
					renderSelected(current)
				) : (
					<span>{current?.label ?? value}</span>
				)}
				<ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
			</button>
			{open && (
				<div className="absolute top-full left-0 mt-1 z-50 glass rounded-lg border border-border/60 shadow-xl min-w-[140px] py-1">
					{options.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => {
								onChange(opt.value);
								setOpen(false);
							}}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 text-left transition-colors"
						>
							{renderOption ? renderOption(opt) : opt.label}
							{opt.value === value && (
								<Check className="w-3 h-3 ml-auto text-setra-400" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export function IssueDetailPanel({ issueId, projectId, onClose }: Props) {
	const qc = useQueryClient();
	const open = issueId !== null;

	// Fetch issue data
	const { data: issue, isLoading } = useQuery({
		queryKey: ["issue", issueId],
		queryFn: () => api.issues.get(issueId!),
		enabled: !!issueId,
	});

	// Fetch agents for assignment dropdown
	const { data: agents = [] } = useQuery({
		queryKey: ["agents"],
		queryFn: () => api.agents.list(),
	});

	// Fetch comments
	const { data: comments = [] } = useQuery<IssueComment[]>({
		queryKey: ["comments", issueId],
		queryFn: () => api.issues.comments.list(issueId!),
		enabled: !!issueId,
	});

	// Fetch activity
	const { data: activity = [] } = useQuery<ActivityEntry[]>({
		queryKey: ["activity", issueId],
		queryFn: () => api.issues.activity(issueId!),
		enabled: !!issueId,
	});

	// Local editable state
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
	const [testCommand, setTestCommand] = useState("");
	const [descriptionEditing, setDescriptionEditing] = useState(false);
	const [labelInput, setLabelInput] = useState("");
	const [labels, setLabels] = useState<string[]>([]);
	const [commentBody, setCommentBody] = useState("");

	// Sync issue data into local state when loaded
	useEffect(() => {
		if (issue) {
			setTitle(issue.title);
			setDescription(issue.description ?? "");
			setAcceptanceCriteria(issue.acceptanceCriteria ?? "");
			setTestCommand(issue.testCommand ?? "");
			try {
				setLabels(JSON.parse(issue.labels || "[]") as string[]);
			} catch {
				setLabels([]);
			}
		}
	}, [issue]);

	// Mutations
	const updateIssue = useMutation({
		mutationFn: (body: Partial<Issue>) => api.issues.update(issueId!, body),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["issues", projectId] });
			void qc.invalidateQueries({ queryKey: ["issue", issueId] });
			void qc.invalidateQueries({ queryKey: ["activity", issueId] });
		},
	});

	const deleteIssue = useMutation({
		mutationFn: () => api.issues.delete(issueId!),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["issues", projectId] });
			onClose();
		},
	});

	const addComment = useMutation({
		mutationFn: (body: string) =>
			api.issues.comments.create(issueId!, { body }),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["comments", issueId] });
			void qc.invalidateQueries({ queryKey: ["activity", issueId] });
			setCommentBody("");
		},
	});

	const deleteComment = useMutation({
		mutationFn: (commentId: string) =>
			api.issues.comments.delete(issueId!, commentId),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["comments", issueId] }),
	});

	const runTests = useMutation({
		mutationFn: () => api.issues.runTests(issueId!),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["issues", projectId] });
			void qc.invalidateQueries({ queryKey: ["issue", issueId] });
		},
	});

	// Debounced patches for title / description
	const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const acceptanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const testCommandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	function patchTitle(v: string) {
		if (titleTimer.current) clearTimeout(titleTimer.current);
		titleTimer.current = setTimeout(
			() => updateIssue.mutate({ title: v }),
			600,
		);
	}

	function patchDescription(v: string) {
		if (descTimer.current) clearTimeout(descTimer.current);
		descTimer.current = setTimeout(
			() => updateIssue.mutate({ description: v }),
			600,
		);
	}

	function patchAcceptanceCriteria(v: string) {
		if (acceptanceTimer.current) clearTimeout(acceptanceTimer.current);
		acceptanceTimer.current = setTimeout(
			() => updateIssue.mutate({ acceptanceCriteria: v }),
			600,
		);
	}

	function patchTestCommand(v: string) {
		if (testCommandTimer.current) clearTimeout(testCommandTimer.current);
		testCommandTimer.current = setTimeout(
			() =>
				updateIssue.mutate({
					testCommand: v,
					testStatus: v.trim() ? "pending" : "none",
				}),
			600,
		);
	}

	// Label management
	function addLabel(raw: string) {
		const label = raw.trim().replace(/,+$/, "").trim();
		if (!label || labels.includes(label)) return;
		const next = [...labels, label];
		setLabels(next);
		updateIssue.mutate({ labels: JSON.stringify(next) });
	}

	function removeLabel(label: string) {
		const next = labels.filter((l) => l !== label);
		setLabels(next);
		updateIssue.mutate({ labels: JSON.stringify(next) });
	}

	function handleLabelKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			addLabel(labelInput);
			setLabelInput("");
		}
	}

	// Keyboard close
	useEffect(() => {
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape" && open) onClose();
		}
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [open, onClose]);

	return (
		<>
			{/* Backdrop */}
			<div
				className={cn(
					"fixed inset-0 z-30 bg-ground-950/60 backdrop-blur-sm transition-opacity duration-200",
					open
						? "opacity-100 pointer-events-auto"
						: "opacity-0 pointer-events-none",
				)}
				onClick={onClose}
			/>

			{/* Panel */}
			<div
				className={cn(
					"fixed inset-y-0 right-0 w-[480px] flex flex-col z-40 glass border-l border-border/50",
					"transition-transform duration-200 ease-out",
					open ? "translate-x-0" : "translate-x-full",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				{!open || isLoading || !issue ? (
					<div className="flex-1 flex items-center justify-center">
						{isLoading && (
							<div className="w-5 h-5 border-2 border-setra-500 border-t-transparent rounded-full animate-spin" />
						)}
					</div>
				) : (
					<>
						{/* Header */}
						<div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 shrink-0">
							<button
								type="button"
								onClick={onClose}
								className="text-muted-foreground/50 hover:text-foreground transition-colors"
								aria-label="Close panel"
							>
								<X className="w-4 h-4" />
							</button>
							<span className="text-xs font-mono text-muted-foreground/70 flex-1">
								{issue.slug}
							</span>
							<button
								type="button"
								onClick={() => {
									if (
										window.confirm("Delete this issue? This cannot be undone.")
									) {
										deleteIssue.mutate();
									}
								}}
								className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-accent-red/70 hover:text-accent-red hover:bg-accent-red/10 rounded-md transition-colors border border-transparent hover:border-accent-red/20"
							>
								<Trash2 className="w-3.5 h-3.5" />
								Delete
							</button>
						</div>

						{/* Scrollable body */}
						<div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
							{/* Title */}
							<div>
								<textarea
									value={title}
									onChange={(e) => {
										setTitle(e.target.value);
										patchTitle(e.target.value);
									}}
									rows={2}
									className="w-full text-lg font-semibold text-foreground bg-transparent outline-none resize-none leading-snug placeholder:text-muted-foreground/30 focus:ring-0"
									placeholder="Issue title"
								/>
							</div>

							{/* Description — rendered markdown with click-to-edit */}
							<div className="group/desc">
								{descriptionEditing ? (
									<div className="space-y-1">
										<textarea
											autoFocus
											value={description}
											onChange={(e) => {
												setDescription(e.target.value);
												patchDescription(e.target.value);
											}}
											onBlur={() => setDescriptionEditing(false)}
											rows={Math.max(4, description.split("\n").length + 1)}
											placeholder="Add a description… (supports Markdown)"
											className="w-full text-sm text-foreground/80 bg-transparent outline-none resize-none placeholder:text-muted-foreground/30 leading-relaxed focus:ring-0"
										/>
										<p className="text-[10px] text-muted-foreground/30">
											Markdown supported · click outside to save
										</p>
									</div>
								) : (
									<div
										className="relative cursor-text min-h-[2rem]"
										onClick={() => setDescriptionEditing(true)}
									>
										{description ? (
											<div className="prose prose-sm prose-invert max-w-none text-foreground/80 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:leading-relaxed [&_ul]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-white/5 [&_pre]:p-2 [&_pre]:rounded [&_a]:text-setra-400 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-foreground/50 [&_input[type=checkbox]]:mr-1">
												<ReactMarkdown>{description}</ReactMarkdown>
											</div>
										) : (
											<p className="text-sm text-muted-foreground/30 italic">
												Add a description… (supports Markdown)
											</p>
										)}
										<button
											type="button"
											className="absolute top-0 right-0 opacity-0 group-hover/desc:opacity-60 hover:!opacity-100 text-muted-foreground transition-opacity"
											onClick={(e) => {
												e.stopPropagation();
												setDescriptionEditing(true);
											}}
										>
											<Pencil className="w-3 h-3" />
										</button>
									</div>
								)}
							</div>

							{/* Divider */}
							<div className="h-px bg-border/40" />

							{/* Details grid */}
							<div className="space-y-3">
								<p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
									Details
								</p>

								<div className="grid grid-cols-2 gap-3">
									{/* Status */}
									<div className="flex flex-col gap-1.5">
										<span className="text-xs text-muted-foreground/60">
											Status
										</span>
										<SelectDropdown<
											IssueStatus,
											{ value: IssueStatus; label: string; color: string }
										>
											value={issue.status}
											options={STATUS_OPTIONS}
											onChange={(v) => updateIssue.mutate({ status: v })}
											renderSelected={(opt) => (
												<span className={cn("font-medium", opt?.color)}>
													{opt?.label}
												</span>
											)}
											renderOption={(opt) => (
												<span className={cn("font-medium", opt.color)}>
													{opt.label}
												</span>
											)}
										/>
									</div>

									{/* Priority */}
									<div className="flex flex-col gap-1.5">
										<span className="text-xs text-muted-foreground/60">
											Priority
										</span>
										<SelectDropdown<
											IssuePriority,
											{ value: IssuePriority; label: string; dotClass: string }
										>
											value={issue.priority}
											options={PRIORITY_OPTIONS}
											onChange={(v) => updateIssue.mutate({ priority: v })}
											renderSelected={(opt) => (
												<>
													<span className={cn("status-dot", opt?.dotClass)} />
													<span className="font-medium capitalize">
														{opt?.label}
													</span>
												</>
											)}
											renderOption={(opt) => (
												<>
													<span className={cn("status-dot", opt.dotClass)} />
													<span className="capitalize">{opt.label}</span>
												</>
											)}
										/>
									</div>
								</div>

								{/* Assigned agent */}
								<div className="flex flex-col gap-1.5">
									<span className="text-xs text-muted-foreground/60">
										Assigned to
									</span>
									<div className="relative">
										<AgentDropdown
											value={issue.assignedAgentId}
											agents={agents}
											onChange={(agentId) =>
												updateIssue.mutate({ assignedAgentId: agentId })
											}
										/>
									</div>
								</div>

								{/* Labels */}
								<div className="flex flex-col gap-1.5">
									<span className="text-xs text-muted-foreground/60 flex items-center gap-1">
										<Tag className="w-3 h-3" /> Labels
									</span>
									<div className="flex flex-wrap gap-1.5 items-center">
										{labels.map((label) => (
											<span
												key={label}
												className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-setra-600/20 text-setra-300 border border-setra-600/30"
											>
												{label}
												<button
													type="button"
													onClick={() => removeLabel(label)}
													className="text-setra-400/60 hover:text-setra-300 transition-colors leading-none"
												>
													×
												</button>
											</span>
										))}
										<input
											type="text"
											value={labelInput}
											onChange={(e) => setLabelInput(e.target.value)}
											onKeyDown={handleLabelKeyDown}
											onBlur={() => {
												if (labelInput.trim()) {
													addLabel(labelInput);
													setLabelInput("");
												}
											}}
											placeholder="Add label…"
											className="flex-1 min-w-[80px] bg-transparent text-xs text-foreground placeholder:text-muted-foreground/30 outline-none"
										/>
									</div>
								</div>
							</div>

							<div className="flex flex-col gap-1.5">
								<span className="text-xs text-muted-foreground/60">
									Acceptance Criteria
								</span>
								<textarea
									value={acceptanceCriteria}
									onChange={(e) => {
										setAcceptanceCriteria(e.target.value);
										patchAcceptanceCriteria(e.target.value);
									}}
									rows={4}
									placeholder="Define what done looks like… (Markdown supported)"
									className="w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-setra-500/50 resize-y"
								/>
								<p className="text-[10px] text-muted-foreground/40">
									Markdown supported
								</p>
							</div>

							<div className="flex flex-col gap-1.5">
								<span className="text-xs text-muted-foreground/60">
									Test Command
								</span>
								<input
									value={testCommand}
									onChange={(e) => {
										setTestCommand(e.target.value);
										patchTestCommand(e.target.value);
									}}
									placeholder="e.g., npm test, npx playwright test"
									className="w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-setra-500/50"
								/>
							</div>

							<div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/20 p-3">
								<div className="flex items-center justify-between gap-3">
									<div>
										<span className="text-xs text-muted-foreground/60">
											Test Status
										</span>
										<div className="mt-1">
											{issue.testStatus === "running" ? (
												<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
													Testing...
												</span>
											) : issue.testStatus === "passed" ? (
												<span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
													✓ Tests passed
												</span>
											) : issue.testStatus === "failed" ? (
												<span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
													✗ Tests failed
												</span>
											) : issue.testStatus === "pending" ? (
												<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-400">
													Tests pending
												</span>
											) : (
												<span className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
													No tests configured
												</span>
											)}
										</div>
									</div>
									{issue.testStatus === "failed" && testCommand.trim() ? (
										<button
											type="button"
											onClick={() => runTests.mutate()}
											disabled={runTests.isPending}
											className="inline-flex items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/40 disabled:opacity-50"
										>
											{runTests.isPending ? (
												<Loader2 className="h-3.5 w-3.5 animate-spin" />
											) : null}
											Re-run Tests
										</button>
									) : null}
								</div>
							</div>

							{/* Comments section */}
							<div className="h-px bg-border/40" />
							<div className="space-y-3">
								<p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1.5">
									<MessageSquare className="w-3.5 h-3.5" /> Comments
								</p>

								<div className="space-y-3">
									{comments.map((comment) => (
										<div key={comment.id} className="flex gap-2.5 group">
											<div className="w-6 h-6 rounded-full bg-setra-700/40 text-setra-300 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
												{authorInitial(comment.author)}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1">
													<span className="text-xs font-medium text-foreground/80">
														{comment.author}
													</span>
													<span className="text-[10px] text-muted-foreground/50">
														{formatRelativeTime(comment.created_at)}
													</span>
													<button
														type="button"
														onClick={() => deleteComment.mutate(comment.id)}
														className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-accent-red transition-all text-[10px]"
													>
														<Trash2 className="w-3 h-3" />
													</button>
												</div>
												<div className="text-sm text-foreground/70 leading-relaxed prose prose-invert prose-sm max-w-none">
													<ReactMarkdown remarkPlugins={[remarkGfm]}>
														{comment.body}
													</ReactMarkdown>
												</div>
											</div>
										</div>
									))}

									{comments.length === 0 && (
										<p className="text-xs text-muted-foreground/40 italic">
											No comments yet.
										</p>
									)}
								</div>

								{/* Add comment */}
								<div className="flex flex-col gap-2">
									<textarea
										value={commentBody}
										onChange={(e) => setCommentBody(e.target.value)}
										placeholder="Write a comment…"
										rows={3}
										onKeyDown={(e) => {
											if (
												e.key === "Enter" &&
												(e.metaKey || e.ctrlKey) &&
												commentBody.trim()
											) {
												addComment.mutate(commentBody.trim());
											}
										}}
										className="w-full px-3 py-2 bg-muted/30 border border-border/40 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-setra-500/50 resize-none transition-colors"
									/>
									<div className="flex justify-between items-center">
										<span className="text-[10px] text-muted-foreground/40">
											⌘+Enter to send
										</span>
										<button
											type="button"
											onClick={() => {
												if (commentBody.trim())
													addComment.mutate(commentBody.trim());
											}}
											disabled={!commentBody.trim() || addComment.isPending}
											className="px-3 py-1.5 text-xs bg-setra-600 hover:bg-setra-500 disabled:opacity-40 text-white rounded-md transition-colors"
										>
											Send
										</button>
									</div>
								</div>
							</div>

							{/* Activity section */}
							<div className="h-px bg-border/40" />
							<div className="space-y-3 pb-4">
								<p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider flex items-center gap-1.5">
									<Clock className="w-3.5 h-3.5" /> Activity
								</p>

								{activity.length === 0 && (
									<p className="text-xs text-muted-foreground/40 italic">
										No activity yet.
									</p>
								)}

								<div className="space-y-2">
									{activity.map((entry) => (
										<ActivityRow key={entry.id} entry={entry} />
									))}
								</div>
							</div>
						</div>
					</>
				)}
			</div>
		</>
	);
}

interface AgentDropdownProps {
	value: string | null;
	agents: Array<{ id: string; slug: string; role: string }>;
	onChange: (agentId: string | null) => void;
}

function AgentDropdown({ value, agents, onChange }: AgentDropdownProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const current = agents.find((a) => a.id === value || a.slug === value);

	useEffect(() => {
		function handler(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		}
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((p) => !p)}
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/50 bg-muted/30 hover:bg-muted/50 text-xs transition-colors w-full max-w-[200px]"
			>
				<User className="w-3 h-3 text-muted-foreground/60 shrink-0" />
				<span className="flex-1 text-left truncate">
					{current ? current.slug : "Unassigned"}
				</span>
				<ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
			</button>

			{open && (
				<div className="absolute top-full left-0 mt-1 z-50 glass rounded-lg border border-border/60 shadow-xl min-w-[160px] max-h-48 overflow-y-auto py-1">
					<button
						type="button"
						onClick={() => {
							onChange(null);
							setOpen(false);
						}}
						className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 text-left text-muted-foreground transition-colors"
					>
						<User className="w-3 h-3" />
						Unassigned
						{!value && <Check className="w-3 h-3 ml-auto text-setra-400" />}
					</button>
					{agents.map((agent) => (
						<button
							key={agent.id}
							type="button"
							onClick={() => {
								onChange(agent.id);
								setOpen(false);
							}}
							className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 text-left transition-colors"
						>
							<div className="w-4 h-4 rounded-full bg-setra-700/60 text-setra-300 text-[8px] font-bold flex items-center justify-center shrink-0">
								{agent.slug.charAt(0).toUpperCase()}
							</div>
							<span className="flex-1 truncate">{agent.slug}</span>
							<span className="text-muted-foreground/40 truncate max-w-[60px]">
								{agent.role}
							</span>
							{(value === agent.id || value === agent.slug) && (
								<Check className="w-3 h-3 ml-auto text-setra-400 shrink-0" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
	let message = "";
	try {
		const payload = entry.payload
			? (JSON.parse(entry.payload) as { from?: string; to?: string })
			: null;
		if (entry.event === "status_changed" && payload) {
			message = `moved from ${payload.from ?? "?"} to ${payload.to ?? "?"}`;
		} else if (entry.event === "comment_added") {
			message = "added a comment";
		} else {
			message = entry.event.replace(/_/g, " ");
		}
	} catch {
		message = entry.event.replace(/_/g, " ");
	}

	return (
		<div className="flex items-start gap-2.5 text-xs text-muted-foreground/60">
			<div className="w-4 h-4 rounded-full bg-muted/50 text-[8px] font-bold flex items-center justify-center shrink-0 mt-0.5">
				{authorInitial(entry.actor)}
			</div>
			<span className="flex-1 leading-snug">
				<span className="font-medium text-foreground/60">{entry.actor}</span>{" "}
				{message}
			</span>
			<span className="shrink-0 text-[10px]">
				{formatRelativeTime(entry.created_at)}
			</span>
		</div>
	);
}
