import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bot, Filter, Plus, Sparkles, Zap } from "lucide-react";
import {
	type ReactNode,
	type SyntheticEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Link } from "react-router-dom";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	Input,
	Modal,
	PageHeader,
	Select,
	Skeleton,
} from "../components/ui";
import {
	type Agent,
	type AgentRunMode,
	type AgentStatus,
	api,
} from "../lib/api";
import { cn, formatCost, formatTokens, timeAgo } from "../lib/utils";

const STATUS_CONFIG: Partial<
	Record<
		AgentStatus,
		{
			variant: "default" | "success" | "warning" | "danger" | "info";
			dot: string;
			label: string;
		}
	>
> & {
	idle: { variant: "default"; dot: string; label: string };
} = {
	idle: { variant: "default", dot: "bg-zinc-500", label: "Idle" },
	running: { variant: "success", dot: "bg-green-400", label: "Running" },
	waiting_approval: {
		variant: "warning",
		dot: "bg-yellow-400",
		label: "Review",
	},
	paused: { variant: "warning", dot: "bg-yellow-500", label: "Paused" },
	awaiting_key: {
		variant: "warning",
		dot: "bg-yellow-400",
		label: "Awaiting Key",
	},
	error: { variant: "danger", dot: "bg-red-400", label: "Error" },
	done: { variant: "info", dot: "bg-blue-400", label: "Done" },
	completed: { variant: "info", dot: "bg-blue-400", label: "Completed" },
	pending: { variant: "default", dot: "bg-zinc-400", label: "Pending" },
};

type FilterOption = "all" | AgentStatus;

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "idle", label: "Idle" },
	{ value: "error", label: "Error" },
	{ value: "waiting_approval", label: "Review" },
];

function LoadingState() {
	return (
		<div className="space-y-6">
			<Skeleton count={1} width="240px" />
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
				{Array.from({ length: 3 }).map((_, index) => (
					<Skeleton key={index} variant="rect" height="220px" />
				))}
			</div>
		</div>
	);
}

