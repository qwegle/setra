import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Bot,
	CheckCircle2,
	ChevronRight,
	Circle,
	Coffee,
	Database,
	ExternalLink,
	FolderGit2,
	GitBranch,
	GitCommit,
	History,
	KeyRound,
	ListChecks,
	Loader2,
	MessageSquare,
	Monitor,
	Play,
	Plus,
	RefreshCw,
	RotateCcw,
	Send,
	Shield,
	Square,
	TerminalSquare,
	Users,
	XCircle,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
	type ChecklistItem,
	type CollabMessage,
	type ContextRefreshResult,
	type DatabaseConnection,
	type GitBranchesResponse,
	type GitLogResponse,
	type GitStatusResponse,
	type Project,
	type ProjectAgent,
	type ProjectBreakResponse,
	type ProjectChannel,
	type ProjectContextDocument,
	type ProjectSecret,
	type RosterEntry,
	type RunStatus,
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
	| "checkpoints"
	| "run"
	| "database"
	| "passwords"
	| "production"
	| "discussion"
	| "terminal"
	| "context";

const TABS: Array<{ id: TabId; label: string; icon: typeof Users }> = [
	{ id: "overview", label: "Overview", icon: ListChecks },
	{ id: "issues", label: "Issues", icon: ListChecks },
	{ id: "agents", label: "Agents", icon: Users },
	{ id: "git", label: "Git", icon: FolderGit2 },
	{ id: "checkpoints", label: "Checkpoints", icon: History },
	{ id: "run", label: "Run", icon: Play },
	{ id: "database", label: "Database", icon: Database },
	{ id: "passwords", label: "Passwords", icon: KeyRound },
	{ id: "production", label: "Production", icon: Shield },
	{ id: "discussion", label: "Discussion", icon: MessageSquare },
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
		"bg-[#7a5421]",
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
}: { label: string; value: string; subtitle?: string }) {
	return (
		<div className="glass rounded-xl px-4 py-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-2xl font-semibold text-[#2b2418]">{value}</div>
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
				"flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-[#2b2418] ring-2 ring-zinc-950",
				avatarTone(agent.slug),
			)}
		>
			{initials(agent.displayName)}
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

	// DB form state
	const [dbMode, setDbMode] = useState<"string" | "manual">("string");
	const [dbConnString, setDbConnString] = useState("");
	const [dbName, setDbName] = useState("");
	const [showDbModal, setShowDbModal] = useState(false);

	// Revert confirm state
	const [revertSha, setRevertSha] = useState<string | null>(null);
	const [revertHard, setRevertHard] = useState(false);

	// Discussion
	const [discussionMsg, setDiscussionMsg] = useState("");
	const chatEndRef = useRef<HTMLDivElement>(null);

	// Toast auto-dismiss
	useEffect(() => {
		if (!toastMessage) return;
		const t = setTimeout(() => setToastMessage(null), 5000);
		return () => clearTimeout(t);
	}, [toastMessage]);

	// Break countdown
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

	// ── Queries ──────────────────────────────────────────────────────────────
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
	const allProjectsQuery = useQuery<Project[]>({
		queryKey: ["projects"],
		queryFn: () => api.projects.list(),
	});
	const gitStatusQuery = useQuery<GitStatusResponse>({
		queryKey: ["project-git-status", projectId],
		queryFn: () => api.projectGit.status(projectId),
		enabled: Boolean(
			projectId &&
				(activeTab === "overview" ||
					activeTab === "git" ||
					activeTab === "checkpoints"),
		),
	});
	const gitRemoteQuery = useQuery<{ remoteUrl: string | null; branch: string }>(
		{
			queryKey: ["project-git-remote", projectId],
			queryFn: () => api.projectGit.remote(projectId),
			enabled: Boolean(
				projectId && (activeTab === "overview" || activeTab === "git"),
			),
		},
	);
	const gitLogQuery = useQuery<GitLogResponse>({
		queryKey: ["project-git-log", projectId],
		queryFn: () => api.projectGit.log(projectId),
		enabled: Boolean(
			projectId && (activeTab === "git" || activeTab === "checkpoints"),
		),
	});
	const gitBranchesQuery = useQuery<GitBranchesResponse>({
		queryKey: ["project-git-branches", projectId],
		queryFn: () => api.projectGit.branches(projectId),
		enabled: Boolean(
			projectId && (activeTab === "git" || activeTab === "checkpoints"),
		),
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
	const dbQuery = useQuery<DatabaseConnection[]>({
		queryKey: ["project-db", projectId],
		queryFn: () => api.projectDb.list(projectId),
		enabled: Boolean(projectId && activeTab === "database"),
	});
	const runQuery = useQuery<RunStatus>({
		queryKey: ["project-run", projectId],
		queryFn: () => api.projectRun.status(projectId),
		enabled: Boolean(projectId && activeTab === "run"),
		refetchInterval: activeTab === "run" ? 2000 : false,
	});
	const productionQuery = useQuery<ChecklistItem[]>({
		queryKey: ["project-production", projectId],
		queryFn: () => api.projectProduction.get(projectId),
		enabled: Boolean(projectId && activeTab === "production"),
	});
	const channelQuery = useQuery<ProjectChannel | null>({
		queryKey: ["project-channel", projectId],
		queryFn: () => api.projectDiscussion.channel(projectId),
		enabled: Boolean(projectId && activeTab === "discussion"),
	});
	const messagesQuery = useQuery<CollabMessage[]>({
		queryKey: ["project-messages", channelQuery.data?.slug],
		queryFn: () => api.projectDiscussion.messages(channelQuery.data!.slug),
		enabled: Boolean(channelQuery.data?.slug && activeTab === "discussion"),
		refetchInterval: activeTab === "discussion" ? 5000 : false,
	});

	const project = projectQuery.data;
	const issues = issuesQuery.data ?? [];
	const assignedAgents = agentsQuery.data ?? [];
	const roster = rosterQuery.data ?? [];
	const allProjects = allProjectsQuery.data ?? [];

	// Scroll discussion to bottom
	useEffect(() => {
		chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messagesQuery.data]);
	useEffect(() => {
		if (contextQuery.data) setContextDraft(contextQuery.data.content);
	}, [contextQuery.data]);

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
		() => new Set(assignedAgents.map((a) => a.agentRosterId)),
		[assignedAgents],
	);
	const availableAgents = useMemo(
		() => roster.filter((a) => a.agent_id && !assignedIds.has(a.agent_id)),
		[assignedIds, roster],
	);

	const productionAllPass = useMemo(() => {
		const list = productionQuery.data ?? [];
		return list.length > 0 && list.every((item) => item.status === "pass");
	}, [productionQuery.data]);

	// ── Mutations ─────────────────────────────────────────────────────────────
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
		mutationFn: (id: string) => api.unassignAgent(projectId, id),
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
		mutationFn: (id: string) => api.refreshAgentContext(id),
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

	const revertMutation = useMutation({
		mutationFn: ({ sha, hard }: { sha: string; hard: boolean }) =>
			api.projectGit.revert(projectId, sha, hard),
		onSuccess: (result) => {
			setRevertSha(null);
			setToastMessage({
				type: "success",
				text: `✅ Reverted to checkpoint ${result.head.slice(0, 7)}`,
			});
			qc.invalidateQueries({ queryKey: ["project-git-log", projectId] });
			qc.invalidateQueries({ queryKey: ["project-git-status", projectId] });
		},
		onError: (e) => {
			setRevertSha(null);
			setToastMessage({
				type: "error",
				text: `Revert failed: ${e instanceof Error ? e.message : "unknown error"}`,
			});
		},
	});

	const dbConnectMutation = useMutation({
		mutationFn: () => {
			const data: Parameters<typeof api.projectDb.connect>[1] = {};
			if (dbMode === "string" && dbConnString) data.connectionString = dbConnString;
			if (dbName) data.name = dbName;
			return api.projectDb.connect(projectId, data);
		},
		onSuccess: async () => {
			setShowDbModal(false);
			setDbConnString("");
			setDbName("");
			await qc.invalidateQueries({ queryKey: ["project-db", projectId] });
			setToastMessage({
				type: "success",
				text: "✅ Database connected successfully",
			});
		},
		onError: () =>
			setToastMessage({
				type: "error",
				text: "Failed to save database connection.",
			}),
	});
	const dbRemoveMutation = useMutation({
		mutationFn: (connId: string) => api.projectDb.remove(projectId, connId),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ["project-db", projectId] });
		},
	});

	const runStartMutation = useMutation({
		mutationFn: () => api.projectRun.start(projectId),
		onSuccess: (r) => {
			setToastMessage({
				type: "success",
				text: `🚀 Project started: ${r.command}`,
			});
			qc.invalidateQueries({ queryKey: ["project-run", projectId] });
		},
		onError: (e) =>
			setToastMessage({
				type: "error",
				text: e instanceof Error ? e.message : "Failed to start project",
			}),
	});
	const runStopMutation = useMutation({
		mutationFn: () => api.projectRun.stop(projectId),
		onSuccess: () => {
			setToastMessage({ type: "info", text: "Project stopped." });
			qc.invalidateQueries({ queryKey: ["project-run", projectId] });
		},
	});

	const generateChecklistMutation = useMutation({
		mutationFn: () => api.projectProduction.generate(projectId),
		onSuccess: async () => {
			await qc.invalidateQueries({
				queryKey: ["project-production", projectId],
			});
			setToastMessage({
				type: "success",
				text: "✅ Production checklist generated",
			});
		},
	});
	const updateChecklistMutation = useMutation({
		mutationFn: ({
			itemId,
			status,
		}: { itemId: string; status: "pending" | "pass" | "fail" }) =>
			api.projectProduction.updateItem(projectId, itemId, status),
		onSuccess: async () => {
			await qc.invalidateQueries({
				queryKey: ["project-production", projectId],
			});
		},
	});

	const sendMessageMutation = useMutation({
		mutationFn: () =>
			api.projectDiscussion.send(channelQuery.data!.slug, discussionMsg),
		onSuccess: async () => {
			setDiscussionMsg("");
			await qc.invalidateQueries({
				queryKey: ["project-messages", channelQuery.data?.slug],
			});
		},
	});

	// ── Guard ─────────────────────────────────────────────────────────────────
	if (!projectId)
		return (
			<EmptyState
				icon={<Bot className="h-8 w-8" />}
				title="Project not found"
			/>
		);
	if (projectQuery.isLoading)
		return <div className="glass h-72 animate-pulse rounded-xl" />;
	if (!project)
		return (
			<EmptyState
				icon={<Bot className="h-8 w-8" />}
				title="Project not found"
				description="This project may have been removed."
			/>
		);

	const remoteUrl = gitRemoteQuery.data?.remoteUrl ?? project.repoUrl;
	const currentBranch =
		gitRemoteQuery.data?.branch ??
		gitBranchesQuery.data?.branches.find((b) => b.current)?.name ??
		project.defaultBranch ??
		"main";

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
							Refresh context
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

			{/* Tab bar */}
			<div className="flex flex-wrap gap-1.5 rounded-xl border border-[#e5d6b8] bg-[#faf3e3]/70 p-2">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id)}
						className={cn(
							"inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors",
							activeTab === tab.id
								? "bg-setra-600 text-[#2b2418]"
								: "text-[#6f6044] hover:bg-white hover:text-[#2b2418]",
						)}
					>
						<tab.icon className="h-3.5 w-3.5" />
						{tab.label}
						{tab.id === "production" && productionAllPass && (
							<span className="ml-1 h-2 w-2 rounded-full bg-emerald-400" />
						)}
					</button>
				))}
			</div>

			{/* Toast */}
			{toastMessage && (
				<div
					className={cn(
						"flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg",
						toastMessage.type === "success" &&
							"border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
						toastMessage.type === "error" &&
							"border-red-500/30 bg-red-500/10 text-red-400",
						toastMessage.type === "info" &&
							"border-[#c9a25f]/30 bg-[#7a5421]/10 text-[#7a5421]",
					)}
				>
					<span className="flex-1">{toastMessage.text}</span>
					<button
						type="button"
						onClick={() => setToastMessage(null)}
						className="opacity-60 hover:opacity-100"
					>
						✕
					</button>
				</div>
			)}

			{/* Break countdown */}
			{breakResult && (
				<div className="flex items-center gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
					<Coffee className="h-6 w-6 animate-pulse text-amber-400" />
					<div className="flex-1">
						<div className="text-sm font-semibold text-amber-200">
							☕ Agents are on a break
						</div>
						<div className="mt-0.5 text-xs text-amber-300/70">
							{breakResult.agents.length} agent
							{breakResult.agents.length > 1 ? "s" : ""} chatting in #break-room
							• Back in{" "}
							<span className="font-mono font-bold text-amber-200">
								{Math.floor(breakCountdown / 60)}:
								{String(breakCountdown % 60).padStart(2, "0")}
							</span>
						</div>
					</div>
				</div>
			)}

			{/* ── Overview ── */}
			{activeTab === "overview" && (
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
							label="Cost"
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
							<div className="space-y-3 text-sm text-[#4b3f2d]">
								<div>
									<div className="text-xs uppercase tracking-wide text-[#8a7a5c]">
										Repository
									</div>
									<div className="mt-1 flex items-center gap-2 break-all">
										{remoteUrl ? (
											<>
												<span>{remoteUrl}</span>
												<a
													href={
														remoteUrl.startsWith("http")
															? remoteUrl
															: `https://github.com`
													}
													target="_blank"
													rel="noreferrer"
													className="text-[#8a7a5c] hover:text-[#4b3f2d]"
												>
													<ExternalLink className="h-3.5 w-3.5" />
												</a>
											</>
										) : project.gitInitialized ? (
											<Badge variant="info">Local git (no remote)</Badge>
										) : (
											<span className="text-[#8a7a5c]">Not linked yet</span>
										)}
									</div>
								</div>
								<div>
									<div className="text-xs uppercase tracking-wide text-[#8a7a5c]">
										Workspace path
									</div>
									<div className="mt-1 break-all font-mono text-xs">
										{project.workspacePath || "—"}
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Badge variant="info">
										Plan {project.planStatus ?? "none"}
									</Badge>
									<Badge
										variant={
											(gitStatusQuery.data?.files.length ?? 0) > 0
												? "warning"
												: "success"
										}
									>
										{gitStatusQuery.data?.files.length ?? 0} git changes
									</Badge>
									<Badge variant="default">
										<GitBranch className="mr-1 h-3 w-3 inline" />
										{currentBranch}
									</Badge>
								</div>
								{sdlcQuery.data && (
									<div className="grid gap-2 sm:grid-cols-3">
										<div className="rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2">
											<div className="text-xs text-[#8a7a5c]">Cycle time</div>
											<div className="mt-1 text-lg font-semibold text-[#2b2418]">
												{sdlcQuery.data.cycle_time_median_hours == null
													? "—"
													: `${sdlcQuery.data.cycle_time_median_hours.toFixed(1)}h`}
											</div>
										</div>
										<div className="rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2">
											<div className="text-xs text-[#8a7a5c]">24h activity</div>
											<div className="mt-1 text-lg font-semibold text-[#2b2418]">
												{sdlcQuery.data.activity_last_24h}
											</div>
										</div>
										<div className="rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2">
											<div className="text-xs text-[#8a7a5c]">Verified</div>
											<div className="mt-1 text-lg font-semibold text-[#2b2418]">
												{sdlcQuery.data.counts.verified}
											</div>
										</div>
									</div>
								)}
							</div>
						</Card>
						<Card
							title="Assigned agents"
							subtitle="Leadership spans every project automatically."
						>
							{assignedAgents.length > 0 ? (
								<>
									<div className="flex -space-x-2">
										{assignedAgents.slice(0, 6).map((a) => (
											<AgentAvatar key={a.id} agent={a} />
										))}
									</div>
									<div className="mt-4 space-y-2">
										{assignedAgents.map((a) => (
											<div
												key={a.id}
												className="flex items-center justify-between gap-3 rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2"
											>
												<div className="min-w-0">
													<div className="truncate font-medium text-[#2b2418]">
														{a.displayName}
													</div>
													<div className="truncate text-xs text-[#6f6044]">
														@{a.slug} · {a.agentRole}
													</div>
												</div>
												<div className="flex gap-2">
													<Badge variant={statusVariant(a.status)}>
														{a.status.replaceAll("_", " ")}
													</Badge>
													<Badge
														variant={a.role === "lead" ? "warning" : "default"}
													>
														{a.role}
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
			)}

			{/* ── Issues ── */}
			{activeTab === "issues" && <IssuesPage />}

			{/* ── Agents ── */}
			{activeTab === "agents" && (
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
								const others = allProjects.filter((p) => p.id !== projectId);
								return (
									<div
										key={agent.id}
										className="rounded-xl border border-[#e5d6b8] bg-[#faf3e3]/60 p-4"
									>
										<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
											<div className="flex min-w-0 items-center gap-3">
												<AgentAvatar agent={agent} />
												<div className="min-w-0">
													<div className="truncate text-base font-semibold text-[#2b2418]">
														{agent.displayName}
													</div>
													<div className="truncate text-sm text-[#6f6044]">
														@{agent.slug} · {agent.adapterType && agent.adapterType !== "auto" ? agent.adapterType : "codex"} · {agent.modelId && agent.modelId !== "auto" ? agent.modelId : agent.adapterType === "claude" ? "claude (auto)" : "gpt-5.5 (auto)"}
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
														{agent.lastRefreshedAt && (
															<Badge variant="info">
																Refreshed {timeAgo(agent.lastRefreshedAt)}
															</Badge>
														)}
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
												{agent.role !== "lead" &&
													others.length > 0 &&
													others.slice(0, 2).map((p) => (
														<Button
															key={p.id}
															variant="ghost"
															size="sm"
															onClick={() =>
																reassignMutation.mutate({
																	targetProjectId: p.id,
																	agentRosterId: agent.agentRosterId,
																	fromProjectId: projectId,
																})
															}
														>
															Move to {p.name}
														</Button>
													))}
												{agent.role !== "lead" && (
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
												)}
											</div>
										</div>
									</div>
								);
							})}
							{assignedAgents.length === 0 && (
								<EmptyState
									title="No assignments yet"
									description="Use Assign Agent to staff this project."
								/>
							)}
						</div>
					</Card>
				</div>
			)}

			{/* ── Git ── */}
			{activeTab === "git" && (
				<div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
					<Card
						title="Git status"
						subtitle={
							remoteUrl ??
							(project.gitInitialized ? "Local git repository" : "No git")
						}
					>
						{gitStatusQuery.isLoading ? (
							<div className="flex items-center gap-2 text-sm text-[#6f6044]">
								<Loader2 className="h-4 w-4 animate-spin" /> Loading…
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
										<GitBranch className="mr-1 h-3 w-3 inline" />
										{currentBranch}
									</Badge>
									{remoteUrl && (
										<a
											href={remoteUrl.startsWith("http") ? remoteUrl : "#"}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-1 text-xs text-[#6f6044] hover:text-[#3b3224]"
										>
											<ExternalLink className="h-3 w-3" /> Remote
										</a>
									)}
								</div>
								<div className="space-y-2">
									{gitStatusQuery.data?.files.map((f) => (
										<div
											key={f.path}
											className="flex items-center justify-between rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2 text-sm"
										>
											<span className="truncate font-mono text-[#3b3224]">
												{f.path}
											</span>
											<Badge variant={f.staged ? "info" : "default"}>
												{f.status}
											</Badge>
										</div>
									))}
									{gitStatusQuery.data?.files.length === 0 && (
										<EmptyState
											title="Workspace is clean"
											description="No staged or unstaged changes."
										/>
									)}
								</div>
							</div>
						)}
					</Card>
					<Card title="Branches & recent commits">
						<div className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-wide text-[#8a7a5c]">
									Branches
								</div>
								{gitBranchesQuery.data?.branches.map((b) => (
									<div
										key={b.name}
										className="flex items-center gap-2 rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2 text-sm text-[#3b3224]"
									>
										<GitBranch className="h-4 w-4 text-[#8a7a5c]" />
										<span className="truncate">{b.name}</span>
										{b.current && <Badge variant="success">Current</Badge>}
									</div>
								))}
							</div>
							<div className="space-y-2">
								<div className="text-xs uppercase tracking-wide text-[#8a7a5c]">
									Recent commits
								</div>
								{gitLogQuery.data?.commits.slice(0, 8).map((commit) => (
									<div
										key={commit.sha}
										className="rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-2"
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0 text-sm font-medium text-[#2b2418] truncate">
												{commit.message}
											</div>
											<span className="shrink-0 font-mono text-xs text-[#8a7a5c]">
												{commit.shortSha}
											</span>
										</div>
										<div className="mt-1 text-xs text-[#6f6044]">
											{commit.author} · {timeAgo(commit.date)}
										</div>
									</div>
								))}
							</div>
						</div>
					</Card>
				</div>
			)}

			{/* ── Checkpoints ── */}
			{activeTab === "checkpoints" && (
				<div className="space-y-4">
					<Card
						title="Checkpoints"
						subtitle="Every commit is a checkpoint. Revert to any point in history."
					>
						{gitLogQuery.isLoading ? (
							<div className="flex items-center gap-2 text-sm text-[#6f6044]">
								<Loader2 className="h-4 w-4 animate-spin" /> Loading
								checkpoints…
							</div>
						) : (
							<div className="space-y-2">
								{gitLogQuery.data?.commits.map((commit, i) => (
									<div
										key={commit.sha}
										className="rounded-xl border border-[#e5d6b8] bg-[#faf3e3]/60 p-4"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="flex items-start gap-3 min-w-0">
												<div className="mt-1 flex flex-col items-center">
													<GitCommit className="h-4 w-4 text-setra-400" />
													{i < (gitLogQuery.data?.commits.length ?? 0) - 1 && (
														<div className="mt-1 h-full w-px bg-white" />
													)}
												</div>
												<div className="min-w-0">
													<div className="font-medium text-[#2b2418]">
														{commit.message}
													</div>
													<div className="mt-1 text-xs text-[#6f6044]">
														{commit.author} · {timeAgo(commit.date)} ·{" "}
														<span className="font-mono">{commit.shortSha}</span>
													</div>
													{i === 0 && (
														<Badge variant="success" className="mt-2">
															Current HEAD
														</Badge>
													)}
												</div>
											</div>
											<div className="flex shrink-0 items-center gap-2">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setRevertSha(commit.sha);
														setRevertHard(false);
													}}
													icon={<RotateCcw className="h-3.5 w-3.5" />}
												>
													Revert
												</Button>
											</div>
										</div>
									</div>
								))}
								{!gitLogQuery.data?.commits.length && (
									<EmptyState
										title="No commits yet"
										description="Make your first commit in the Git tab."
									/>
								)}
							</div>
						)}
					</Card>
				</div>
			)}

			{/* ── Run ── */}
			{activeTab === "run" && (
				<div className="space-y-4">
					<Card
						title="Run project"
						subtitle="Start your project and get a live preview URL."
					>
						<div className="space-y-4">
							<div className="flex items-center gap-3">
								{runQuery.data?.running ? (
									<>
										<div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
											<span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
											Running
										</div>
										{runQuery.data.url && (
											<a
												href={runQuery.data.url}
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-center gap-1.5 rounded-lg bg-setra-600 px-3 py-1.5 text-sm font-medium text-[#2b2418] hover:bg-setra-500"
											>
												<ExternalLink className="h-3.5 w-3.5" /> Preview
											</a>
										)}
										<Button
											variant="danger"
											size="sm"
											onClick={() => runStopMutation.mutate()}
											loading={runStopMutation.isPending}
											icon={<Square className="h-3.5 w-3.5" />}
										>
											Stop
										</Button>
									</>
								) : (
									<Button
										onClick={() => runStartMutation.mutate()}
										loading={runStartMutation.isPending}
										icon={<Play className="h-4 w-4" />}
										disabled={!project.workspacePath}
									>
										{project.workspacePath
											? "Run project"
											: "Configure workspace first"}
									</Button>
								)}
								{runQuery.data?.startedAt && (
									<span className="text-xs text-[#6f6044]">
										Started {timeAgo(runQuery.data.startedAt)}
									</span>
								)}
							</div>
							{runQuery.data?.lines && runQuery.data.lines.length > 0 && (
								<div className="rounded-lg border border-[#e5d6b8] bg-[#fdfaf3] p-4">
									<div className="mb-2 text-xs font-medium uppercase tracking-wide text-[#8a7a5c]">
										Output
									</div>
									<pre className="max-h-72 overflow-y-auto font-mono text-xs text-[#4b3f2d] whitespace-pre-wrap">
										{runQuery.data.lines.join("\n")}
									</pre>
								</div>
							)}
							{!project.workspacePath && (
								<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
									⚠ No workspace path configured. Edit the project to add a
									local workspace path before running.
								</div>
							)}
						</div>
					</Card>
				</div>
			)}

			{/* ── Database ── */}
			{activeTab === "database" && (
				<div className="space-y-4">
					<div className="flex justify-end">
						<Button
							onClick={() => setShowDbModal(true)}
							icon={<Plus className="h-4 w-4" />}
						>
							Connect database
						</Button>
					</div>
					{dbQuery.isLoading ? (
						<div className="glass h-24 animate-pulse rounded-xl" />
					) : dbQuery.data?.length === 0 ? (
						<Card title="No database connected">
							<EmptyState
								icon={<Database className="h-8 w-8" />}
								title="Connect a database"
								description="Paste a NeonDB / Postgres / MongoDB connection string or enter manual details."
							/>
						</Card>
					) : (
						<div className="space-y-3">
							{dbQuery.data?.map((conn) => (
								<Card key={conn.id} title={conn.name}>
									<div className="flex items-center justify-between gap-4">
										<div className="space-y-1 text-sm">
											<div className="flex items-center gap-2">
												<Badge
													variant={
														conn.status === "connected" ? "success" : "danger"
													}
												>
													{conn.status}
												</Badge>
												<span className="text-[#6f6044]">{conn.type}</span>
											</div>
											{conn.connectionString && (
												<div className="font-mono text-xs text-[#8a7a5c]">
													{conn.connectionString}
												</div>
											)}
											{conn.host && (
												<div className="text-xs text-[#8a7a5c]">
													{conn.host}:{conn.port} / {conn.database}
												</div>
											)}
											<div className="text-xs text-[#9d8d6e]">
												Added {timeAgo(conn.createdAt)}
											</div>
										</div>
										<Button
											variant="danger"
											size="sm"
											onClick={() => dbRemoveMutation.mutate(conn.id)}
											loading={
												dbRemoveMutation.isPending &&
												dbRemoveMutation.variables === conn.id
											}
										>
											Remove
										</Button>
									</div>
								</Card>
							))}
						</div>
					)}
				</div>
			)}

			{/* ── Passwords ── */}
			{activeTab === "passwords" && (
				<div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
					<Card
						title="Add password"
						subtitle="Store per-project secrets for the assigned team."
					>
						<div className="space-y-3">
							<input
								value={secretKey}
								onChange={(e) => setSecretKey(e.target.value)}
								placeholder="API_KEY"
								className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3] px-3 py-2 text-sm text-[#2b2418] outline-none"
							/>
							<textarea
								value={secretValue}
								onChange={(e) => setSecretValue(e.target.value)}
								rows={5}
								placeholder="secret value"
								className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3] px-3 py-2 text-sm text-[#2b2418] outline-none"
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
					<Card title="Stored passwords">
						<div className="space-y-2">
							{secretsQuery.data?.map((s) => (
								<div
									key={s.id}
									className="flex items-center justify-between gap-3 rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-3"
								>
									<div className="min-w-0">
										<div className="font-medium text-[#2b2418]">{s.key}</div>
										<div className="text-xs text-[#6f6044]">{s.maskedValue}</div>
									</div>
									<Button
										variant="danger"
										size="sm"
										onClick={() => removeSecretMutation.mutate(s.key)}
										loading={
											removeSecretMutation.isPending &&
											removeSecretMutation.variables === s.key
										}
									>
										Delete
									</Button>
								</div>
							))}
							{secretsQuery.data?.length === 0 && (
								<EmptyState
									title="No passwords stored"
									description="Save database passwords, API keys, and secrets here."
								/>
							)}
						</div>
					</Card>
				</div>
			)}

			{/* ── Production ── */}
			{activeTab === "production" && (
				<div className="space-y-4">
					{productionAllPass && (
						<div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
							<CheckCircle2 className="h-6 w-6 text-emerald-400" />
							<div>
								<div className="font-semibold text-emerald-200">
									✅ Production Ready
								</div>
								<div className="text-xs text-emerald-300/70">
									All checklist items passed. This project is ready to ship.
								</div>
							</div>
						</div>
					)}
					<div className="flex items-center justify-between">
						<div className="text-sm text-[#6f6044]">
							{productionQuery.data?.length
								? `${productionQuery.data.filter((i) => i.status === "pass").length} / ${productionQuery.data.length} passed`
								: "Generate a checklist to get started"}
						</div>
						<Button
							onClick={() => generateChecklistMutation.mutate()}
							loading={generateChecklistMutation.isPending}
							icon={<Zap className="h-4 w-4" />}
							variant="secondary"
						>
							{productionQuery.data?.length
								? "Regenerate checklist"
								: "Generate checklist"}
						</Button>
					</div>
					{productionQuery.isLoading ? (
						<div className="glass h-48 animate-pulse rounded-xl" />
					) : (
						<div className="space-y-2">
							{Object.entries(
								(productionQuery.data ?? []).reduce<
									Record<string, ChecklistItem[]>
								>((acc, item) => {
									if (!acc[item.category]) acc[item.category] = [];
									acc[item.category]!.push(item);
									return acc;
								}, {}),
							).map(([category, items]) => (
								<Card key={category} title={category}>
									<div className="space-y-2">
										{items.map((item) => (
											<div
												key={item.id}
												className="flex items-start gap-3 rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 px-3 py-3"
											>
												<button
													type="button"
													onClick={() =>
														updateChecklistMutation.mutate({
															itemId: item.id,
															status:
																item.status === "pass" ? "pending" : "pass",
														})
													}
													className="mt-0.5 shrink-0"
												>
													{item.status === "pass" ? (
														<CheckCircle2 className="h-5 w-5 text-emerald-400" />
													) : item.status === "fail" ? (
														<XCircle className="h-5 w-5 text-red-400" />
													) : (
														<Circle className="h-5 w-5 text-[#9d8d6e]" />
													)}
												</button>
												<div className="min-w-0 flex-1">
													<div className="font-medium text-[#2b2418]">
														{item.title}
													</div>
													<div className="mt-0.5 text-xs text-[#6f6044]">
														{item.description}
													</div>
												</div>
												<div className="flex shrink-0 gap-1">
													<button
														type="button"
														title="Mark pass"
														onClick={() =>
															updateChecklistMutation.mutate({
																itemId: item.id,
																status: "pass",
															})
														}
														className={cn(
															"rounded px-2 py-1 text-xs",
															item.status === "pass"
																? "bg-emerald-500/20 text-emerald-300"
																: "text-[#8a7a5c] hover:text-emerald-400",
														)}
													>
														Pass
													</button>
													<button
														type="button"
														title="Mark fail"
														onClick={() =>
															updateChecklistMutation.mutate({
																itemId: item.id,
																status: "fail",
															})
														}
														className={cn(
															"rounded px-2 py-1 text-xs",
															item.status === "fail"
																? "bg-red-500/20 text-red-300"
																: "text-[#8a7a5c] hover:text-red-400",
														)}
													>
														Fail
													</button>
												</div>
											</div>
										))}
									</div>
								</Card>
							))}
							{!productionQuery.data?.length && (
								<EmptyState
									icon={<Shield className="h-8 w-8" />}
									title="No checklist yet"
									description="Click 'Generate checklist' to create a production readiness checklist."
								/>
							)}
						</div>
					)}
				</div>
			)}

			{/* ── Discussion ── */}
			{activeTab === "discussion" && (
				<Card
					title={`#${channelQuery.data?.name ?? project.name}`}
					subtitle="Team channel — agents and humans collaborate here."
				>
					<div className="flex flex-col gap-4">
						<div className="h-96 overflow-y-auto space-y-3 rounded-lg border border-[#e5d6b8] bg-[#fdfaf3] p-4">
							{messagesQuery.isLoading && (
								<div className="flex items-center justify-center py-8 text-[#8a7a5c]">
									<Loader2 className="h-5 w-5 animate-spin" />
								</div>
							)}
							{messagesQuery.data?.map((msg) => (
								<div key={msg.id} className="flex items-start gap-3">
									<div
										className={cn(
											"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-[#2b2418]",
											avatarTone(msg.fromAgent),
										)}
									>
										{initials(msg.fromAgent)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-baseline gap-2">
											<span className="text-sm font-semibold text-[#2b2418]">
												{msg.fromAgent === "human" ? "You" : msg.fromAgent}
											</span>
											<span className="text-xs text-[#8a7a5c]">
												{timeAgo(msg.createdAt)}
											</span>
										</div>
										<div className="mt-0.5 text-sm text-[#4b3f2d] whitespace-pre-wrap">
											{msg.content}
										</div>
									</div>
								</div>
							))}
							{messagesQuery.data?.length === 0 && !messagesQuery.isLoading && (
								<div className="flex flex-col items-center justify-center py-12 text-[#8a7a5c]">
									<MessageSquare className="h-8 w-8 mb-2 opacity-40" />
									<div className="text-sm">
										No messages yet. Start the conversation!
									</div>
								</div>
							)}
							<div ref={chatEndRef} />
						</div>
						<div className="flex gap-2">
							<input
								value={discussionMsg}
								onChange={(e) => setDiscussionMsg(e.target.value)}
								onKeyDown={(e) => {
									if (
										e.key === "Enter" &&
										!e.shiftKey &&
										discussionMsg.trim()
									) {
										e.preventDefault();
										sendMessageMutation.mutate();
									}
								}}
								placeholder="Message the team… (Enter to send)"
								className="flex-1 rounded-lg border border-[#d9c6a3] bg-[#faf3e3] px-4 py-2 text-sm text-[#2b2418] placeholder:text-[#8a7a5c] outline-none focus:border-setra-500"
							/>
							<Button
								onClick={() => sendMessageMutation.mutate()}
								disabled={!discussionMsg.trim() || !channelQuery.data}
								loading={sendMessageMutation.isPending}
								icon={<Send className="h-4 w-4" />}
							>
								Send
							</Button>
						</div>
					</div>
				</Card>
			)}

			{/* ── Context ── */}
			{activeTab === "context" && (
				<Card
					title="CONTEXT.md"
					subtitle="Shared working context for every assigned agent."
				>
					<div className="space-y-3">
						<textarea
							value={contextDraft}
							onChange={(e) => setContextDraft(e.target.value)}
							rows={18}
							className="w-full rounded-lg border border-[#e5d6b8] bg-[#fdfaf3] px-4 py-3 font-mono text-sm text-[#2b2418] outline-none"
						/>
						<div className="flex items-center justify-between gap-3 text-xs text-[#6f6044]">
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
			)}

			{/* ── Terminal ── */}
			{activeTab === "terminal" && (
				<Card title="Terminal">
					<EmptyState
						icon={<Monitor className="h-8 w-8" />}
						title="Terminal available in desktop app"
						description="Use the Run tab to start your project from the browser view."
					/>
				</Card>
			)}

			{/* Assign agent modal */}
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
					{availableAgents.map((a) => (
						<button
							key={a.agent_id}
							type="button"
							onClick={() => setSelectedAgentId(a.agent_id ?? "")}
							className={cn(
								"flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors",
								selectedAgentId === a.agent_id
									? "border-setra-500 bg-setra-500/10"
									: "border-[#e5d6b8] bg-[#faf3e3]/60 hover:border-[#d9c6a3]",
							)}
						>
							<div>
								<div className="font-medium text-[#2b2418]">{a.display_name}</div>
								<div className="text-xs text-[#6f6044]">
									{a.template_name} · {a.runtime_status ?? "idle"}
								</div>
							</div>
							{a.agent_id === selectedAgentId && (
								<Badge variant="info">Selected</Badge>
							)}
						</button>
					))}
					{availableAgents.length === 0 && (
						<EmptyState
							title="Everyone is already assigned"
							description="Hire more agents or reassign from other projects."
						/>
					)}
				</div>
			</Modal>

			{/* Revert confirm modal */}
			<Modal
				open={Boolean(revertSha)}
				onClose={() => setRevertSha(null)}
				title="Revert to checkpoint"
				actions={
					<>
						<Button variant="ghost" onClick={() => setRevertSha(null)}>
							Cancel
						</Button>
						<Button
							variant="danger"
							onClick={() =>
								revertMutation.mutate({ sha: revertSha!, hard: revertHard })
							}
							loading={revertMutation.isPending}
						>
							Revert
						</Button>
					</>
				}
			>
				<div className="space-y-4 text-sm">
					<div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200">
						<AlertTriangle className="mb-1 h-4 w-4 inline mr-1" />
						You are about to revert to commit{" "}
						<span className="font-mono font-bold">
							{revertSha?.slice(0, 8)}
						</span>
						.
					</div>
					<div className="space-y-2">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								checked={!revertHard}
								onChange={() => setRevertHard(false)}
							/>
							<div>
								<div className="font-medium text-[#2b2418]">
									Safe revert (recommended)
								</div>
								<div className="text-xs text-[#6f6044]">
									Creates a new revert commit — history preserved, no data loss.
								</div>
							</div>
						</label>
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								checked={revertHard}
								onChange={() => setRevertHard(true)}
							/>
							<div>
								<div className="font-medium text-red-300">Hard reset</div>
								<div className="text-xs text-[#6f6044]">
									Discards all changes after this commit. This cannot be undone.
								</div>
							</div>
						</label>
					</div>
				</div>
			</Modal>

			{/* DB connect modal */}
			<Modal
				open={showDbModal}
				onClose={() => setShowDbModal(false)}
				title="Connect a database"
				actions={
					<>
						<Button variant="ghost" onClick={() => setShowDbModal(false)}>
							Cancel
						</Button>
						<Button
							onClick={() => dbConnectMutation.mutate()}
							loading={dbConnectMutation.isPending}
							disabled={
								dbMode === "string" ? !dbConnString.trim() : !dbName.trim()
							}
						>
							Connect
						</Button>
					</>
				}
			>
				<div className="space-y-4">
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => setDbMode("string")}
							className={cn(
								"flex-1 rounded-lg border px-3 py-2 text-sm",
								dbMode === "string"
									? "border-setra-500 bg-setra-500/10 text-[#2b2418]"
									: "border-[#d9c6a3] text-[#6f6044] hover:border-[#d9c6a3]",
							)}
						>
							Connection string
						</button>
						<button
							type="button"
							onClick={() => setDbMode("manual")}
							className={cn(
								"flex-1 rounded-lg border px-3 py-2 text-sm",
								dbMode === "manual"
									? "border-setra-500 bg-setra-500/10 text-[#2b2418]"
									: "border-[#d9c6a3] text-[#6f6044] hover:border-[#d9c6a3]",
							)}
						>
							Manual
						</button>
					</div>
					{dbMode === "string" ? (
						<>
							<div>
								<label className="mb-1 block text-xs text-[#6f6044]">
									Display name (optional)
								</label>
								<input
									value={dbName}
									onChange={(e) => setDbName(e.target.value)}
									placeholder="My NeonDB"
									className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3] px-3 py-2 text-sm text-[#2b2418] outline-none"
								/>
							</div>
							<div>
								<label className="mb-1 block text-xs text-[#6f6044]">
									Connection string
								</label>
								<textarea
									value={dbConnString}
									onChange={(e) => setDbConnString(e.target.value)}
									rows={3}
									placeholder="postgres://user:pass@host/db  or  mongodb+srv://..."
									className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3] px-3 py-2 font-mono text-sm text-[#2b2418] outline-none"
								/>
								<div className="mt-1 text-xs text-[#8a7a5c]">
									Supports NeonDB, Supabase, PlanetScale, MongoDB Atlas, and any
									standard connection string.
								</div>
							</div>
						</>
					) : (
						<div className="space-y-3">
							<input
								value={dbName}
								onChange={(e) => setDbName(e.target.value)}
								placeholder="Connection name"
								className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3] px-3 py-2 text-sm text-[#2b2418] outline-none"
							/>
							<div className="text-xs text-[#6f6044]">
								Manual connection details coming soon. Use connection string
								mode for now.
							</div>
						</div>
					)}
				</div>
			</Modal>
		</div>
	);
}
