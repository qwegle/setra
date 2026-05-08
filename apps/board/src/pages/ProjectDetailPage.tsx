import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Bot,
	Coffee,
	FolderGit2,
	GitBranch,
	KeyRound,
	ListChecks,
	Loader2,
	Monitor,
	Plus,
	RefreshCw,
	Shield,
	TerminalSquare,
	Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	Modal,
	PageHeader,
} from "../components/ui";
import {
	type ContextRefreshResult,
	type GitBranchesResponse,
	type GitLogResponse,
	type GitStatusResponse,
	type Project,
	type ProjectAgent,
	type ProjectBreakResponse,
	type ProjectContextDocument,
	type ProjectSecret,
	type RosterEntry,
	type SdlcStats,
	api,
} from "../lib/api";
import { cn, formatCost, timeAgo } from "../lib/utils";
import { IssuesPage } from "./IssuesPage";

type TabId =
	| "overview"
	| "issues"
	| "agents"
	| "git"
	| "passwords"
	| "terminal"
	| "context";

const TABS: Array<{ id: TabId; label: string; icon: typeof Users }> = [
	{ id: "overview", label: "Overview", icon: ListChecks },
	{ id: "issues", label: "Issues", icon: ListChecks },
	{ id: "agents", label: "Agents", icon: Users },
	{ id: "git", label: "Git", icon: FolderGit2 },
	{ id: "passwords", label: "Passwords", icon: KeyRound },
	{ id: "terminal", label: "Terminal", icon: TerminalSquare },
	{ id: "context", label: "Context", icon: Shield },
];

function initials(value: string): string {
	return (
		value
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() ?? "")
			.join("") || "?"
	);
}

function avatarTone(value: string): string {
	const palette = [
		"bg-setra-600",
		"bg-blue-500",
		"bg-emerald-500",
		"bg-violet-500",
		"bg-orange-500",
	];
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
	}
	return palette[Math.abs(hash) % palette.length] ?? palette[0]!;
}

function statusVariant(
	status: string,
): "default" | "success" | "warning" | "danger" | "info" {
	switch (status) {
		case "running":
			return "success";
		case "on_break":
			return "warning";
		case "paused":
		case "waiting_approval":
			return "warning";
		case "error":
			return "danger";
		case "idle":
			return "info";
		default:
			return "default";
	}
}

function ProjectMetric({
	label,
	value,
	subtitle,
}: {
	label: string;
	value: string;
	subtitle?: string;
}) {
	return (
		<div className="glass rounded-xl px-4 py-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-2xl font-semibold text-white">{value}</div>
			{subtitle ? (
				<div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
			) : null}
		</div>
	);
}

function AgentAvatar({
	agent,
}: { agent: Pick<ProjectAgent, "displayName" | "slug"> }) {
	return (
		<div
			title={`${agent.displayName} (@${agent.slug})`}
			className={cn(
				"flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-zinc-950",
				avatarTone(agent.slug),
			)}
		>
			{initials(agent.displayName)}
		</div>
	);
}

function RefreshSummary({ result }: { result: ContextRefreshResult | null }) {
	if (!result) return null;
	return (
		<div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-100">
			<div className="font-medium">{result.summary}</div>
			<div className="mt-1 text-xs text-blue-200/80">
				Pruned {result.pruned} • Remaining {result.remaining}
			</div>
		</div>
	);
}

