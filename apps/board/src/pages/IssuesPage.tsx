import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Bot,
	ChevronDown,
	ClipboardList,
	GitBranch,
	GitPullRequest,
	GripVertical,
	LayoutGrid,
	List,
	Loader2,
	Plus,
	Settings2,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DeliveryWidget } from "../components/DeliveryWidget";
import { FilterBar, type FilterState } from "../components/FilterBar";
import { IssueDetailPanel } from "../components/IssueDetailPanel";
import { KanbanBoard } from "../components/KanbanBoard";
import { Button, EmptyState } from "../components/ui";
import {
	type Issue,
	type IssueStatus,
	type LifecycleStage,
	type Project,
	type ProjectSettings,
	type RosterEntry,
	api,
	request,
} from "../lib/api";
import { cn } from "../lib/utils";

const priorityDot: Record<Issue["priority"], string> = {
	none: "bg-muted-foreground/40",
	low: "bg-setra-400",
	medium: "bg-accent-yellow",
	high: "bg-accent-orange",
	urgent: "bg-accent-red animate-pulse",
};

const STATUS_PIPELINE: IssueStatus[] = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"done",
];

const STATUS_GROUP_ORDER: IssueStatus[] = [
	"in_progress",
	"todo",
	"backlog",
	"in_review",
	"done",
];

const PROJECT_SETTINGS_FALLBACKS = {
	autoTestEnabled: false,
	testCommand: "",
	maxParallelRuns: 3,
	budgetCapUsd: 0,
	autoApprove: false,
	defaultBranch: "main",
} satisfies ProjectSettings;

// Deterministic per-issue accent (left stripe). Same id always maps to same hue.
const ISSUE_STRIPE_PALETTE = [
	"border-l-setra-500",
	"border-l-accent-purple",
	"border-l-accent-green",
	"border-l-blue-500",
	"border-l-accent-orange",
	"border-l-yellow-500",
	"border-l-pink-500",
	"border-l-teal-400",
] as const;
function stripeForIssue(id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++)
		h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
	return (
		ISSUE_STRIPE_PALETTE[Math.abs(h) % ISSUE_STRIPE_PALETTE.length] ??
		"border-l-setra-500"
	);
}

function parseTagList(value: string | null | undefined): string[] {
	return (
		value
			?.split(",")
			.map((tag) => tag.trim())
			.filter(Boolean) ?? []
	);
}

function IssueTestBadge({
	testStatus,
}: {
	testStatus: Issue["testStatus"];
}) {
	if (!testStatus || testStatus === "none" || testStatus === "pending") {
		return null;
	}
	if (testStatus === "running") {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
				<Loader2 className="h-3 w-3 animate-spin" /> Testing...
			</span>
		);
	}
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
				testStatus === "passed"
					? "bg-green-500/10 text-green-400"
					: "bg-red-500/10 text-red-400",
			)}
		>
			{testStatus === "passed" ? "✓ Tests passed" : "✗ Tests failed"}
		</span>
	);
}

interface ParsedIssue {
	title: string;
	description: string;
	priority: Issue["priority"];
	suggestedAgent: string;
	estimatedComplexity: number;
}

async function parseGoal(goal: string): Promise<ParsedIssue[]> {
	const data = await api.parseGoal(goal);
	return data.issues;
}

