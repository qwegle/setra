import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	ArrowRight,
	Bot,
	ClipboardCheck,
	Coins,
	FolderKanban,
	Plus,
	ShieldCheck,
	TrendingUp,
	Zap,
} from "lucide-react";
import type { ElementType } from "react";
import { Link } from "react-router-dom";
import { AnalyticsCards } from "../components/AnalyticsCards";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { type Agent, api } from "../lib/api";
import { cn, formatCost, formatTokens, timeAgo } from "../lib/utils";

const STATUS_DOT: Partial<Record<Agent["status"], string>> = {
	idle: "bg-[#a39074]",
	running: "bg-green-400",
	waiting_approval: "bg-yellow-400",
	paused: "bg-yellow-500",
	error: "bg-red-400",
	done: "bg-blue-400",
	completed: "bg-blue-400",
	pending: "bg-[#a39074]",
	inactive: "bg-[#e6d5b0]",
};

const STATUS_LABEL: Partial<Record<Agent["status"], string>> = {
	idle: "Idle",
	running: "Running",
	waiting_approval: "Needs review",
	paused: "Paused",
	error: "Error",
	done: "Done",
	completed: "Completed",
	pending: "Pending",
	inactive: "Inactive",
};

const PROJECT_ONBOARDING_DISMISSED_KEY = "setra:project-onboarding-dismissed";

function LoadingState() {
	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-4 md:grid-cols-4">
				{Array.from({ length: 4 }).map((_, index) => (
					<Skeleton key={index} variant="rect" height="112px" />
				))}
			</div>
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<Card>
					<Skeleton count={5} />
				</Card>
				<Card>
					<Skeleton count={5} />
				</Card>
			</div>
		</div>
	);
}

function KpiCard({
	label,
	value,
	icon: Icon,
	subtitle,
	accent,
}: {
	label: string;
	value: string | number;
	icon: ElementType;
	subtitle: string;
	accent: string;
}) {
	return (
		<Card className="h-full">
			<div className="flex items-start justify-between gap-4">
				<div>
					<p className="text-sm text-[#6f6044]">{label}</p>
					<p className="mt-2 text-2xl font-semibold text-[#2b2418]">{value}</p>
					<p className="mt-2 text-sm text-[#6f6044]">{subtitle}</p>
				</div>
				<div className={cn("rounded-lg p-3", accent)}>
					<Icon className="h-5 w-5" aria-hidden="true" />
				</div>
			</div>
		</Card>
	);
}

function SectionLink({ to, label }: { to: string; label: string }) {
	return (
		<Link
			to={to}
			className="inline-flex items-center gap-1 text-sm text-[#6f6044] transition-colors hover:text-[#3b3224]"
		>
			{label}
			<ArrowRight className="h-4 w-4" aria-hidden="true" />
		</Link>
	);
}

function QuickAction({
	to,
	icon: Icon,
	label,
	variant = "secondary",
}: {
	to: string;
	icon: ElementType;
	label: string;
	variant?: "primary" | "secondary";
}) {
	return (
		<Link to={to}>
			<Button
				type="button"
				variant={variant}
				icon={<Icon className="h-4 w-4" aria-hidden="true" />}
			>
				{label}
			</Button>
		</Link>
	);
}