export function AgentsPage() {
	const [statusFilter, setStatusFilter] = useState<FilterOption>("all");
	const [hireModalOpen, setHireModalOpen] = useState(false);

	const {
		data: agents = [],
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["agents"],
		queryFn: api.agents.list,
		refetchInterval: 10_000,
	});
	const { data: heartbeats = [] } = useQuery({
		queryKey: ["agents-heartbeat"],
		queryFn: api.agents.heartbeat,
		refetchInterval: 10_000,
	});
	const { data: expSummary } = useQuery({
		queryKey: ["agents-experience-summary"],
		queryFn: api.agents.getExperienceSummary,
		staleTime: 30_000,
	});

	const heartbeatByAgentId = useMemo(
		() =>
			new Map(
				heartbeats.map((heartbeat) => [heartbeat.agentId, heartbeat] as const),
			),
		[heartbeats],
	);
	const filtered = useMemo(
		() =>
			statusFilter === "all"
				? agents
				: agents.filter((agent) => agent.status === statusFilter),
		[agents, statusFilter],
	);
	const runningCount = useMemo(
		() => agents.filter((agent) => agent.status === "running").length,
		[agents],
	);
	const errorCount = useMemo(
		() => agents.filter((agent) => agent.status === "error").length,
		[agents],
	);

	return (
		<div className="space-y-6 px-6 py-6">
			<PageHeader
				title="Agents"
				subtitle="Manage active agents, monitor health, and adjust model assignments."
				actions={
					<Button
						type="button"
						onClick={() => setHireModalOpen(true)}
						icon={<Plus className="h-4 w-4" aria-hidden="true" />}
					>
						Add Agent
					</Button>
				}
			/>

			<div className="flex flex-wrap items-center gap-2" aria-live="polite">
				<Badge variant="default" role="status">
					{agents.length} total
				</Badge>
				{runningCount > 0 && (
					<Badge variant="success">{runningCount} running</Badge>
				)}
				{errorCount > 0 && <Badge variant="danger">{errorCount} error</Badge>}
			</div>

			<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
				<div className="rounded-xl border border-border/30 bg-surface-1 p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Total Agents
					</div>
					<div className="mt-1 text-2xl font-bold">
						{expSummary?.totalAgents ?? agents.length}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						<span className="text-green-400">{runningCount} running</span>
						{errorCount > 0 && (
							<span className="ml-2 text-red-400">{errorCount} errors</span>
						)}
					</div>
				</div>
				<div className="rounded-xl border border-border/30 bg-surface-1 p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Total Runs
					</div>
					<div className="mt-1 text-2xl font-bold">
						{expSummary?.totalRuns ?? 0}
					</div>
					<div className="mt-1 text-xs text-green-400">
						{expSummary?.overallSuccessRate ?? 0}% success rate
					</div>
				</div>
				<div className="rounded-xl border border-border/30 bg-surface-1 p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Avg Credibility
					</div>
					<div className="mt-1 text-2xl font-bold">
						{((expSummary?.avgCredibility ?? 0.5) * 100).toFixed(0)}%
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Bayesian trust score
					</div>
				</div>
				<div className="rounded-xl border border-border/30 bg-surface-1 p-4">
					<div className="text-xs uppercase tracking-wide text-muted-foreground">
						Total Cost
					</div>
					<div className="mt-1 text-2xl font-bold">
						${(expSummary?.totalCost ?? 0).toFixed(2)}
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Across all agents
					</div>
				</div>
			</div>

			{(expSummary?.topSkills?.length ?? 0) > 0 && (
				<div className="flex flex-wrap gap-2">
					<span className="mr-1 self-center text-xs text-muted-foreground">
						Team skills:
					</span>
					{expSummary?.topSkills.map(([skill, count]) => (
						<span
							key={skill}
							className="inline-flex items-center gap-1 rounded-full border border-accent-blue/20 bg-accent-blue/10 px-2 py-0.5 text-xs text-accent-blue"
						>
							{skill} <span className="opacity-60">({count})</span>
						</span>
					))}
				</div>
			)}

			<div
				className="flex flex-wrap items-center gap-2"
				aria-label="Agent status filters"
			>
				<Filter className="h-4 w-4 text-zinc-500" aria-hidden="true" />
				{FILTER_OPTIONS.map((option) => (
					<Button
						key={option.value}
						type="button"
						variant={statusFilter === option.value ? "primary" : "ghost"}
						size="sm"
						onClick={() => setStatusFilter(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>

			{isLoading && <LoadingState />}

			{isError && !isLoading && (
				<Card>
					<p className="text-sm text-red-400">Could not load agents.</p>
				</Card>
			)}

			{!isLoading && !isError && agents.length === 0 && (
				<EmptyState
					icon={<Bot className="h-10 w-10" aria-hidden="true" />}
					title="No agents yet"
					description="Add your first AI agent to assign work, track spend, and monitor live delivery progress."
					action={
						<Button
							type="button"
							onClick={() => setHireModalOpen(true)}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							Add your first agent
						</Button>
					}
				/>
			)}

			{!isLoading && !isError && agents.length > 0 && filtered.length === 0 && (
				<EmptyState
					icon={<Bot className="h-10 w-10" aria-hidden="true" />}
					title={`No ${statusFilter} agents`}
					description="Try a different status filter to see more agents."
				/>
			)}

			{!isLoading && !isError && filtered.length > 0 && (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{filtered.map((agent) => (
						<AgentCard
							key={agent.id}
							agent={agent}
							heartbeat={heartbeatByAgentId.get(agent.id)}
						/>
					))}
				</div>
			)}

			<HireAgentModal
				open={hireModalOpen}
				onClose={() => setHireModalOpen(false)}
			/>
		</div>
	);
}

function AgentCard({
	agent,
	heartbeat,
}: {
	agent: Agent;
	heartbeat?: { ageSeconds: number | null; stale: boolean } | undefined;
}) {
	const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
	const totalInput = agent.totalInputTokens ?? 0;
	const totalOutput = agent.totalOutputTokens ?? 0;
	const cacheTokens = agent.totalCacheReadTokens ?? 0;
	const totalCost = agent.totalCostUsd ?? 0;
	const totalTokens = totalInput + totalOutput;
	const cacheHitPct =
		totalInput > 0 ? Math.round((cacheTokens / totalInput) * 100) : 0;

	return (
		<Link to={`/agents/${agent.id}/dashboard`} className="block">
			<Card className="h-full transition-colors hover:border-zinc-600">
				<div className="space-y-4">
					<div className="flex items-start justify-between gap-3">
						<div className="flex items-center gap-3">
							<div className="rounded-lg bg-blue-500/15 p-3 text-blue-300">
								<Bot className="h-5 w-5" aria-hidden="true" />
							</div>
							<div className="min-w-0">
								<p className="truncate text-sm font-semibold text-white">
									{agent.displayName || agent.role || agent.slug}
								</p>
								<p className="truncate font-mono text-xs text-zinc-400">
									{agent.slug}
								</p>
							</div>
						</div>
						<Badge variant={config.variant}>
							<span
								className={cn("h-2 w-2 rounded-full", config.dot)}
								aria-hidden="true"
							/>
							{config.label}
						</Badge>
					</div>

					<div className="flex items-center gap-2 text-xs text-zinc-400">
						<span className="text-zinc-500">Model:</span>
						<span className="font-mono">{agent.model ?? "auto"}</span>
					</div>

					<div className="space-y-2">
						<p className="text-xs uppercase tracking-wide text-zinc-500">
							Run mode
						</p>
						<RunModePicker
							agentId={agent.id}
							currentMode={agent.runMode ?? "on_demand"}
						/>
					</div>

					<div className="grid grid-cols-3 gap-3 text-sm">
						<Stat label="Cost" value={formatCost(totalCost)} />
						<Stat label="Tokens" value={formatTokens(totalTokens)} />
						<Stat
							label="Cache hit"
							value={`${cacheHitPct}%`}
							icon={
								<Zap className="h-3 w-3 text-blue-300" aria-hidden="true" />
							}
						/>
					</div>

					<div className="grid grid-cols-2 gap-3 text-sm text-zinc-400">
						<div className="rounded-md bg-zinc-900/60 px-3 py-2">
							<p className="text-xs text-zinc-500">Last active</p>
							<p className="mt-1 text-white">
								{timeAgo(agent.lastActiveAt ?? "")}
							</p>
						</div>
						<div className="rounded-md bg-zinc-900/60 px-3 py-2">
							<p className="text-xs text-zinc-500">Heartbeat</p>
							<p
								className={cn(
									"mt-1",
									heartbeat?.stale ? "text-red-300" : "text-white",
								)}
							>
								{heartbeat?.ageSeconds == null
									? "No run yet"
									: `${heartbeat.ageSeconds}s ago`}
							</p>
						</div>
					</div>

					<div className="space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							{agent.experienceLevel && (
								<span className="inline-flex items-center rounded-full border border-border/40 bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
									{agent.experienceLevel}
								</span>
							)}
							{agent.topSkills?.slice(0, 3).map((skill) => (
								<span
									key={skill}
									className="inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-300"
								>
									{skill}
								</span>
							))}
						</div>
						{agent.credibility != null && (
							<div>
								<div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
									<span>Credibility</span>
									<span>{(agent.credibility * 100).toFixed(0)}%</span>
								</div>
								<div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
									<div
										className={cn(
											"h-full rounded-full transition-all",
											agent.credibility >= 0.7
												? "bg-green-500"
												: agent.credibility >= 0.4
													? "bg-yellow-500"
													: "bg-red-500",
										)}
										style={{ width: `${agent.credibility * 100}%` }}
									/>
								</div>
							</div>
						)}
						{agent.successRate != null && (
							<div className="text-[10px] text-muted-foreground">
								{agent.successRate}% success rate · {agent.totalRuns ?? 0} runs
							</div>
						)}
					</div>

					{agent.currentIssueId && (
						<div className="rounded-md bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
							Working on{" "}
							<span className="font-mono text-white">
								{agent.currentIssueId}
							</span>
						</div>
					)}
				</div>
			</Card>
		</Link>
	);
}

function Stat({
	label,
	value,
	icon,
}: { label: string; value: string; icon?: ReactNode }) {
	return (
		<div className="rounded-md bg-zinc-900/60 px-3 py-2 text-center">
			<p className="text-xs text-zinc-500">{label}</p>
			<p className="mt-1 flex items-center justify-center gap-1 text-sm font-semibold text-white">
				{icon}
				{value}
			</p>
		</div>
	);
}

function RunModePicker({
	agentId,
	currentMode,
}: { agentId: string; currentMode: AgentRunMode }) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (runMode: AgentRunMode) =>
			api.agents.roster.setMode(agentId, { runMode }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			void queryClient.invalidateQueries({
				queryKey: ["agent-detail", agentId],
			});
		},
	});
	const swallow = (event: SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<Select
			value={currentMode}
			onClick={swallow}
			onMouseDown={(event) => event.stopPropagation()}
			onChange={(event) => {
				event.preventDefault();
				event.stopPropagation();
				mutation.mutate(event.target.value as AgentRunMode);
			}}
			disabled={mutation.isPending}
		>
			<option value="on_demand">On Demand</option>
			<option value="continuous">Continuous (24/7)</option>
			<option value="scheduled">Scheduled</option>
		</Select>
	);
}