export function IssuesPage() {
	const { id: projectId } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const [searchParams, setSearchParams] = useSearchParams();
	const [creating, setCreating] = useState<IssueStatus | null>(null);
	const [newTitle, setNewTitle] = useState("");
	const [newAssignee, setNewAssignee] = useState<string>("");
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
	const [filterStatus, setFilterStatus] = useState<IssueStatus | null>(null);
	const [collapsedStatuses, setCollapsedStatuses] = useState<
		Partial<Record<IssueStatus, boolean>>
	>({});
	const [showProjectSettings, setShowProjectSettings] = useState(false);
	const [projectSettingsDraft, setProjectSettingsDraft] =
		useState<ProjectSettings | null>(null);

	// ── Filters persisted in URL search params ──
	// Hydrate the filter state from ?status=...&priority=...&lifecycle=...&q=...
	// on mount, and serialize back on every change. This keeps deep links and
	// browser-back working across the SDLC delivery board.
	const filters = useMemo<FilterState>(() => {
		const splitCsv = (k: string): string[] => {
			const v = searchParams.get(k);
			return v ? v.split(",").filter(Boolean) : [];
		};
		return {
			status: splitCsv("status") as IssueStatus[],
			priority: splitCsv("priority") as Issue["priority"][],
			lifecycle: splitCsv("lifecycle") as LifecycleStage[],
			labels: splitCsv("labels"),
			assignedAgentId: searchParams.get("assignee"),
			projectId: searchParams.get("project"),
			search: searchParams.get("q") ?? "",
		};
	}, [searchParams]);

	const setFilters = (next: FilterState): void => {
		const sp = new URLSearchParams();
		if (next.status.length) sp.set("status", next.status.join(","));
		if (next.priority.length) sp.set("priority", next.priority.join(","));
		if (next.lifecycle.length) sp.set("lifecycle", next.lifecycle.join(","));
		if (next.labels.length) sp.set("labels", next.labels.join(","));
		if (next.assignedAgentId) sp.set("assignee", next.assignedAgentId);
		if (next.projectId) sp.set("project", next.projectId);
		if (next.search.trim()) sp.set("q", next.search.trim());
		setSearchParams(sp, { replace: true });
	};

	// AI goal parser state
	const [showGoalParser, setShowGoalParser] = useState(false);
	const [goalText, setGoalText] = useState("");
	const [parsedIssues, setParsedIssues] = useState<ParsedIssue[] | null>(null);
	const [parsing, setParsing] = useState(false);
	const [accepting, setAccepting] = useState(false);
	const [acceptError, setAcceptError] = useState<string | null>(null);

	const { data: issues = [] } = useQuery({
		queryKey: ["issues", projectId],
		queryFn: () => api.issues.list(projectId!),
		enabled: !!projectId,
	});

	const { data: roster = [] } = useQuery<RosterEntry[]>({
		queryKey: ["roster"],
		queryFn: () => api.agents.roster.list(),
	});

	// Fetch all projects so we can render per-issue color stripes + project pills
	// even if the user navigates here directly without a project context.
	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ["projects"],
		queryFn: () => api.projects.list(),
	});
	const project = projects.find((p) => p.id === projectId) ?? null;
	const { data: projectSettings } = useQuery<ProjectSettings>({
		queryKey: ["project-settings", projectId],
		queryFn: () => api.projects.settings.get(projectId!),
		enabled: Boolean(projectId && showProjectSettings),
	});
	const { data: globalSettings } = useQuery<{
		autonomy?: { maxParallelRuns?: number };
		governance?: { autoApprove?: boolean };
	}>({
		queryKey: ["settings", "project-defaults"],
		queryFn: () =>
			request<{
				autonomy?: { maxParallelRuns?: number };
				governance?: { autoApprove?: boolean };
			}>("/settings"),
		enabled: Boolean(projectId && showProjectSettings),
	});
	const projectsById = useMemo(() => {
		const m = new Map<string, Project>();
		for (const p of projects) m.set(p.id, p);
		return m;
	}, [projects]);

	useEffect(() => {
		if (projectSettings) setProjectSettingsDraft(projectSettings);
	}, [projectSettings]);

	const projectSettingOverrides = useMemo(() => {
		if (!project?.settingsJson) return {} as Record<string, unknown>;
		try {
			const parsed = JSON.parse(project.settingsJson) as Record<
				string,
				unknown
			>;
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed
				: {};
		} catch {
			return {} as Record<string, unknown>;
		}
	}, [project?.settingsJson]);

	const projectSettingDefaults = useMemo(
		() => ({
			...PROJECT_SETTINGS_FALLBACKS,
			maxParallelRuns:
				globalSettings?.autonomy?.maxParallelRuns ??
				PROJECT_SETTINGS_FALLBACKS.maxParallelRuns,
			autoApprove:
				globalSettings?.governance?.autoApprove ??
				PROJECT_SETTINGS_FALLBACKS.autoApprove,
			defaultBranch:
				project?.defaultBranch ?? PROJECT_SETTINGS_FALLBACKS.defaultBranch,
		}),
		[
			globalSettings?.autonomy?.maxParallelRuns,
			globalSettings?.governance?.autoApprove,
			project?.defaultBranch,
		],
	);

	const saveProjectSettings = useMutation({
		mutationFn: async () => {
			if (!projectId || !projectSettingsDraft) {
				throw new Error("Project settings are not loaded");
			}
			return api.projects.settings.update(projectId, projectSettingsDraft);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["project-settings", projectId] });
			qc.invalidateQueries({ queryKey: ["projects"] });
			setShowProjectSettings(false);
		},
	});

	const createIssue = useMutation({
		mutationFn: (opts: {
			title: string;
			status: IssueStatus;
			priority?: Issue["priority"];
			assignedAgentId?: string;
		}) =>
			api.issues.create({
				projectId: projectId!,
				title: opts.title,
				status: opts.status,
				...(opts.priority !== undefined ? { priority: opts.priority } : {}),
				...(opts.assignedAgentId !== undefined
					? { assignedAgentId: opts.assignedAgentId }
					: {}),
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["issues", projectId] });
			setCreating(null);
			setNewTitle("");
			setNewAssignee("");
		},
	});

	const updateStatus = useMutation({
		mutationFn: ({ id, status }: { id: string; status: IssueStatus }) =>
			api.issues.update(id, { status }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["issues", projectId] }),
	});

	async function handleParseGoal() {
		if (!goalText.trim()) return;
		setParsing(true);
		try {
			const issues = await parseGoal(goalText);
			setParsedIssues(issues);
		} finally {
			setParsing(false);
		}
	}

	async function acceptParsedIssues() {
		if (!parsedIssues) return;
		setAcceptError(null);
		setAccepting(true);
		try {
			for (const issue of parsedIssues) {
				await createIssue.mutateAsync({
					title: issue.title,
					status: "backlog",
					priority: issue.priority,
					assignedAgentId: issue.suggestedAgent,
				});
			}
			setShowGoalParser(false);
			setGoalText("");
			setParsedIssues(null);
		} catch (err) {
			setAcceptError(
				err instanceof Error ? err.message : "Failed to create issues",
			);
		} finally {
			setAccepting(false);
		}
	}

	const effectiveProjectSettings =
		projectSettingsDraft ?? projectSettingDefaults;
	const usesGlobalProjectSetting = (key: keyof ProjectSettings) =>
		!(key in projectSettingOverrides);
	const formatProjectSettingDefault = (key: keyof ProjectSettings) => {
		const value = projectSettingDefaults[key];
		if (typeof value === "boolean") return value ? "On" : "Off";
		if (typeof value === "number") {
			return key === "budgetCapUsd" ? `$${value}` : `${value}`;
		}
		return value || "Empty";
	};

	// Filter logic
	const filteredIssues = issues.filter((issue) => {
		if (filters.search) {
			const q = filters.search.toLowerCase();
			if (
				!issue.title.toLowerCase().includes(q) &&
				!issue.slug?.toLowerCase().includes(q)
			)
				return false;
		}
		if (filters.status.length > 0 && !filters.status.includes(issue.status))
			return false;
		if (
			filters.priority.length > 0 &&
			!filters.priority.includes(issue.priority)
		)
			return false;
		if (filters.lifecycle.length > 0) {
			const stage = issue.lifecycleStage ?? "backlog";
			if (!filters.lifecycle.includes(stage)) return false;
		}
		if (
			filters.assignedAgentId &&
			issue.assignedAgentId !== filters.assignedAgentId
		)
			return false;
		if (filters.projectId && issue.projectId !== filters.projectId)
			return false;
		if (filters.labels.length > 0) {
			const issueLabels = issue.labels?.split(",").map((l) => l.trim()) ?? [];
			if (!filters.labels.some((fl) => issueLabels.includes(fl))) return false;
		}
		if (filterStatus && issue.status !== filterStatus) return false;
		return true;
	});

	const openCreateIssue = (status: IssueStatus = filterStatus ?? "backlog") => {
		setViewMode("list");
		setCreating(status);
	};

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Project Delivery widget — only shown when scoped to a project */}
			{projectId && <DeliveryWidget projectId={projectId} project={project} />}

			{/* Toolbar */}
			<div className="flex flex-col gap-2 px-4 py-2.5 border-b border-border/30 shrink-0">
				<div className="flex items-center justify-between gap-3">
					<div>
						{project ? (
							<p className="text-sm font-semibold text-foreground">
								{project.name}
							</p>
						) : null}
						<p className="text-xs text-muted-foreground/60">
							{filteredIssues.length} issues
						</p>
					</div>
					<div className="flex items-center gap-2">
						{/* View toggle */}
						<div className="flex items-center rounded-md border border-border/40 overflow-hidden">
							<button
								onClick={() => setViewMode("list")}
								className={cn(
									"flex items-center gap-1 px-2 py-1 text-xs transition-colors",
									viewMode === "list"
										? "bg-setra-600/20 text-setra-300"
										: "text-muted-foreground hover:bg-muted/30",
								)}
							>
								<List className="w-3.5 h-3.5" />
								List
							</button>
							<button
								onClick={() => setViewMode("kanban")}
								className={cn(
									"flex items-center gap-1 px-2 py-1 text-xs transition-colors border-l border-border/40",
									viewMode === "kanban"
										? "bg-setra-600/20 text-setra-300"
										: "text-muted-foreground hover:bg-muted/30",
								)}
							>
								<LayoutGrid className="w-3.5 h-3.5" />
								Kanban
							</button>
						</div>
						{projectId ? (
							<button
								onClick={() => {
									setProjectSettingsDraft(
										projectSettings ?? projectSettingDefaults,
									);
									setShowProjectSettings(true);
								}}
								className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/40 hover:bg-muted/60 text-muted-foreground hover:text-foreground text-xs rounded-md transition-colors border border-border/40"
							>
								<Settings2 className="w-3.5 h-3.5" />
								Project Settings
							</button>
						) : null}
						<button
							onClick={() => setShowGoalParser(true)}
							className="flex items-center gap-1.5 px-2.5 py-1.5 bg-setra-600/15 hover:bg-setra-600/25 text-setra-300 text-xs rounded-md transition-colors border border-setra-600/20"
						>
							<Sparkles className="w-3.5 h-3.5" />
							Parse Goal → Issues
						</button>
					</div>
				</div>
				<FilterBar
					filters={filters}
					onChange={setFilters}
					projects={projects}
				/>
				<div className="flex flex-wrap items-center gap-1">
					{STATUS_PIPELINE.map((status) => {
						const count = issues.filter(
							(issue) => issue.status === status,
						).length;
						const colors: Record<IssueStatus, string> = {
							backlog: "bg-surface-2 text-text-secondary",
							todo: "bg-blue-500/10 text-blue-400",
							in_progress: "bg-amber-500/10 text-amber-400",
							in_review: "bg-purple-500/10 text-purple-400",
							done: "bg-green-500/10 text-green-400",
							blocked: "bg-red-500/10 text-red-400",
							cancelled: "bg-muted/40 text-muted-foreground",
						};
						return (
							<button
								key={status}
								onClick={() =>
									setFilterStatus((current) =>
										current === status ? null : status,
									)
								}
								className={cn(
									"flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
									colors[status],
									filterStatus === status && "ring-1 ring-accent-blue",
								)}
							>
								<span className="capitalize">{status.replace("_", " ")}</span>
								<span className="text-xs opacity-70">{count}</span>
							</button>
						);
					})}
					<button
						onClick={() => setFilterStatus(null)}
						className={cn(
							"px-3 py-1.5 rounded-lg text-sm text-text-secondary",
							!filterStatus && "ring-1 ring-accent-blue",
						)}
					>
						All ({issues.length})
					</button>
				</div>
			</div>

			{/* Content: List or Kanban */}
			{viewMode === "kanban" ? (
				<KanbanBoard
					issues={filteredIssues}
					onUpdateIssue={(id, data) =>
						updateStatus.mutate({ id, status: data.status! })
					}
					onIssueClick={(id) => navigate(`/issues/${id}`)}
				/>
			) : issues.length === 0 ? (
				<div className="p-4 flex-1 overflow-y-auto">
					<EmptyState
						icon={<ClipboardList className="h-8 w-8" />}
						title="No tasks yet"
						description="Add tasks manually, or if this project has requirements, let the CEO agent create a plan."
						action={
							<div className="flex gap-3">
								<Button size="sm" onClick={() => openCreateIssue()}>
									Create Task
								</Button>
								{project?.requirements && (
									<Button
										size="sm"
										variant="secondary"
										onClick={() => navigate("/assistant")}
									>
										Plan from Requirements →
									</Button>
								)}
							</div>
						}
					/>
				</div>
			) : (
				<div className="p-4 flex-1 overflow-y-auto">
					{filteredIssues.length === 0 ? (
						<div className="glass rounded-xl border border-border/40 px-4 py-6 text-sm text-muted-foreground">
							No tasks match the current filters.
						</div>
					) : (
						<div className="space-y-6">
							{STATUS_GROUP_ORDER.map((status) => {
								const statusIssues = filteredIssues.filter(
									(issue) => issue.status === status,
								);
								if (statusIssues.length === 0) return null;
								const isCollapsed = collapsedStatuses[status] === true;
								return (
									<div key={status} className="space-y-3">
										<button
											type="button"
											onClick={() =>
												setCollapsedStatuses((current) => ({
													...current,
													[status]: !current[status],
												}))
											}
											className="flex items-center gap-2 text-sm font-medium text-text-secondary uppercase tracking-wide"
										>
											<ChevronDown
												className={cn(
													"h-4 w-4 transition-transform",
													isCollapsed && "-rotate-90",
												)}
											/>
											<span>{status.replace("_", " ")}</span>
											<span>({statusIssues.length})</span>
										</button>
										{!isCollapsed && (
											<div className="space-y-2">
												{statusIssues.map((issue) => (
													<IssueCard
														key={issue.id}
														issue={issue}
														project={projectsById.get(issue.projectId) ?? null}
														roster={roster}
														onSelect={(id) => navigate(`/issues/${id}`)}
														onQuickLook={setSelectedIssueId}
													/>
												))}
												{creating === status ? (
													<form
														onSubmit={(e) => {
															e.preventDefault();
															if (newTitle.trim()) {
																createIssue.mutate({
																	title: newTitle.trim(),
																	status,
																	...(newAssignee
																		? { assignedAgentId: newAssignee }
																		: {}),
																});
															}
														}}
														className="rounded-lg border border-setra-600/40 bg-muted/30 p-2 animate-slide-in-up space-y-2"
													>
														<input
															autoFocus
															value={newTitle}
															onChange={(e) => setNewTitle(e.target.value)}
															placeholder="Issue title..."
															className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
														/>
														{roster.length > 0 && (
															<select
																value={newAssignee}
																onChange={(e) => setNewAssignee(e.target.value)}
																className="w-full bg-muted/50 border border-border/40 rounded text-xs text-muted-foreground px-2 py-1 focus:outline-none focus:border-setra-500"
															>
																<option value="">Assign to… (optional)</option>
																{roster.map((r) => (
																	<option key={r.id} value={r.id}>
																		{r.display_name} — {r.template_name}
																	</option>
																))}
															</select>
														)}
														<div className="flex gap-1.5">
															<button
																type="submit"
																className="px-2.5 py-1 text-xs rounded bg-setra-600 hover:bg-setra-500 text-white transition-colors"
															>
																Add
															</button>
															<button
																type="button"
																onClick={() => {
																	setCreating(null);
																	setNewAssignee("");
																}}
																className="px-2.5 py-1 text-xs rounded hover:bg-muted/50 text-muted-foreground transition-colors"
															>
																Cancel
															</button>
														</div>
													</form>
												) : (
													<button
														type="button"
														onClick={() => openCreateIssue(status)}
														className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground rounded-lg hover:bg-muted/30 transition-colors"
													>
														<Plus className="w-3.5 h-3.5" /> Add issue
													</button>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}

			{/* Issue detail slide-over */}
			<IssueDetailPanel
				issueId={selectedIssueId}
				projectId={projectId!}
				onClose={() => setSelectedIssueId(null)}
			/>

			{showProjectSettings && projectId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-ground-950/80 backdrop-blur-sm">
					<div className="glass rounded-xl border border-border/60 w-full max-w-2xl p-6 flex flex-col gap-5">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-base font-semibold text-foreground">
									Project Settings
								</h2>
								<p className="text-xs text-muted-foreground/70 mt-1">
									Configure project-specific testing, budget, concurrency, and
									git defaults.
								</p>
							</div>
							<button
								onClick={() => setShowProjectSettings(false)}
								className="text-muted-foreground/50 hover:text-foreground transition-colors"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4">
								<h3 className="text-sm font-medium text-foreground">Testing</h3>
								<label className="flex items-center justify-between gap-3 text-sm text-foreground">
									<span>Auto-run tests</span>
									<input
										type="checkbox"
										checked={effectiveProjectSettings.autoTestEnabled}
										onChange={(e) =>
											setProjectSettingsDraft({
												...effectiveProjectSettings,
												autoTestEnabled: e.target.checked,
											})
										}
									/>
								</label>
								<p className="text-xs text-muted-foreground/60">
									{usesGlobalProjectSetting("autoTestEnabled")
										? `(Global default: ${formatProjectSettingDefault("autoTestEnabled")})`
										: "Using a project override."}
								</p>
								<input
									value={effectiveProjectSettings.testCommand}
									onChange={(e) =>
										setProjectSettingsDraft({
											...effectiveProjectSettings,
											testCommand: e.target.value,
										})
									}
									placeholder="npm test"
									className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-setra-500"
								/>
								<p className="text-xs text-muted-foreground/60">
									{usesGlobalProjectSetting("testCommand")
										? `(Global default: ${formatProjectSettingDefault("testCommand")})`
										: "Using a project override."}
								</p>
							</div>

							<div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4">
								<h3 className="text-sm font-medium text-foreground">
									Concurrency
								</h3>
								<input
									type="range"
									min={1}
									max={10}
									value={effectiveProjectSettings.maxParallelRuns}
									onChange={(e) =>
										setProjectSettingsDraft({
											...effectiveProjectSettings,
											maxParallelRuns: Number(e.target.value),
										})
									}
									className="w-full"
								/>
								<p className="text-sm text-foreground">
									{effectiveProjectSettings.maxParallelRuns} concurrent runs
								</p>
								<p className="text-xs text-muted-foreground/60">
									{usesGlobalProjectSetting("maxParallelRuns")
										? `(Global default: ${formatProjectSettingDefault("maxParallelRuns")})`
										: "Using a project override."}
								</p>
							</div>

							<div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4">
								<h3 className="text-sm font-medium text-foreground">Budget</h3>
								<input
									type="number"
									min={0}
									step="0.01"
									value={effectiveProjectSettings.budgetCapUsd}
									onChange={(e) =>
										setProjectSettingsDraft({
											...effectiveProjectSettings,
											budgetCapUsd: Number(e.target.value || 0),
										})
									}
									className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
								/>
								<p className="text-xs text-muted-foreground/60">
									{usesGlobalProjectSetting("budgetCapUsd")
										? `(Global default: ${formatProjectSettingDefault("budgetCapUsd")})`
										: "Using a project override."}
								</p>
							</div>

							<div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4">
								<h3 className="text-sm font-medium text-foreground">Git</h3>
								<input
									value={effectiveProjectSettings.defaultBranch}
									onChange={(e) =>
										setProjectSettingsDraft({
											...effectiveProjectSettings,
											defaultBranch: e.target.value,
										})
									}
									placeholder="main"
									className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
								/>
								<p className="text-xs text-muted-foreground/60">
									{usesGlobalProjectSetting("defaultBranch")
										? `(Global default: ${formatProjectSettingDefault("defaultBranch")})`
										: "Using a project override."}
								</p>
							</div>

							<div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4 md:col-span-2">
								<h3 className="text-sm font-medium text-foreground">
									Governance
								</h3>
								<label className="flex items-center justify-between gap-3 text-sm text-foreground">
									<span>Auto-approve</span>
									<input
										type="checkbox"
										checked={effectiveProjectSettings.autoApprove}
										onChange={(e) =>
											setProjectSettingsDraft({
												...effectiveProjectSettings,
												autoApprove: e.target.checked,
											})
										}
									/>
								</label>
								<p className="text-xs text-muted-foreground/60">
									{usesGlobalProjectSetting("autoApprove")
										? `(Global default: ${formatProjectSettingDefault("autoApprove")})`
										: "Using a project override."}
								</p>
							</div>
						</div>

						<div className="flex items-center justify-end gap-2">
							<button
								onClick={() => setShowProjectSettings(false)}
								className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
								disabled={saveProjectSettings.isPending}
							>
								Cancel
							</button>
							<button
								onClick={() => saveProjectSettings.mutate()}
								disabled={
									saveProjectSettings.isPending || !projectSettingsDraft
								}
								className="px-4 py-1.5 bg-setra-600 hover:bg-setra-500 text-white text-sm rounded-md transition-colors disabled:opacity-50"
							>
								{saveProjectSettings.isPending ? "Saving…" : "Save Settings"}
							</button>
						</div>
						{saveProjectSettings.isError ? (
							<p className="text-xs text-accent-red">
								Failed to save project settings.
							</p>
						) : null}
					</div>
				</div>
			)}

			{/* Goal parser modal */}
			{showGoalParser && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-ground-950/80 backdrop-blur-sm">
					<div className="glass rounded-xl border border-border/60 w-full max-w-xl p-6 flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Sparkles className="w-4 h-4 text-setra-400" />
								<h2 className="text-base font-semibold text-foreground">
									Parse Goal into Issues
								</h2>
							</div>
							<button
								onClick={() => {
									setShowGoalParser(false);
									setParsedIssues(null);
									setGoalText("");
								}}
								className="text-muted-foreground/50 hover:text-foreground transition-colors"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<p className="text-xs text-muted-foreground/70">
							Describe what you want to build. Setra will break it into
							structured issues and assign the right agents.
						</p>

						<textarea
							value={goalText}
							onChange={(e) => setGoalText(e.target.value)}
							placeholder="e.g. Build a user authentication system with JWT, refresh tokens, and rate limiting. Add unit tests. Review security before deploy."
							rows={4}
							className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-setra-500 resize-none"
						/>

						{parsedIssues === null ? (
							<div className="flex justify-end">
								<button
									onClick={handleParseGoal}
									disabled={!goalText.trim() || parsing}
									className="flex items-center gap-1.5 px-4 py-1.5 bg-setra-600 hover:bg-setra-500 disabled:opacity-40 text-white text-sm rounded-md transition-colors"
								>
									{parsing ? (
										<>
											<Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing…
										</>
									) : (
										<>
											<Sparkles className="w-3.5 h-3.5" /> Parse
										</>
									)}
								</button>
							</div>
						) : (
							<>
								<div className="space-y-2 max-h-64 overflow-y-auto">
									<p className="text-xs text-muted-foreground/60 font-medium">
										{parsedIssues.length} issues generated
									</p>
									{parsedIssues.map((issue, i) => (
										<div
											key={i}
											className="flex items-start gap-2 p-2.5 bg-muted/30 rounded-lg border border-border/30"
										>
											<span
												className={cn(
													"status-dot mt-1.5 shrink-0",
													issue.priority === "urgent"
														? "bg-accent-red animate-pulse"
														: issue.priority === "high"
															? "bg-accent-orange"
															: issue.priority === "medium"
																? "bg-accent-yellow"
																: "bg-setra-400",
												)}
											/>
											<div className="flex-1 min-w-0">
												<p className="text-sm text-foreground leading-snug">
													{issue.title}
												</p>
												<div className="flex gap-2 mt-1 text-[10px] text-muted-foreground/50">
													<span>{issue.suggestedAgent}</span>
													<span>·</span>
													<span>complexity {issue.estimatedComplexity}/10</span>
													<span>·</span>
													<span>{issue.priority}</span>
												</div>
											</div>
										</div>
									))}
								</div>
								<div className="flex gap-2 justify-end">
									<button
										onClick={() => {
											setParsedIssues(null);
											setAcceptError(null);
										}}
										className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
										disabled={accepting}
									>
										Re-parse
									</button>
									<button
										onClick={acceptParsedIssues}
										disabled={accepting}
										className="px-4 py-1.5 bg-setra-600 hover:bg-setra-500 text-white text-sm rounded-md transition-colors disabled:opacity-50"
									>
										{accepting
											? "Adding…"
											: `Add ${parsedIssues.length} Issues to Backlog`}
									</button>
								</div>
								{acceptError && (
									<p className="text-xs text-accent-red mt-2">
										Failed: {acceptError}
									</p>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function IssueCard({
	issue,
	project,
	roster,
	onSelect,
	onQuickLook,
}: {
	issue: Issue;
	project: Project | null;
	roster: RosterEntry[];
	onSelect: (id: string) => void;
	onQuickLook?: (id: string) => void;
}) {
	const assignedAgent = issue.assignedAgentId
		? roster.find((r) => r.id === issue.assignedAgentId)
		: null;
	const projectColor = project?.color ?? null;
	const isPlanned = parseTagList(issue.tags).includes("requirements-plan");
	const hasAcceptanceCriteria = Boolean(issue.acceptanceCriteria?.trim());

	return (
		<div
			draggable
			onDragStart={(e) => e.dataTransfer.setData("issueId", issue.id)}
			onClick={() => onSelect(issue.id)}
			className={cn(
				"group glass rounded-lg p-3 cursor-pointer hover:border-setra-600/30 transition-all border-l-4",
				projectColor ? "" : stripeForIssue(issue.id),
			)}
			style={projectColor ? { borderLeftColor: projectColor } : undefined}
		>
			<div className="flex items-start gap-2">
				<GripVertical
					className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-muted-foreground/50 mt-0.5 shrink-0 transition-colors cursor-grab active:cursor-grabbing"
					onClick={(e) => e.stopPropagation()}
				/>
				<div className="flex-1 min-w-0 space-y-2">
					<div className="flex items-center gap-1.5 flex-wrap">
						<p className="text-xs text-muted-foreground/60 font-mono">
							{issue.slug}
						</p>
						{project && (
							<span
								className="text-[10px] px-1.5 py-0.5 rounded-full font-medium truncate max-w-[100px]"
								style={{
									backgroundColor: `${projectColor ?? "#6366f1"}22`,
									color: projectColor ?? "#a5b4fc",
								}}
								title={project.name}
							>
								{project.name}
							</span>
						)}
						{hasAcceptanceCriteria && (
							<span
								className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/80"
								title="Acceptance criteria added"
							>
								<ClipboardList className="h-3 w-3" />
							</span>
						)}
						{isPlanned && (
							<span className="inline-flex items-center gap-1 rounded-full bg-setra-600/10 px-2 py-0.5 text-[10px] font-medium text-setra-300">
								🤖 Planned
							</span>
						)}
					</div>
					<p className="text-sm leading-snug">{issue.title}</p>
					<div className="flex items-center gap-2 flex-wrap">
						<span className={cn("status-dot", priorityDot[issue.priority])} />
						{assignedAgent ? (
							<span className="flex items-center gap-1 text-xs text-setra-300/80 truncate">
								<Bot className="w-3 h-3 shrink-0" />
								{assignedAgent.display_name}
							</span>
						) : issue.assignedAgentId ? (
							<span className="text-xs text-muted-foreground truncate">
								{issue.assignedAgentId}
							</span>
						) : null}
						{issue.branchName ? (
							<span
								className="flex items-center gap-1 text-[10px] text-muted-foreground/70 font-mono truncate"
								title={issue.branchName}
							>
								<GitBranch className="w-3 h-3 shrink-0" />
								{issue.branchName.replace(/^issue\//, "")}
							</span>
						) : null}
						{issue.prState ? (
							<span
								className={cn(
									"flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded",
									issue.prState === "merged"
										? "text-accent-purple bg-accent-purple/10"
										: issue.prState === "open"
											? "text-accent-green  bg-accent-green/10"
											: "text-muted-foreground bg-muted/30",
								)}
							>
								<GitPullRequest className="w-3 h-3" />
								{issue.prState}
							</span>
						) : null}
						<IssueTestBadge testStatus={issue.testStatus} />
						{onQuickLook && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onQuickLook(issue.id);
								}}
								className="ml-auto text-[10px] text-muted-foreground/30 hover:text-muted-foreground transition-colors opacity-0 group-hover:opacity-100"
							>
								Quick look
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