export function ProjectDetailPage() {
	const { id: projectId = "" } = useParams<{ id: string }>();
	const qc = useQueryClient();
	const [activeTab, setActiveTab] = useState<TabId>("overview");
	const [showAssignModal, setShowAssignModal] = useState(false);
	const [selectedAgentId, setSelectedAgentId] = useState("");
	const [secretKey, setSecretKey] = useState("");
	const [secretValue, setSecretValue] = useState("");
	const [contextDraft, setContextDraft] = useState("");
	const [refreshResult, setRefreshResult] =
		useState<ContextRefreshResult | null>(null);
	const [breakResult, setBreakResult] = useState<ProjectBreakResponse | null>(
		null,
	);
	const [breakCountdown, setBreakCountdown] = useState(0);
	const [toastMessage, setToastMessage] = useState<{
		type: "success" | "error" | "info";
		text: string;
	} | null>(null);

	// Auto-dismiss toasts after 5 seconds
	useEffect(() => {
		if (!toastMessage) return;
		const t = setTimeout(() => setToastMessage(null), 5000);
		return () => clearTimeout(t);
	}, [toastMessage]);

	// Break countdown timer
	useEffect(() => {
		if (!breakResult) return;
		const endsAt = new Date(breakResult.endsAt).getTime();
		const tick = () => {
			const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
			setBreakCountdown(remaining);
			if (remaining <= 0) {
				setBreakResult(null);
				setToastMessage({
					type: "info",
					text: "☕ Break is over — agents are back to work!",
				});
			}
		};
		tick();
		const interval = setInterval(tick, 1000);
		return () => clearInterval(interval);
	}, [breakResult]);

	const projectQuery = useQuery<Project>({
		queryKey: ["project", projectId],
		queryFn: () => api.projects.get(projectId),
		enabled: Boolean(projectId),
	});
	const issuesQuery = useQuery({
		queryKey: ["issues", projectId],
		queryFn: () => api.issues.list(projectId),
		enabled: Boolean(projectId),
	});
	const sdlcQuery = useQuery<SdlcStats>({
		queryKey: ["project-sdlc", projectId],
		queryFn: () => api.projects.sdlcStats(projectId),
		enabled: Boolean(projectId),
	});
	const agentsQuery = useQuery<ProjectAgent[]>({
		queryKey: ["project-agents", projectId],
		queryFn: () => api.getProjectAgents(projectId),
		enabled: Boolean(projectId),
	});
	const rosterQuery = useQuery<RosterEntry[]>({
		queryKey: ["roster"],
		queryFn: () => api.agents.roster.list(),
	});
	const projectsQuery = useQuery<Project[]>({
		queryKey: ["projects"],
		queryFn: () => api.projects.list(),
	});
	const gitStatusQuery = useQuery<GitStatusResponse>({
		queryKey: ["project-git-status", projectId],
		queryFn: () => api.projectGit.status(projectId),
		enabled: Boolean(
			projectId && (activeTab === "overview" || activeTab === "git"),
		),
	});
	const gitLogQuery = useQuery<GitLogResponse>({
		queryKey: ["project-git-log", projectId],
		queryFn: () => api.projectGit.log(projectId),
		enabled: Boolean(projectId && activeTab === "git"),
	});
	const gitBranchesQuery = useQuery<GitBranchesResponse>({
		queryKey: ["project-git-branches", projectId],
		queryFn: () => api.projectGit.branches(projectId),
		enabled: Boolean(projectId && activeTab === "git"),
	});
	const secretsQuery = useQuery<ProjectSecret[]>({
		queryKey: ["project-secrets", projectId],
		queryFn: () => api.projectSecrets.list(projectId),
		enabled: Boolean(projectId && activeTab === "passwords"),
	});
	const contextQuery = useQuery<ProjectContextDocument>({
		queryKey: ["project-context", projectId],
		queryFn: () => api.projectContext.get(projectId),
		enabled: Boolean(projectId && activeTab === "context"),
	});

	const project = projectQuery.data;
	const issues = issuesQuery.data ?? [];
	const assignedAgents = agentsQuery.data ?? [];
	const roster = rosterQuery.data ?? [];
	const allProjects = projectsQuery.data ?? [];

	const issueStats = useMemo(() => {
		return issues.reduce(
			(acc, issue) => {
				acc.total += 1;
				if (issue.status === "done") acc.done += 1;
				if (issue.status === "in_progress") acc.inProgress += 1;
				if (issue.status === "todo" || issue.status === "backlog")
					acc.open += 1;
				return acc;
			},
			{ total: 0, done: 0, inProgress: 0, open: 0 },
		);
	}, [issues]);

	const assignedIds = useMemo(
		() => new Set(assignedAgents.map((agent) => agent.agentRosterId)),
		[assignedAgents],
	);
	const availableAgents = useMemo(
		() =>
			roster.filter(
				(agent) => agent.agent_id && !assignedIds.has(agent.agent_id),
			),
		[assignedIds, roster],
	);

	const assignMutation = useMutation({
		mutationFn: () => api.assignAgent(projectId, selectedAgentId),
		onSuccess: async () => {
			setSelectedAgentId("");
			setShowAssignModal(false);
			await qc.invalidateQueries({ queryKey: ["project-agents", projectId] });
		},
	});
	const leadershipMutation = useMutation({
		mutationFn: () => api.autoAssignLeadership(projectId),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["project-agents", projectId] });
		},
	});
	const unassignMutation = useMutation({
		mutationFn: (agentRosterId: string) =>
			api.unassignAgent(projectId, agentRosterId),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["project-agents", projectId] });
		},
	});
	const reassignMutation = useMutation({
		mutationFn: ({
			targetProjectId,
			agentRosterId,
			fromProjectId,
		}: {
			targetProjectId: string;
			agentRosterId: string;
			fromProjectId: string;
		}) => api.reassignAgent(targetProjectId, agentRosterId, fromProjectId),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["project-agents", projectId] });
		},
	});
	const refreshAgentMutation = useMutation({
		mutationFn: (agentRosterId: string) =>
			api.refreshAgentContext(agentRosterId),
		onSuccess: (result) => {
			setRefreshResult(result);
			setToastMessage({
				type: "success",
				text: `🧠 Context refreshed — pruned ${result.pruned} items, ${result.remaining} remaining`,
			});
		},
		onError: () =>
			setToastMessage({
				type: "error",
				text: "Failed to refresh agent context. Please try again.",
			}),
	});
	const refreshProjectMutation = useMutation({
		mutationFn: () => api.refreshProjectContext(projectId),
		onSuccess: (result) => {
			setRefreshResult(result);
			setToastMessage({
				type: "success",
				text: `🧠 All agents refreshed — pruned ${result.pruned} items, ${result.remaining} remaining`,
			});
		},
		onError: () =>
			setToastMessage({
				type: "error",
				text: "Failed to refresh project context. Please try again.",
			}),
	});
	const startBreakMutation = useMutation({
		mutationFn: () => api.startBreak(projectId),
		onSuccess: async (result) => {
			setBreakResult(result);
			setToastMessage({
				type: "success",
				text: `☕ Break started for ${result.agents.length} agent${result.agents.length > 1 ? "s" : ""} — 2 minutes of fun chat!`,
			});
			await qc.invalidateQueries({ queryKey: ["project-agents", projectId] });
		},
		onError: () =>
			setToastMessage({
				type: "error",
				text: "Failed to start break. Are there agents assigned to this project?",
			}),
	});
	const addSecretMutation = useMutation({
		mutationFn: () =>
			api.projectSecrets.create(projectId, secretKey, secretValue),
		onSuccess: async () => {
			setSecretKey("");
			setSecretValue("");
			await qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
		},
	});
	const removeSecretMutation = useMutation({
		mutationFn: (key: string) => api.projectSecrets.remove(projectId, key),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
		},
	});
	const saveContextMutation = useMutation({
		mutationFn: () => api.projectContext.update(projectId, contextDraft),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["project-context", projectId] });
		},
	});

	useEffect(() => {
		if (contextQuery.data) {
			setContextDraft(contextQuery.data.content);
		}
	}, [contextQuery.data]);

	if (!projectId) {
		return (
			<EmptyState
				icon={<Bot className="h-8 w-8" />}
				title="Project not found"
			/>
		);
	}

	if (projectQuery.isLoading) {
		return <div className="glass h-72 animate-pulse rounded-xl" />;
	}

	if (!project) {
		return (
			<EmptyState
				icon={<Bot className="h-8 w-8" />}
				title="Project not found"
				description="This project may have been removed or moved to another company."
			/>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title={project.name}
				subtitle={project.description ?? "Project workspace intelligence"}
				breadcrumbs={[
					{ label: "Projects", href: "/projects" },
					{ label: project.name },
				]}
				actions={
					<>
						<Button
							variant="secondary"
							onClick={() => refreshProjectMutation.mutate()}
							loading={refreshProjectMutation.isPending}
							icon={<RefreshCw className="h-4 w-4" />}
						>
							Refresh project context
						</Button>
						<Button
							variant="secondary"
							onClick={() => startBreakMutation.mutate()}
							loading={startBreakMutation.isPending}
							disabled={!!breakResult}
							icon={<Coffee className="h-4 w-4" />}
						>
							{breakResult
								? `On break (${Math.floor(breakCountdown / 60)}:${String(breakCountdown % 60).padStart(2, "0")})`
								: "Take a break"}
						</Button>
					</>
				}
			/>

			<div className="flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
							activeTab === tab.id
								? "bg-setra-600 text-white"
								: "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
						)}
					>
						<tab.icon className="h-4 w-4" />
						{tab.label}
					</button>
				))}
			</div>

			{/* Toast notification */}
			{toastMessage && (
				<div
					className={cn(
						"animate-slide-in-up flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
						toastMessage.type === "success" &&
							"border-accent-green/30 bg-accent-green/10 text-accent-green",
						toastMessage.type === "error" &&
							"border-red-500/30 bg-red-500/10 text-red-400",
						toastMessage.type === "info" &&
							"border-blue-500/30 bg-blue-500/10 text-blue-300",
					)}
				>
					<span className="flex-1">{toastMessage.text}</span>
					<button
						type="button"
						onClick={() => setToastMessage(null)}
						className="ml-2 text-xs opacity-60 hover:opacity-100"
					>
						✕
					</button>
				</div>
			)}

			{/* Break countdown card */}
			{breakResult && (
				<div className="animate-slide-in-up flex items-center gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
					<Coffee className="h-6 w-6 text-amber-400 animate-pulse" />
					<div className="flex-1">
						<div className="text-sm font-semibold text-amber-200">
							☕ Agents are on a break
						</div>
						<div className="mt-0.5 text-xs text-amber-300/70">
							{breakResult.agents.length} agent
							{breakResult.agents.length > 1 ? "s" : ""} chatting in #break-room
							• Back to work in{" "}
							<span className="font-mono font-bold text-amber-200">
								{Math.floor(breakCountdown / 60)}:
								{String(breakCountdown % 60).padStart(2, "0")}
							</span>
						</div>
					</div>
					<div className="h-10 w-10 rounded-full border-2 border-amber-500/40 flex items-center justify-center">
						<span className="font-mono text-lg font-bold text-amber-300">
							{Math.floor(breakCountdown / 60)}:
							{String(breakCountdown % 60).padStart(2, "0")}
						</span>
					</div>
				</div>
			)}

			{activeTab === "overview" ? (
				<div className="space-y-6">
					<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
						<ProjectMetric
							label="Total issues"
							value={String(issueStats.total)}
							subtitle={`${issueStats.open} open`}
						/>
						<ProjectMetric
							label="In progress"
							value={String(issueStats.inProgress)}
							subtitle={`${issueStats.done} done`}
						/>
						<ProjectMetric
							label="Cost summary"
							value={formatCost(project.totalCostUsd ?? 0)}
							subtitle={`Plan: ${project.planStatus ?? "none"}`}
						/>
						<ProjectMetric
							label="Workspace"
							value={project.workspacePath ? "Configured" : "Pending"}
							subtitle={project.workspacePath ?? "No local workspace yet"}
						/>
					</div>
					<div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
						<Card title="Project overview">
							<div className="space-y-3 text-sm text-zinc-300">
								<div>
									<div className="text-xs uppercase tracking-wide text-zinc-500">
										Repository
									</div>
									<div className="mt-1 break-all">
										{project.repoUrl || "Not linked yet"}
									</div>
								</div>
								<div>
									<div className="text-xs uppercase tracking-wide text-zinc-500">
										Workspace path
									</div>
									<div className="mt-1 break-all">
										{project.workspacePath || "No workspace configured"}
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="info">
										Plan {project.planStatus ?? "none"}
									</Badge>
									<Badge
										variant={
											gitStatusQuery.data &&
											gitStatusQuery.data.files.length > 0
												? "warning"
												: "success"
										}
									>
										{gitStatusQuery.data?.files.length ?? 0} git change
										{(gitStatusQuery.data?.files.length ?? 0) === 1 ? "" : "s"}
									</Badge>
									<Badge variant="default">
										Default branch {project.defaultBranch ?? "main"}
									</Badge>
								</div>
								{sdlcQuery.data ? (
									<div className="grid gap-2 sm:grid-cols-3">
										<div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
											<div className="text-xs text-zinc-500">
												Merged cycle time
											</div>
											<div className="mt-1 text-lg font-semibold text-white">
												{sdlcQuery.data.cycle_time_median_hours == null
													? "—"
													: `${sdlcQuery.data.cycle_time_median_hours.toFixed(1)}h`}
											</div>
										</div>
										<div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
											<div className="text-xs text-zinc-500">
												Last 24h activity
											</div>
											<div className="mt-1 text-lg font-semibold text-white">
												{sdlcQuery.data.activity_last_24h}
											</div>
										</div>
										<div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
											<div className="text-xs text-zinc-500">
												Verified issues
											</div>
											<div className="mt-1 text-lg font-semibold text-white">
												{sdlcQuery.data.counts.verified}
											</div>
										</div>
									</div>
								) : null}
							</div>
						</Card>
						<Card
							title="Assigned agents"
							subtitle="Leadership spans every project automatically."
						>
							{assignedAgents.length > 0 ? (
								<>
									<div className="flex -space-x-2">
										{assignedAgents.slice(0, 6).map((agent) => (
											<AgentAvatar key={agent.id} agent={agent} />
										))}
									</div>
									<div className="mt-4 space-y-2">
										{assignedAgents.map((agent) => (
											<div
												key={agent.id}
												className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
											>
												<div className="min-w-0">
													<div className="truncate font-medium text-white">
														{agent.displayName}
													</div>
													<div className="truncate text-xs text-zinc-400">
														@{agent.slug} · {agent.agentRole}
													</div>
												</div>
												<div className="flex items-center gap-2">
													<Badge variant={statusVariant(agent.status)}>
														{agent.status.replaceAll("_", " ")}
													</Badge>
													<Badge
														variant={
															agent.role === "lead" ? "warning" : "default"
														}
													>
														{agent.role}
													</Badge>
												</div>
											</div>
										))}
									</div>
								</>
							) : (
								<EmptyState
									title="No agents assigned yet"
									description="Assign teammates in the Agents tab."
								/>
							)}
						</Card>
					</div>
				</div>
			) : null}

			{activeTab === "issues" ? <IssuesPage /> : null}

			{activeTab === "agents" ? (
				<div className="space-y-6">
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							onClick={() => setShowAssignModal(true)}
							icon={<Plus className="h-4 w-4" />}
						>
							Assign agent
						</Button>
						<Button
							variant="secondary"
							onClick={() => leadershipMutation.mutate()}
							loading={leadershipMutation.isPending}
						>
							Auto-assign leadership
						</Button>
						<Button
							variant="secondary"
							onClick={() => refreshProjectMutation.mutate()}
							loading={refreshProjectMutation.isPending}
							icon={<RefreshCw className="h-4 w-4" />}
						>
							Refresh all context
						</Button>
					</div>
					<Card
						title="Project team"
						subtitle="Move agents between projects and refresh their context."
					>
						<div className="space-y-3">
							{assignedAgents.map((agent) => {
								const otherProjects = allProjects.filter(
									(entry) => entry.id !== projectId,
								);
								return (
									<div
										key={agent.id}
										className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
									>
										<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
											<div className="flex items-center gap-3 min-w-0">
												<AgentAvatar agent={agent} />
												<div className="min-w-0">
													<div className="truncate text-base font-semibold text-white">
														{agent.displayName}
													</div>
													<div className="truncate text-sm text-zinc-400">
														@{agent.slug} · {agent.adapterType ?? "auto"} ·{" "}
														{agent.modelId ?? "auto"}
													</div>
													<div className="mt-2 flex flex-wrap gap-2">
														<Badge
															variant={
																agent.role === "lead" ? "warning" : "default"
															}
														>
															{agent.role}
														</Badge>
														<Badge variant={statusVariant(agent.status)}>
															{agent.status.replaceAll("_", " ")}
														</Badge>
														{agent.lastRefreshedAt ? (
															<Badge variant="info">
																Refreshed {timeAgo(agent.lastRefreshedAt)}
															</Badge>
														) : null}
													</div>
												</div>
											</div>
											<div className="flex flex-wrap items-center gap-2">
												<Button
													variant="secondary"
													size="sm"
													onClick={() =>
														refreshAgentMutation.mutate(agent.agentRosterId)
													}
													loading={
														refreshAgentMutation.isPending &&
														refreshAgentMutation.variables ===
															agent.agentRosterId
													}
												>
													Refresh context
												</Button>
												{agent.role !== "lead" && otherProjects.length > 0 ? (
													<div className="flex gap-2">
														{otherProjects.slice(0, 2).map((entry) => (
															<Button
																key={entry.id}
																variant="ghost"
																size="sm"
																onClick={() =>
																	reassignMutation.mutate({
																		targetProjectId: entry.id,
																		agentRosterId: agent.agentRosterId,
																		fromProjectId: projectId,
																	})
																}
															>
																Move to {entry.name}
															</Button>
														))}
													</div>
												) : null}
												{agent.role !== "lead" ? (
													<Button
														variant="danger"
														size="sm"
														onClick={() =>
															unassignMutation.mutate(agent.agentRosterId)
														}
														loading={
															unassignMutation.isPending &&
															unassignMutation.variables === agent.agentRosterId
														}
													>
														Unassign
													</Button>
												) : null}
											</div>
										</div>
									</div>
								);
							})}
							{assignedAgents.length === 0 ? (
								<EmptyState
									title="No assignments yet"
									description="Use Assign Agent to staff this project."
								/>
							) : null}
						</div>
					</Card>
				</div>
			) : null}

			{activeTab === "git" ? (
				<div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
					<Card
						title="Git status"
						subtitle={
							project.repoUrl ?? "Repository status for this workspace."
						}
					>
						{gitStatusQuery.isLoading ? (
							<div className="flex items-center gap-2 text-sm text-zinc-400">
								<Loader2 className="h-4 w-4 animate-spin" /> Loading git status…
							</div>
						) : (
							<div className="space-y-3">
								<div className="flex flex-wrap gap-2">
									<Badge
										variant={
											(gitStatusQuery.data?.files.length ?? 0) > 0
												? "warning"
												: "success"
										}
									>
										{gitStatusQuery.data?.files.length ?? 0} changed files
									</Badge>
									<Badge variant="default">
										Branch{" "}
										{gitBranchesQuery.data?.branches.find(
											(branch) => branch.current,
										)?.name ??
											project.defaultBranch ??
											"main"}
									</Badge>
								</div>
								<div className="space-y-2">
									{gitStatusQuery.data?.files.map((file) => (
										<div
											key={file.path}
											className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm"
										>
											<span className="truncate font-mono text-zinc-200">
												{file.path}
											</span>
											<Badge variant={file.staged ? "info" : "default"}>
												{file.status}
											</Badge>
										</div>
									))}
									{gitStatusQuery.data &&
									gitStatusQuery.data.files.length === 0 ? (
										<EmptyState
											title="Workspace is clean"
											description="No staged or unstaged changes."
										/>
									) : null}
								</div>
							</div>
						)}
					</Card>
					<Card title="Recent commits & branches">
						<div className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-wide text-zinc-500">
									Branches
								</div>
								{gitBranchesQuery.data?.branches.map((branch) => (
									<div
										key={branch.name}
										className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200"
									>
										<GitBranch className="h-4 w-4 text-zinc-500" />
										<span className="truncate">{branch.name}</span>
										{branch.current ? (
											<Badge variant="success">Current</Badge>
										) : null}
									</div>
								))}
							</div>
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-wide text-zinc-500">
									Commits
								</div>
								{gitLogQuery.data?.commits.map((commit) => (
									<div
										key={commit.sha}
										className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3"
									>
										<div className="flex items-center justify-between gap-3">
											<div className="font-medium text-white">
												{commit.message}
											</div>
											<div className="text-xs text-zinc-500">
												{commit.shortSha}
											</div>
										</div>
										<div className="mt-1 text-xs text-zinc-400">
											{commit.author} • {timeAgo(commit.date)}
										</div>
									</div>
								))}
							</div>
						</div>
					</Card>
				</div>
			) : null}

			{activeTab === "passwords" ? (
				<div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
					<Card
						title="Add project password"
						subtitle="Store per-project secrets for the assigned team."
					>
						<div className="space-y-3">
							<input
								value={secretKey}
								onChange={(event) => setSecretKey(event.target.value)}
								placeholder="API_KEY"
								className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
							/>
							<textarea
								value={secretValue}
								onChange={(event) => setSecretValue(event.target.value)}
								rows={5}
								placeholder="secret value"
								className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none"
							/>
							<Button
								onClick={() => addSecretMutation.mutate()}
								disabled={!secretKey.trim() || !secretValue}
								loading={addSecretMutation.isPending}
							>
								Save password
							</Button>
						</div>
					</Card>
					<Card title="Project Passwords">
						<div className="space-y-2">
							{secretsQuery.data?.map((secret) => (
								<div
									key={secret.id}
									className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-3"
								>
									<div className="min-w-0">
										<div className="font-medium text-white">{secret.key}</div>
										<div className="text-xs text-zinc-400">
											{secret.maskedValue}
										</div>
									</div>
									<Button
										variant="danger"
										size="sm"
										onClick={() => removeSecretMutation.mutate(secret.key)}
										loading={
											removeSecretMutation.isPending &&
											removeSecretMutation.variables === secret.key
										}
									>
										Delete
									</Button>
								</div>
							))}
							{secretsQuery.data && secretsQuery.data.length === 0 ? (
								<EmptyState
									title="No passwords stored"
									description="Save database passwords, API keys, and other secrets here."
								/>
							) : null}
						</div>
					</Card>
				</div>
			) : null}

			{activeTab === "terminal" ? (
				<Card title="Terminal">
					<EmptyState
						icon={<Monitor className="h-8 w-8" />}
						title="Terminal will be available in desktop app"
						description="This browser view keeps the project detail surface focused on project intelligence for now."
					/>
				</Card>
			) : null}

			{activeTab === "context" ? (
				<Card
					title="CONTEXT.md"
					subtitle="Shared working context for every assigned agent."
				>
					<div className="space-y-3">
						<textarea
							value={contextDraft}
							onChange={(event) => setContextDraft(event.target.value)}
							rows={18}
							className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-sm text-zinc-100 outline-none"
						/>
						<div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
							<span>Last updated {timeAgo(contextQuery.data?.updatedAt)}</span>
							<Button
								onClick={() => saveContextMutation.mutate()}
								loading={saveContextMutation.isPending}
							>
								Save context
							</Button>
						</div>
					</div>
				</Card>
			) : null}

			<Modal
				open={showAssignModal}
				onClose={() => setShowAssignModal(false)}
				title="Assign agent to project"
				actions={
					<>
						<Button variant="ghost" onClick={() => setShowAssignModal(false)}>
							Cancel
						</Button>
						<Button
							onClick={() => assignMutation.mutate()}
							disabled={!selectedAgentId}
							loading={assignMutation.isPending}
						>
							Assign
						</Button>
					</>
				}
			>
				<div className="space-y-2">
					{availableAgents.map((agent) => (
						<button
							key={agent.agent_id}
							type="button"
							onClick={() => setSelectedAgentId(agent.agent_id ?? "")}
							className={cn(
								"flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors",
								selectedAgentId === agent.agent_id
									? "border-setra-500 bg-setra-500/10"
									: "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700",
							)}
						>
							<div>
								<div className="font-medium text-white">
									{agent.display_name}
								</div>
								<div className="text-xs text-zinc-400">
									{agent.template_name} · {agent.runtime_status ?? "idle"}
								</div>
							</div>
							{agent.agent_id === selectedAgentId ? (
								<Badge variant="info">Selected</Badge>
							) : null}
						</button>
					))}
					{availableAgents.length === 0 ? (
						<EmptyState
							title="Everyone is already assigned"
							description="Hire more agents or reassign them from other projects."
						/>
					) : null}
				</div>
			</Modal>
		</div>
	);
}