function HireAgentModal({
	open,
	onClose,
}: { open: boolean; onClose: () => void }) {
	const queryClient = useQueryClient();
	const [displayName, setDisplayName] = useState("");
	const [templateId, setTemplateId] = useState("");
	const [modelId, setModelId] = useState<string>("auto");
	const [adapterType, setAdapterType] = useState<string>("auto");
	const [templates, setTemplates] = useState<
		{
			id: string;
			name: string;
			description: string;
			agent: string;
			estimated_cost_tier: string;
		}[]
	>([]);
	const [models, setModels] = useState<
		{ id: string; label: string; provider: string; configured: boolean }[]
	>([]);
	const [loadingTemplates, setLoadingTemplates] = useState(true);
	const [templatesError, setTemplatesError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoadingTemplates(true);
		setTemplatesError(null);
		api.agents.templates
			.list()
			.then((data) => {
				if (cancelled) return;
				setTemplates(data as never[]);
				if (data.length > 0) setTemplateId(data[0]!.id);
			})
			.catch((error) => {
				if (cancelled) return;
				setTemplates([]);
				setTemplatesError(
					error instanceof Error ? error.message : String(error),
				);
			})
			.finally(() => {
				if (!cancelled) setLoadingTemplates(false);
			});

		Promise.all([
			api.llm.catalog().catch(() => [] as never[]),
			api.costs.providers().catch(() => [] as never[]),
		]).then(([catalog, providers]) => {
			if (cancelled) return;
			const configured = new Set<string>(
				(Array.isArray(providers) ? providers : [])
					.filter((provider: any) => provider.isConfigured)
					.map((provider: any) => provider.name ?? provider.id),
			);
			const list = [
				{
					id: "auto",
					label: "Auto (recommended — picks best available)",
					provider: "auto",
					configured: true,
				},
			] as {
				id: string;
				label: string;
				provider: string;
				configured: boolean;
			}[];
			for (const model of Array.isArray(catalog) ? catalog : []) {
				list.push({
					id: model.id,
					label: `${model.displayName ?? model.id} (${model.provider})`,
					provider: model.provider ?? "unknown",
					configured: model.provider ? configured.has(model.provider) : false,
				});
			}
			setModels(list);
		});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const hireMutation = useMutation({
		mutationFn: () =>
			api.agents.roster.hire({
				templateId,
				displayName:
					displayName.trim() ||
					templates.find((template) => template.id === templateId)?.name ||
					"Agent",
				modelId: modelId === "auto" ? null : modelId,
				adapterType: adapterType === "auto" ? undefined : adapterType,
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["agents"] });
			onClose();
		},
	});

	const selectedTemplate = templates.find(
		(template) => template.id === templateId,
	);

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="Add an Agent"
			actions={
				<>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => hireMutation.mutate()}
						loading={hireMutation.isPending}
						disabled={!templateId}
					>
						{hireMutation.isPending ? "Adding…" : "Add Agent"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<p className="flex items-center gap-2 text-sm text-zinc-400">
					<Sparkles className="h-4 w-4 text-blue-300" aria-hidden="true" />
					Choose a role template and model for your next agent.
				</p>

				{loadingTemplates ? (
					<Skeleton count={3} />
				) : templatesError ? (
					<p className="text-sm text-red-400">
						Could not load templates: {templatesError}
					</p>
				) : templates.length === 0 ? (
					<EmptyState
						title="No templates available"
						description="Create or sync agent role templates, then try again."
					/>
				) : (
					<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
						{templates.map((template) => (
							<button
								key={template.id}
								type="button"
								onClick={() => setTemplateId(template.id)}
								className={cn(
									"rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
									templateId === template.id
										? "border-blue-500/50 bg-blue-500/10"
										: "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600",
								)}
							>
								<p className="text-sm font-medium text-white">
									{template.name}
								</p>
								<p className="mt-1 text-sm text-zinc-400">
									{template.description}
								</p>
								<Badge
									variant={
										template.estimated_cost_tier === "high"
											? "danger"
											: template.estimated_cost_tier === "medium"
												? "warning"
												: "success"
									}
									className="mt-3"
								>
									{template.estimated_cost_tier} cost
								</Badge>
							</button>
						))}
					</div>
				)}

				<Input
					label="Agent name"
					value={displayName}
					onChange={(event) => setDisplayName(event.target.value)}
					placeholder={selectedTemplate?.name ?? "Agent"}
					helperText="Optional display name shown in the roster."
				/>

				<Select
					label="Model"
					value={modelId}
					onChange={(event) => setModelId(event.target.value)}
					helperText="Use Auto to let Setra pick the best configured provider."
				>
					{models.map((model) => (
						<option
							key={model.id}
							value={model.id}
							disabled={!model.configured && model.id !== "auto"}
						>
							{model.label}
							{!model.configured && model.id !== "auto" ? " — no API key" : ""}
						</option>
					))}
					{models.length === 0 && <option value="auto">Auto</option>}
				</Select>

				<Select
					label="Runner"
					value={adapterType}
					onChange={(event) => setAdapterType(event.target.value)}
					helperText="How the agent executes tasks. Auto picks the best available runner."
				>
					<option value="auto">⚡ Auto (recommended)</option>
					<optgroup label="CLI Agents">
						<option value="claude">Claude Code</option>
						<option value="codex">Codex (OpenAI)</option>
						<option value="gemini">Gemini CLI</option>
						<option value="amp">Amp (Sourcegraph)</option>
						<option value="opencode">OpenCode</option>
					</optgroup>
					<optgroup label="Cloud API">
						<option value="anthropic-api">Anthropic API</option>
						<option value="openai-api">OpenAI API</option>
						<option value="aws-bedrock">AWS Bedrock</option>
						<option value="azure-openai">Azure OpenAI</option>
						<option value="gcp-vertex">GCP Vertex AI</option>
						<option value="custom-openai">Custom OpenAI-compat</option>
					</optgroup>
					<optgroup label="Local / Self-hosted">
						<option value="ollama">Ollama</option>
					</optgroup>
				</Select>

				{hireMutation.isError && (
					<p className="text-sm text-red-400">
						{hireMutation.error instanceof Error
							? hireMutation.error.message
							: "Failed to hire agent"}
					</p>
				)}
			</div>
		</Modal>
	);
}