export function OverviewPage() {
	const projectsQuery = useQuery({
		queryKey: ["projects"],
		queryFn: api.projects.list,
	});
	const agentsQuery = useQuery({
		queryKey: ["agents"],
		queryFn: api.agents.list,
		refetchInterval: 15_000,
	});
	const budgetQuery = useQuery({
		queryKey: ["budget"],
		queryFn: api.budget.summary,
		refetchInterval: 30_000,
	});
	const approvalsQuery = useQuery({
		queryKey: ["approvals", "pending", "overview"],
		queryFn: () => api.approvals.list("pending"),
		refetchInterval: 10_000,
	});

	const projects = projectsQuery.data ?? [];
	const agents = agentsQuery.data ?? [];
	const budget = budgetQuery.data;
	const pendingApprovals = approvalsQuery.data ?? [];
	const isLoading =
		projectsQuery.isLoading ||
		agentsQuery.isLoading ||
		budgetQuery.isLoading ||
		approvalsQuery.isLoading;
	const isError =
		projectsQuery.isError ||
		agentsQuery.isError ||
		budgetQuery.isError ||
		approvalsQuery.isError;

	const activeAgents = agents.filter(
		(agent) =>
			agent.status === "running" || agent.status === "waiting_approval",
	);
	const cacheHitPct = ((budget?.cacheHitRate ?? 0) * 100).toFixed(0);
	const todaySpend = budget?.dailyCostUsd ?? 0;
	const pendingApprovalCount = pendingApprovals.length;
	const topProjects = [...projects]
		.sort((a, b) => b.issueCount - a.issueCount)
		.slice(0, 3);
	const recentAgents = agents.slice(0, 8);

	return (
		<div className="space-y-6 px-6 py-6">
			<PageHeader
				title="Overview"
				subtitle="Monitor project health, active agents, and budget usage at a glance."
				actions={
					<Badge variant="info" role="status" aria-live="polite">
						{activeAgents.length} active agents
					</Badge>
				}
			/>

			{isLoading && <LoadingState />}

			{isError && !isLoading && (
				<Card>
					<p className="text-sm text-red-400">Failed to load overview data.</p>
				</Card>
			)}

			{!isLoading && !isError && (
				<>
					<AnalyticsCards days={14} />
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
						<KpiCard
							label="Projects"
							value={projects.length}
							icon={FolderKanban}
							subtitle={`${projects.filter((project) => project.activeAgentCount > 0).length} active`}
							accent="bg-[#7a5421]/15 text-[#7a5421]"
						/>
						<KpiCard
							label="Active agents"
							value={activeAgents.length}
							icon={Bot}
							subtitle={`of ${agents.length} total`}
							accent="bg-green-500/15 text-green-300"
						/>
						<KpiCard
							label="Today's spend"
							value={formatCost(todaySpend)}
							icon={Coins}
							subtitle={`${formatCost(budget?.weeklyCostUsd ?? 0)} this week`}
							accent="bg-yellow-500/15 text-yellow-300"
						/>
						<KpiCard
							label="Cache hit rate"
							value={`${cacheHitPct}%`}
							icon={Zap}
							subtitle="Prompt cache efficiency"
							accent="bg-[#7a5421]/15 text-[#7a5421]"
						/>
						<KpiCard
							label="Approvals"
							value={pendingApprovalCount}
							icon={ShieldCheck}
							subtitle={
								pendingApprovalCount > 0 ? "Pending in queue" : "Workflow ready"
							}
							accent={
								pendingApprovalCount > 0
									? "bg-yellow-500/15 text-yellow-300"
									: "bg-[#f3e7cf]/40 text-[#4b3f2d]"
							}
						/>
					</div>

					<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
						<Card
							title="Agent activity"
							actions={<SectionLink to="/agents" label="View all" />}
						>
							{recentAgents.length === 0 ? (
								<EmptyState
									icon={<Bot className="h-10 w-10" aria-hidden="true" />}
									title="No agents registered yet"
									description="Hire an agent to start seeing live activity, cost, and status updates."
								/>
							) : (
								<div className="space-y-3" aria-live="polite">
									{recentAgents.map((agent) => (
										<div
											key={agent.id}
											className="flex items-center gap-3 rounded-lg border border-[#d9c6a3]/50 bg-[#faf3e3]/40 px-3 py-3"
										>
											<span
												className={cn(
													"h-2.5 w-2.5 rounded-full",
													STATUS_DOT[agent.status] ?? STATUS_DOT.idle,
												)}
												aria-hidden="true"
											/>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2">
													<p className="truncate text-sm font-medium text-[#2b2418]">
														{agent.role}
													</p>
													<Badge
														variant={
															agent.status === "error"
																? "danger"
																: agent.status === "running"
																	? "success"
																	: agent.status === "waiting_approval"
																		? "warning"
																		: "default"
														}
													>
														{STATUS_LABEL[agent.status] ?? agent.status}
													</Badge>
												</div>
												<p className="mt-1 truncate text-sm text-[#6f6044]">
													{agent.model ?? "No model assigned"}
												</p>
											</div>
											<div className="text-right text-sm text-[#6f6044]">
												<p className="font-medium text-[#2b2418]">
													{formatCost(agent.totalCostUsd ?? 0)}
												</p>
												<p>
													{agent.lastActiveAt
														? timeAgo(agent.lastActiveAt)
														: "—"}
												</p>
											</div>
										</div>
									))}
								</div>
							)}
						</Card>

						<Card
							title="Top projects"
							actions={<SectionLink to="/projects" label="View all" />}
						>
							{topProjects.length === 0 ? (
								<EmptyState
									icon={
										<FolderKanban className="h-10 w-10" aria-hidden="true" />
									}
									title="No projects yet"
									description="Create a project to start planning work, assigning agents, and tracking delivery."
								/>
							) : (
								<div className="space-y-3">
									{topProjects.map((project) => (
										<Link
											key={project.id}
											to={`/projects/${project.id}`}
											className="block rounded-lg border border-[#d9c6a3]/50 bg-[#faf3e3]/40 px-3 py-3 transition-colors hover:border-[#d9c6a3] hover:bg-[#faf3e3]/60"
										>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-2">
														<p className="truncate text-sm font-medium text-[#2b2418]">
															{project.name}
														</p>
														{project.activeAgentCount > 0 && (
															<Badge variant="success">
																{project.activeAgentCount} active
															</Badge>
														)}
													</div>
													{project.description && (
														<p className="mt-1 truncate text-sm text-[#6f6044]">
															{project.description}
														</p>
													)}
												</div>
												<div className="text-right text-sm text-[#6f6044]">
													<p className="text-[#2b2418]">
														{project.issueCount} issues
													</p>
													<p>{formatCost(project.totalCostUsd)}</p>
												</div>
											</div>
										</Link>
									))}
								</div>
							)}
						</Card>
					</div>

					{budget ? (
						<Card title="Token usage" subtitle="This month across all runs">
							<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
								<div>
									<p className="text-sm text-[#6f6044]">Input tokens</p>
									<p className="mt-2 text-xl font-semibold text-[#2b2418]">
										{formatTokens(budget.totalInputTokens)}
									</p>
								</div>
								<div>
									<p className="text-sm text-[#6f6044]">Output tokens</p>
									<p className="mt-2 text-xl font-semibold text-[#2b2418]">
										{formatTokens(budget.totalOutputTokens)}
									</p>
								</div>
								<div>
									<p className="text-sm text-[#6f6044]">Cache reads</p>
									<p className="mt-2 text-xl font-semibold text-[#2b2418]">
										{formatTokens(budget.totalCacheReadTokens)}
									</p>
								</div>
							</div>
							<div className="mt-4 space-y-2">
								<div className="flex h-2 overflow-hidden rounded-full bg-[#faf3e3]">
									<div
										className="bg-[#7a5421]"
										style={{
											width: `${(budget.totalInputTokens / (budget.totalInputTokens + budget.totalOutputTokens + budget.totalCacheReadTokens || 1)) * 100}%`,
										}}
									/>
									<div
										className="bg-green-500"
										style={{
											width: `${(budget.totalOutputTokens / (budget.totalInputTokens + budget.totalOutputTokens + budget.totalCacheReadTokens || 1)) * 100}%`,
										}}
									/>
									<div
										className="bg-yellow-500"
										style={{
											width: `${(budget.totalCacheReadTokens / (budget.totalInputTokens + budget.totalOutputTokens + budget.totalCacheReadTokens || 1)) * 100}%`,
										}}
									/>
								</div>
								<div className="flex flex-wrap gap-4 text-sm text-[#6f6044]">
									<span className="flex items-center gap-2">
										<span
											className="h-2 w-2 rounded-full bg-[#7a5421]"
											aria-hidden="true"
										/>
										Input
									</span>
									<span className="flex items-center gap-2">
										<span
											className="h-2 w-2 rounded-full bg-green-500"
											aria-hidden="true"
										/>
										Output
									</span>
									<span className="flex items-center gap-2">
										<span
											className="h-2 w-2 rounded-full bg-yellow-500"
											aria-hidden="true"
										/>
										Cache reads
									</span>
								</div>
							</div>
						</Card>
					) : (
						<EmptyState
							icon={<TrendingUp className="h-10 w-10" aria-hidden="true" />}
							title="No budget data yet"
							description="Spend and token metrics will appear after agents start running."
						/>
					)}

					<div className="flex flex-wrap gap-3">
						<QuickAction
							to="/projects"
							icon={Plus}
							label="New Project"
							variant="primary"
						/>
						<QuickAction to="/costs" icon={Coins} label="View Costs & Budget" />
						<QuickAction
							to="/review"
							icon={ClipboardCheck}
							label="Review Queue"
						/>
						<QuickAction to="/agents" icon={Bot} label="Manage Agents" />
					</div>
				</>
			)}
		</div>
	);
}
