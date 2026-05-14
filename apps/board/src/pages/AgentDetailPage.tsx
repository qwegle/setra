import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Bot,
	Check,
	ChevronLeft,
	ExternalLink,
	Loader2,
	MessageSquare,
	Plus,
	Save,
	Send,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AgentActivityStrip } from "../components/AgentActivityStrip";
import { AgentRunCard } from "../components/AgentRunCard";
import { AgentRunLogViewer } from "../components/AgentRunLogViewer";
import { type EnvVar, EnvVarEditor } from "../components/EnvVarEditor";
import { Card } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import {
	type AgentBudgetPolicy,
	type AgentDetail,
	type AgentRun,
	type AgentRunMode,
	api,
	companySettings,
} from "../lib/api";
import {
	cn,
	formatCost,
	formatDuration,
	formatTokens,
	timeAgo,
} from "../lib/utils";

type TabId =
	| "dashboard"
	| "chat"
	| "instructions"
	| "configuration"
	| "skills"
	| "experience"
	| "runs"
	| "budget";

const TABS: { id: TabId; label: string }[] = [
	{ id: "dashboard", label: "Dashboard" },
	{ id: "chat", label: "Chat" },
	{ id: "instructions", label: "Instructions" },
	{ id: "configuration", label: "Configuration" },
	{ id: "skills", label: "Skills" },
	{ id: "experience", label: "Experience" },
	{ id: "runs", label: "Runs" },
	{ id: "budget", label: "Budget" },
];

function statusDot(status: string) {
	const map: Record<string, string> = {
		running: "bg-accent-green animate-pulse",
		idle: "bg-muted-foreground",
		error: "bg-accent-red",
		done: "bg-setra-400",
		completed: "bg-setra-400",
		waiting_approval: "bg-accent-yellow animate-pulse",
		paused: "bg-accent-orange",
		pending: "bg-muted-foreground/50",
	};
	return map[status] ?? "bg-muted-foreground";
}

function statusBadge(status: string) {
	const map: Record<string, string> = {
		running: "bg-accent-green/15 text-accent-green border-accent-green/20",
		idle: "bg-muted text-muted-foreground border-border/30",
		error: "bg-accent-red/15 text-accent-red border-accent-red/20",
		done: "bg-setra-600/15 text-setra-300 border-setra-600/20",
		completed: "bg-setra-600/15 text-setra-300 border-setra-600/20",
		waiting_approval:
			"bg-accent-yellow/15 text-accent-yellow border-accent-yellow/20",
		paused: "bg-accent-orange/15 text-accent-orange border-accent-orange/20",
		pending: "bg-muted text-muted-foreground border-border/30",
	};
	return map[status] ?? "bg-muted text-muted-foreground border-border/30";
}

function Section({
	title,
	children,
}: { title: string; children: React.ReactNode }) {
	return (
		<div className="space-y-3">
			<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
				{title}
			</h3>
			{children}
		</div>
	);
}

function MetricCard({
	label,
	value,
	sub,
}: { label: string; value: string; sub?: string | undefined }) {
	return (
		<div className="glass rounded-xl px-5 py-4 flex flex-col gap-1">
			<p className="text-xs text-muted-foreground/70">{label}</p>
			<p className="text-2xl font-semibold text-foreground">{value}</p>
			{sub && <p className="text-xs text-muted-foreground/50">{sub}</p>}
		</div>
	);
}

function RunStatusBadge({ status }: { status: AgentRun["status"] }) {
	const map: Partial<Record<AgentRun["status"], string>> = {
		running: "text-accent-green",
		done: "text-setra-300",
		completed: "text-setra-300",
		pending: "text-muted-foreground",
		failed: "text-accent-red",
		cancelled: "text-muted-foreground",
	};
	const safeStatus = status ?? "pending";
	return (
		<span
			className={cn(
				"flex items-center gap-1.5 text-xs font-medium",
				map[safeStatus] ?? "text-muted-foreground",
			)}
		>
			<span className={cn("w-1.5 h-1.5 rounded-full", statusDot(safeStatus))} />
			{String(safeStatus).charAt(0).toUpperCase() + String(safeStatus).slice(1)}
		</span>
	);
}

export function AgentDetailPage() {
	const { agentId = "", tab = "dashboard" } = useParams<{
		agentId: string;
		tab?: string;
	}>();
	const navigate = useNavigate();
	const activeTab = (
		TABS.find((t) => t.id === tab) ? tab : "dashboard"
	) as TabId;

	function goTab(t: TabId) {
		navigate(`/agents/${agentId}/${t}`, { replace: true });
	}

	const { data: agent, isLoading } = useQuery({
		queryKey: ["agent-detail", agentId],
		queryFn: () => api.agentDetail.get(agentId),
		refetchInterval: 15_000,
	});
	const { data: experience } = useQuery({
		queryKey: ["agent-experience", agentId],
		queryFn: () => api.agentDetail.getExperience(agentId),
		enabled: Boolean(agentId),
	});

	if (isLoading) {
		return (
			<div className="space-y-5 animate-pulse">
				<div className="h-8 glass rounded-lg w-64" />
				<div className="h-24 glass rounded-xl" />
				<div className="h-64 glass rounded-xl" />
			</div>
		);
	}

	if (!agent) {
		return (
			<div className="glass rounded-xl py-20 flex flex-col items-center justify-center gap-4 text-center">
				<Bot className="w-10 h-10 text-muted-foreground/30" />
				<p className="text-sm text-muted-foreground">Agent not found</p>
				<Link
					to="/agents"
					className="text-sm text-setra-400 hover:text-setra-300"
				>
					Back to Agents
				</Link>
			</div>
		);
	}

	return (
		<div className="space-y-0">
			{/* Back */}
			<Link
				to="/agents"
				className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground mb-4 transition-colors"
			>
				<ChevronLeft className="w-3.5 h-3.5" />
				Agents
			</Link>

			{/* Header */}
			<div className="flex items-start justify-between mb-5">
				<div className="flex items-center gap-4">
					<div className="p-3 rounded-2xl bg-setra-600/10 border border-setra-600/20">
						<Bot className="w-7 h-7 text-setra-400" />
					</div>
					<div>
						<h1 className="text-xl font-semibold text-foreground">
							{agent.displayName || agent.role || agent.slug}
						</h1>
						<p className="text-sm text-muted-foreground mt-0.5">
							{agent.adapterType} · {agent.modelId ?? agent.model}
						</p>
					</div>
				</div>
				<span
					className={cn(
						"inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border",
						statusBadge(agent.status),
					)}
				>
					<span
						className={cn("w-1.5 h-1.5 rounded-full", statusDot(agent.status))}
					/>
					{String(agent.status ?? "idle")
						.charAt(0)
						.toUpperCase() + String(agent.status ?? "idle").slice(1)}
				</span>
			</div>

			{/* Live activity — pushed via SSE so the user always sees what
			    the agent is doing right now, regardless of which tab is open. */}
			<AgentActivityStrip agentId={agentId} variant="full" className="mb-6" />

			{/* Tab bar */}
			<div className="flex gap-0.5 border-b border-border/50 mb-6">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => goTab(t.id)}
						className={cn(
							"px-3 py-2 text-sm font-medium rounded-t-md transition-colors",
							activeTab === t.id
								? "text-foreground border-b-2 border-setra-400 -mb-px"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* Tab content */}
			{activeTab === "dashboard" && (
				<DashboardTab agent={agent} agentId={agentId} />
			)}
			{activeTab === "chat" && <ChatTab agent={agent} agentId={agentId} />}
			{activeTab === "instructions" && (
				<InstructionsTab agent={agent} agentId={agentId} />
			)}
			{activeTab === "configuration" && (
				<ConfigurationTab agent={agent} agentId={agentId} />
			)}
			{activeTab === "skills" && <SkillsTab agent={agent} agentId={agentId} />}
			{activeTab === "experience" && <ExperienceTab experience={experience} />}
			{activeTab === "runs" && <RunsTab agentId={agentId} />}
			{activeTab === "budget" && <BudgetTab agentId={agentId} />}
		</div>
	);
}

function ExperienceTab({
	experience,
}: {
	experience:
		| Awaited<ReturnType<typeof api.agentDetail.getExperience>>
		| undefined;
}) {
	return (
		<div className="space-y-6">
			<Card>
				<div className="flex items-center gap-4">
					<div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-accent-blue/30 bg-gradient-to-br from-accent-blue/20 to-purple-500/20">
						<span className="text-2xl">🧠</span>
					</div>
					<div>
						<div className="text-lg font-bold">
							{experience?.level || "Novice"}
						</div>
						<div className="text-sm text-muted-foreground">
							{experience?.totalReflections || 0} completed tasks
						</div>
						<div className="text-sm text-muted-foreground">
							Credibility: {((experience?.credibility ?? 0.5) * 100).toFixed(0)}
							% · {experience?.successes ?? 0} successes,{" "}
							{experience?.failures ?? 0} failures
						</div>
					</div>
				</div>
			</Card>

			<Card title="Skills & Expertise">
				<div className="space-y-3">
					{(experience?.skills || []).map((skill) => (
						<div key={skill.name} className="space-y-1">
							<div className="flex justify-between text-sm">
								<span className="capitalize">{skill.name}</span>
								<span className="text-muted-foreground">
									{skill.successRate}% ({skill.total} tasks)
								</span>
							</div>
							<div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
								<div
									className="h-full rounded-full bg-accent-blue transition-all"
									style={{ width: `${skill.successRate}%` }}
								/>
							</div>
						</div>
					))}
					{(!experience?.skills || experience.skills.length === 0) && (
						<p className="text-sm text-muted-foreground">
							No skills tracked yet. Skills are detected from task titles after
							runs complete.
						</p>
					)}
				</div>
			</Card>

			{(experience?.trend?.length ?? 0) > 0 && (
				<Card title="Success Rate Trend">
					<div className="flex h-24 items-end gap-2">
						{experience?.trend.map((rate, index) => (
							<div
								key={`${rate}-${index}`}
								className="flex flex-1 flex-col items-center gap-1"
							>
								<div
									className="w-full rounded-t bg-accent-blue/60"
									style={{ height: `${rate}%` }}
								/>
								<span className="text-[9px] text-muted-foreground">
									{rate}%
								</span>
							</div>
						))}
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						Grouped by 5 runs, most recent first
					</p>
				</Card>
			)}

			<Card title="Recent Learnings">
				<div className="space-y-3">
					{(experience?.recent || []).map((reflection) => (
						<div
							key={reflection.id}
							className="rounded-lg border border-border/20 bg-surface-2/50 p-3"
						>
							<div className="mb-1 flex items-center gap-2">
								<span>
									{reflection.outcome === "success"
										? "✅"
										: reflection.outcome === "failed"
											? "❌"
											: "⚠️"}
								</span>
								<span className="text-xs text-muted-foreground">
									{timeAgo(reflection.createdAt)}
								</span>
								<div className="ml-auto flex gap-1">
									{reflection.skillTags.map((tag) => (
										<span
											key={tag}
											className="rounded bg-surface-3 px-1.5 py-0.5 text-[9px] text-muted-foreground"
										>
											{tag}
										</span>
									))}
								</div>
							</div>
							<p className="text-sm">{reflection.reflection}</p>
							{reflection.lessonsLearned && (
								<p className="mt-1 text-xs text-muted-foreground">
									💡 {reflection.lessonsLearned}
								</p>
							)}
						</div>
					))}
					{(!experience?.recent || experience.recent.length === 0) && (
						<p className="text-sm text-muted-foreground">
							No learnings tracked yet. Reflections appear after runs complete.
						</p>
					)}
				</div>
			</Card>
		</div>
	);
}

function DashboardTab({
	agent,
	agentId,
}: { agent: AgentDetail; agentId: string }) {
	const navigate = useNavigate();
	const { data: runs = [] } = useQuery({
		queryKey: ["agent-runs", agentId],
		queryFn: () => api.agentDetail.getRuns(agentId),
		refetchInterval: 15_000,
	});

	const latestRun = runs[0] ?? null;
	const recentRuns = runs.slice(0, 10);
	const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);

	return (
		<div className="space-y-6">
			{/* Metric cards */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<MetricCard label="Total Runs" value={String(agent.totalRuns)} />
				<MetricCard label="Total Cost" value={formatCost(totalCost)} />
				<MetricCard
					label="Avg Duration"
					value={formatDuration(agent.avgDurationMs)}
					sub={agent.avgDurationMs ? "per run" : undefined}
				/>
			</div>

			{/* Latest run */}
			{latestRun && (
				<div className="glass rounded-xl p-4 space-y-3">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
						Latest Run
					</h3>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="flex items-center gap-3 min-w-0">
							<RunStatusBadge status={latestRun.status} />
							<span className="text-sm text-foreground truncate">
								{latestRun.issueTitle ?? "Untitled run"}
							</span>
							<span className="text-xs text-muted-foreground/50">
								{timeAgo(latestRun.startedAt)}
							</span>
						</div>
						<div className="flex items-center gap-4 text-xs text-muted-foreground/60">
							<span>
								{formatTokens(latestRun.inputTokens + latestRun.outputTokens)}{" "}
								tok
							</span>
							<span>{formatCost(latestRun.costUsd)}</span>
							<button
								type="button"
								onClick={() => navigate(`/agents/${agentId}/runs`)}
								className="flex items-center gap-1 text-setra-400 hover:text-setra-300 transition-colors text-xs"
							>
								View logs <ChevronLeft className="w-3 h-3 rotate-180" />
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Recent runs table */}
			{recentRuns.length > 0 && (
				<div className="glass rounded-xl overflow-hidden">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border/40">
								{["Status", "Issue", "Duration", "Tokens", "Cost", "Time"].map(
									(h) => (
										<th
											key={h}
											className="px-4 py-3 text-left text-xs font-medium text-muted-foreground/60 uppercase tracking-wide"
										>
											{h}
										</th>
									),
								)}
							</tr>
						</thead>
						<tbody className="divide-y divide-border/20">
							{recentRuns.map((run) => (
								<tr
									key={run.id}
									className="hover:bg-setra-600/5 cursor-pointer transition-colors"
									onClick={() => navigate(`/agents/${agentId}/runs`)}
								>
									<td className="px-4 py-3">
										<RunStatusBadge status={run.status} />
									</td>
									<td className="px-4 py-3 text-foreground/80 max-w-[200px] truncate">
										{run.issueTitle ?? "—"}
									</td>
									<td className="px-4 py-3 text-muted-foreground/70">
										{formatDuration(run.durationMs)}
									</td>
									<td className="px-4 py-3 text-muted-foreground/70">
										{formatTokens(run.inputTokens + run.outputTokens)}
									</td>
									<td className="px-4 py-3 text-muted-foreground/70">
										{formatCost(run.costUsd)}
									</td>
									<td className="px-4 py-3 text-muted-foreground/50 text-xs">
										{timeAgo(run.startedAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{runs.length === 0 && (
				<div className="glass rounded-xl py-12 flex flex-col items-center justify-center gap-3 text-center">
					<Bot className="w-8 h-8 text-muted-foreground/30" />
					<p className="text-sm text-muted-foreground">No runs yet</p>
				</div>
			)}
		</div>
	);
}

function InstructionsTab({
	agent,
	agentId,
}: { agent: AgentDetail; agentId: string }) {
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState(agent.systemPrompt ?? "");
	const [saved, setSaved] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [genError, setGenError] = useState<string | null>(null);
	const isDirty = prompt !== (agent.systemPrompt ?? "");

	const mutation = useMutation({
		mutationFn: (value: string) =>
			api.agentDetail.update(agentId, { systemPrompt: value }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["agent-detail", agentId] });
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		},
	});

	const handleGenerate = async () => {
		setGenerating(true);
		setGenError(null);
		try {
			const settings = await companySettings.get().catch(() => null);
			const reqBody: {
				role: string;
				companyGoal?: string;
				companyName?: string;
			} = {
				role: agent.role ?? "agent",
			};
			if (settings?.goal) reqBody.companyGoal = settings.goal;
			if (settings?.name) reqBody.companyName = settings.name;
			const generated = await api.agents.generateInstructions(reqBody);
			setPrompt(generated.instructions);
		} catch (err) {
			setGenError(err instanceof Error ? err.message : String(err));
		} finally {
			setGenerating(false);
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium text-foreground">System Prompt</h3>
					<p className="text-xs text-muted-foreground/60 mt-0.5">
						Instructions sent to the agent at the start of every conversation.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleGenerate}
						disabled={generating}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 hover:bg-muted/50 text-foreground text-xs font-medium transition-colors disabled:opacity-50"
					>
						{generating ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : null}
						{generating ? "Generating…" : "Generate with AI"}
					</button>
					{isDirty && (
						<button
							type="button"
							onClick={() => mutation.mutate(prompt)}
							disabled={mutation.isPending}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-setra-600/20 hover:bg-setra-600/30 text-setra-300 text-xs font-medium transition-colors disabled:opacity-50"
						>
							{mutation.isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Save className="w-3.5 h-3.5" />
							)}
							Save
						</button>
					)}
					{saved && !isDirty && (
						<span className="flex items-center gap-1.5 text-xs text-accent-green">
							<Check className="w-3.5 h-3.5" />
							Saved
						</span>
					)}
				</div>
			</div>
			<textarea
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
				rows={20}
				className={cn(
					"w-full rounded-lg border border-border/50 bg-card/40",
					"px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/40",
					"focus:outline-none focus:ring-1 focus:ring-setra-500/50 focus:border-setra-500/50",
					"resize-none leading-relaxed",
				)}
				placeholder="Enter system prompt…"
			/>
			{genError && (
				<p className="text-xs text-accent-red">Generate failed: {genError}</p>
			)}
			{mutation.isError && (
				<p className="text-xs text-accent-red">
					Failed to save: {String(mutation.error)}
				</p>
			)}
		</div>
	);
}

const LOCAL_CLI_ADAPTERS = ["claude_local", "openai_local", "local_cli"];
const HTTP_ADAPTERS = ["http", "openai_http", "anthropic_http"];
const ALL_ADAPTERS: { value: string; label: string }[] = [
	{ value: "anthropic-api", label: "Anthropic API (server)" },
	{ value: "openai-api", label: "OpenAI API (server)" },
	{ value: "openrouter", label: "OpenRouter (server)" },
	{ value: "groq", label: "Groq (server)" },
	{ value: "ollama", label: "Ollama (local HTTP)" },
	{ value: "claude", label: "Claude CLI (desktop)" },
	{ value: "codex", label: "Codex CLI (desktop)" },
	{ value: "gemini", label: "Gemini CLI (desktop)" },
	{ value: "azure-openai", label: "Azure OpenAI" },
	{ value: "aws-bedrock", label: "AWS Bedrock" },
	{ value: "gcp-vertex", label: "GCP Vertex" },
];
const AGENT_MODES: { value: string; label: string; hint: string }[] = [
	{ value: "write", label: "Write", hint: "Full edit + commit + run shell" },
	{
		value: "read_only",
		label: "Read only",
		hint: "Can read code but not modify",
	},
	{ value: "plan", label: "Plan", hint: "Drafts plans, never executes" },
	{ value: "conversation", label: "Conversation", hint: "Chat only, no tools" },
];
const RUN_MODE_OPTIONS: Array<{ value: AgentRunMode; label: string }> = [
	{ value: "on_demand", label: "On Demand" },
	{ value: "continuous", label: "Continuous (24/7)" },
	{ value: "scheduled", label: "Scheduled" },
];
const CONTINUOUS_INTERVAL_OPTIONS = [
	{ value: 30_000, label: "30s" },
	{ value: 60_000, label: "1m" },
	{ value: 5 * 60_000, label: "5m" },
	{ value: 15 * 60_000, label: "15m" },
	{ value: 30 * 60_000, label: "30m" },
	{ value: 60 * 60_000, label: "1h" },
];

function ConfigurationTab({
	agent,
	agentId,
}: { agent: AgentDetail; agentId: string }) {
	const queryClient = useQueryClient();

	// Env vars state — be defensive: backend may return null, undefined, an object, or a JSON-encoded string.
	const initialEnvVars: Record<string, string> = (() => {
		const raw = agent.envVars as unknown;
		if (raw == null) return {};
		if (typeof raw === "string") {
			try {
				return JSON.parse(raw) || {};
			} catch {
				return {};
			}
		}
		if (typeof raw === "object") return raw as Record<string, string>;
		return {};
	})();
	const [envVars, setEnvVars] = useState<EnvVar[]>(
		Object.entries(initialEnvVars).map(([key, value]) => ({
			key,
			value: String(value ?? ""),
		})),
	);
	const [envSaved, setEnvSaved] = useState(false);

	// Permissions state
	const PERMISSION_OPTIONS = [
		{ id: "file_write", label: "File write" },
		{ id: "network", label: "Network access" },
		{ id: "pr_creation", label: "PR creation" },
		{ id: "require_approval", label: "Require approval for all actions" },
	];
	const [permissions, setPermissions] = useState<Set<string>>(
		new Set(agent.allowedPermissions ?? []),
	);
	const [permSaved, setPermSaved] = useState(false);

	// Claude login state
	const [loginResult, setLoginResult] = useState<{
		loginUrl: string;
		stdout?: string;
		stderr?: string;
	} | null>(null);

	const updateMutation = useMutation({
		mutationFn: (data: Partial<AgentDetail>) =>
			api.agentDetail.update(agentId, data),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["agent-detail", agentId] }),
	});

	const saveEnvVars = async () => {
		const envObj: Record<string, string> = {};
		envVars.forEach(({ key, value }) => {
			if (key) envObj[key] = value;
		});
		await updateMutation.mutateAsync({ envVars: envObj });
		setEnvSaved(true);
		setTimeout(() => setEnvSaved(false), 2000);
	};

	const savePermissions = async () => {
		await updateMutation.mutateAsync({
			allowedPermissions: Array.from(permissions),
		});
		setPermSaved(true);
		setTimeout(() => setPermSaved(false), 2000);
	};

	const isLocalCli = LOCAL_CLI_ADAPTERS.includes(agent.adapterType);
	const isHttp = HTTP_ADAPTERS.includes(agent.adapterType);
	const isClaudeLocal = agent.adapterType === "claude_local";
	const runMode = agent.runMode ?? "on_demand";
	const [scheduledCron, setScheduledCron] = useState("0 9 * * *");

	const claudeLoginMutation = useMutation({
		mutationFn: () => api.agentDetail.loginWithClaude(agentId),
		onSuccess: (data) => setLoginResult(data),
	});

	return (
		<div className="space-y-8 max-w-2xl">
			{/* Adapter info */}
			<Section title="Adapter">
				<div className="glass rounded-xl p-4 space-y-3">
					<div>
						<label className="block text-xs text-muted-foreground/70 mb-1">
							Adapter type
						</label>
						<select
							value={agent.adapterType ?? ""}
							onChange={(e) =>
								updateMutation.mutate({ adapterType: e.target.value })
							}
							className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
						>
							<option value="">— select —</option>
							{ALL_ADAPTERS.map((a) => (
								<option key={a.value} value={a.value}>
									{a.label}
								</option>
							))}
						</select>
						{!agent.adapterType || agent.adapterType === "openrouter" ? (
							<p className="text-[11px] text-amber-500/80 mt-1">
								Auto-picked from your connected providers. Choose explicitly to
								lock it.
							</p>
						) : null}
					</div>
					<div>
						<label className="mb-1 block text-xs text-muted-foreground/70">
							Model
						</label>
						<div className="flex items-center gap-2">
							<span className="flex-1 rounded-md border border-border/50 bg-card/40 px-3 py-2 font-mono text-foreground text-sm">
								{agent.modelId && agent.modelId !== "auto"
									? agent.modelId
									: agent.adapterType === "codex"
										? "gpt-5.5 (default)"
										: agent.adapterType === "claude"
											? "auto (smart selection)"
											: agent.model ?? "auto (smart selection)"}
							</span>
						</div>
						<p className="mt-1 text-[11px] text-muted-foreground/60">
							Models are configured globally in Settings → AI Providers. When
							set to "auto", Setra picks the best model based on task complexity
							— cheaper models for simple tasks, premium models for complex
							ones.
						</p>
					</div>
					<div>
						<label className="block text-xs text-muted-foreground/70 mb-1">
							Mode
						</label>
						<select
							value={(agent as AgentDetail & { mode?: string }).mode ?? "write"}
							onChange={(e) =>
								updateMutation.mutate({
									mode: e.target.value,
								} as Partial<AgentDetail>)
							}
							className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
						>
							{AGENT_MODES.map((m) => (
								<option key={m.value} value={m.value}>
									{m.label} — {m.hint}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="block text-xs text-muted-foreground/70 mb-1">
							Autonomy level
						</label>
						<select
							value={agent.autonomyLevel ?? "semi"}
							onChange={(e) => {
								const autonomyLevel = e.target.value as NonNullable<
									AgentDetail["autonomyLevel"]
								>;
								updateMutation.mutate({
									autonomyLevel,
								} as Partial<AgentDetail>);
							}}
							className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
						>
							<option value="none">None — Manual only</option>
							<option value="basic">Basic — Auto-continue &amp; build</option>
							<option value="plus">Plus — Smart context, can execute</option>
							<option value="semi">Semi — Auto-loads context (Default)</option>
							<option value="full">Full — Complete autopilot</option>
						</select>
					</div>
					<div>
						<label className="block text-xs text-muted-foreground/70 mb-1">
							Run mode
						</label>
						<select
							value={runMode}
							onChange={(e) =>
								updateMutation.mutate({
									runMode: e.target.value as AgentRunMode,
								})
							}
							className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
						>
							{RUN_MODE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					{runMode === "continuous" && (
						<>
							<div>
								<label className="block text-xs text-muted-foreground/70 mb-1">
									Check interval
								</label>
								<select
									value={String(agent.continuousIntervalMs ?? 60_000)}
									onChange={(e) =>
										updateMutation.mutate({
											continuousIntervalMs: Number(e.target.value),
										})
									}
									className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
								>
									{CONTINUOUS_INTERVAL_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="block text-xs text-muted-foreground/70 mb-1">
									Idle prompt
								</label>
								<textarea
									defaultValue={agent.idlePrompt ?? ""}
									onBlur={(e) =>
										updateMutation.mutate({ idlePrompt: e.target.value })
									}
									rows={5}
									className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
									placeholder="Tell the agent what to do when there are no assigned issues."
								/>
								<p className="mt-1 text-[11px] text-muted-foreground/60">
									Used for background monitoring runs when the queue is empty.
								</p>
							</div>
						</>
					)}
					{runMode === "scheduled" && (
						<div>
							<label className="block text-xs text-muted-foreground/70 mb-1">
								Cron schedule
							</label>
							<input
								type="text"
								value={scheduledCron}
								onChange={(e) => setScheduledCron(e.target.value)}
								className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
								placeholder="0 9 * * *"
							/>
							<p className="mt-1 text-[11px] text-muted-foreground/60">
								Scheduler persistence is coming next; for now this acts as a
								planning placeholder.
							</p>
						</div>
					)}
				</div>
			</Section>

			{/* Command (local CLI) */}
			{isLocalCli && (
				<Section title="Command">
					<div className="glass rounded-xl p-4 space-y-3">
						<div>
							<label className="block text-xs text-muted-foreground/70 mb-1">
								Command
							</label>
							<input
								type="text"
								defaultValue={agent.command ?? ""}
								onBlur={(e) =>
									updateMutation.mutate({ command: e.target.value })
								}
								className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
								placeholder="e.g. claude"
							/>
						</div>
						<div>
							<label className="block text-xs text-muted-foreground/70 mb-1">
								Arguments
							</label>
							<input
								type="text"
								defaultValue={agent.commandArgs ?? ""}
								onBlur={(e) =>
									updateMutation.mutate({ commandArgs: e.target.value })
								}
								className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
								placeholder="e.g. --api-key $ANTHROPIC_API_KEY"
							/>
						</div>
					</div>
				</Section>
			)}

			{/* Connection (HTTP) */}
			{isHttp && (
				<Section title="Connection">
					<div className="glass rounded-xl p-4">
						<label className="block text-xs text-muted-foreground/70 mb-1">
							URL
						</label>
						<input
							type="url"
							defaultValue={agent.httpUrl ?? ""}
							onBlur={(e) => updateMutation.mutate({ httpUrl: e.target.value })}
							className="w-full px-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
							placeholder="https://…"
						/>
					</div>
				</Section>
			)}

			{/* Environment variables */}
			<Section title="Environment Variables">
				<div className="glass rounded-xl p-4 space-y-3">
					<p className="text-xs text-muted-foreground/50">
						Available to this agent only. Values are masked at rest.
					</p>
					<EnvVarEditor vars={envVars} onChange={setEnvVars} />
					<div className="flex items-center gap-3 pt-1">
						<button
							type="button"
							onClick={saveEnvVars}
							disabled={updateMutation.isPending}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-setra-600/20 hover:bg-setra-600/30 text-setra-300 text-xs font-medium transition-colors disabled:opacity-50"
						>
							{updateMutation.isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Save className="w-3.5 h-3.5" />
							)}
							Save env vars
						</button>
						{envSaved && (
							<span className="flex items-center gap-1 text-xs text-accent-green">
								<Check className="w-3.5 h-3.5" /> Saved
							</span>
						)}
					</div>
				</div>
			</Section>

			{/* Permissions */}
			<Section title="Permissions">
				<div className="glass rounded-xl p-4 space-y-3">
					{PERMISSION_OPTIONS.map((opt) => (
						<label
							key={opt.id}
							className="flex items-center gap-3 cursor-pointer group"
						>
							<input
								type="checkbox"
								checked={permissions.has(opt.id)}
								onChange={(e) => {
									const next = new Set(permissions);
									e.target.checked ? next.add(opt.id) : next.delete(opt.id);
									setPermissions(next);
								}}
								className="w-4 h-4 rounded border-border/50 accent-setra-400"
							/>
							<span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors">
								{opt.label}
							</span>
						</label>
					))}
					<div className="flex items-center gap-3 pt-1">
						<button
							type="button"
							onClick={savePermissions}
							disabled={updateMutation.isPending}
							className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-setra-600/20 hover:bg-setra-600/30 text-setra-300 text-xs font-medium transition-colors disabled:opacity-50"
						>
							{updateMutation.isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Save className="w-3.5 h-3.5" />
							)}
							Save permissions
						</button>
						{permSaved && (
							<span className="flex items-center gap-1 text-xs text-accent-green">
								<Check className="w-3.5 h-3.5" /> Saved
							</span>
						)}
					</div>
				</div>
			</Section>

			{/* Anthropic API key (for claude_local adapter) */}
			{isClaudeLocal && <AnthropicKeySection />}
		</div>
	);
}

function AnthropicKeySection() {
	const [key, setKey] = useState("");
	const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
		"idle",
	);
	const [error, setError] = useState<string | null>(null);

	const handleSave = async () => {
		if (!key.trim()) return;
		setStatus("saving");
		setError(null);
		try {
			await companySettings.setKey("anthropic", key.trim());
			setStatus("saved");
			setKey("");
			setTimeout(() => setStatus("idle"), 2000);
		} catch (err) {
			setStatus("error");
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<Section title="Anthropic API Key">
			<div className="glass rounded-xl p-5 space-y-3">
				<p className="text-xs text-muted-foreground/70">
					Enter your API key from{" "}
					<a
						href="https://console.anthropic.com"
						target="_blank"
						rel="noreferrer"
						className="text-setra-400 hover:underline"
					>
						console.anthropic.com
					</a>
				</p>
				<div className="flex items-center gap-2">
					<input
						type="password"
						placeholder="sk-ant-..."
						value={key}
						onChange={(e) => setKey(e.target.value)}
						className="flex-1 bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors"
					/>
					<button
						type="button"
						onClick={handleSave}
						disabled={status === "saving" || !key.trim()}
						className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-setra-600/20 hover:bg-setra-600/30 text-setra-300 text-xs font-medium transition-colors disabled:opacity-50"
					>
						{status === "saving" ? (
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
						) : (
							<Save className="w-3.5 h-3.5" />
						)}
						Save
					</button>
				</div>
				{status === "saved" && (
					<p className="text-xs text-accent-green flex items-center gap-1">
						<Check className="w-3.5 h-3.5" /> Saved
					</p>
				)}
				{status === "error" && error && (
					<p className="text-xs text-accent-red">Failed: {error}</p>
				)}
			</div>
		</Section>
	);
}

function LabeledField({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span className="text-xs text-muted-foreground/60">{label}</span>
			<p className="text-sm font-mono text-foreground mt-0.5">{value}</p>
		</div>
	);
}

function SkillsTab({
	agent,
	agentId,
}: { agent: AgentDetail; agentId: string }) {
	const [query, setQuery] = useState("");
	const [showAllSkills, setShowAllSkills] = useState(false);
	const queryClient = useQueryClient();
	const roleHint = `${agent.role ?? ""} ${agent.slug ?? ""}`.toLowerCase();
	const recommendedRole =
		/(dev|engineer|frontend|backend|fullstack|coder)/.test(roleHint)
			? "developer"
			: "general";
	const { data: allSkills = [] } = useQuery({
		queryKey: ["skills-library", showAllSkills, recommendedRole],
		queryFn: () =>
			showAllSkills
				? api.skills.library()
				: api.skills.recommended({ role: recommendedRole, limit: 50 }),
	});

	const attachedIds = new Set((agent.skills ?? []).map((s) => s.id));
	const filteredSkills = allSkills.filter((s) => {
		if (!query.trim()) return true;
		const q = query.toLowerCase();
		return (
			s.name.toLowerCase().includes(q) ||
			(s.description ?? "").toLowerCase().includes(q) ||
			s.slug.toLowerCase().includes(q)
		);
	});

	const mutation = useMutation({
		mutationFn: ({ skillId, attach }: { skillId: string; attach: boolean }) => {
			const skills = attach
				? [
						...(agent.skills ?? []),
						allSkills.find((s) => s.id === skillId)!,
					].filter(Boolean)
				: (agent.skills ?? []).filter((s) => s.id !== skillId);
			return api.agentDetail.update(agentId, {
				skills,
			} as Partial<AgentDetail>);
		},
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["agent-detail", agentId] }),
	});

	return (
		<div className="space-y-6">
			{/* Attached skills */}
			<Section title="Attached Skills">
				<div className="flex flex-wrap gap-2 min-h-[40px]">
					{(agent.skills ?? []).length === 0 && (
						<p className="text-xs text-muted-foreground/50 italic self-center">
							No skills attached
						</p>
					)}
					{(agent.skills ?? []).map((skill) => (
						<span
							key={skill.id}
							className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-setra-600/15 text-setra-300 border border-setra-600/20 text-xs font-medium"
						>
							{skill.name}
							<button
								type="button"
								onClick={() =>
									mutation.mutate({ skillId: skill.id, attach: false })
								}
								className="hover:text-accent-red transition-colors ml-0.5"
							>
								<X className="w-3 h-3" />
							</button>
						</span>
					))}
				</div>
			</Section>

			{/* Skill library */}
			{allSkills.length > 0 && (
				<Section title="Skill Library">
					<div className="mb-3 space-y-2">
						<div className="flex items-center gap-2">
							<input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search skills by name, slug, description…"
								className="flex-1 bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors"
							/>
							<button
								type="button"
								onClick={() => setShowAllSkills((v) => !v)}
								className="px-2.5 py-2 text-xs rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40"
							>
								{showAllSkills ? "Focused" : "All"}
							</button>
						</div>
						<p className="text-[11px] text-muted-foreground/70">
							{showAllSkills
								? "Showing full skill library."
								: "Showing focused recommendations for this role."}
						</p>
					</div>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{filteredSkills.map((skill) => {
							const attached = attachedIds.has(skill.id);
							return (
								<button
									key={skill.id}
									type="button"
									onClick={() =>
										mutation.mutate({ skillId: skill.id, attach: !attached })
									}
									className={cn(
										"text-left rounded-xl p-4 border transition-all",
										attached
											? "bg-setra-600/10 border-setra-600/30"
											: "glass border-border/40 hover:border-setra-600/20",
									)}
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="text-sm font-medium text-foreground">
												{skill.name}
											</p>
											<p className="text-xs text-muted-foreground/60 mt-0.5 line-clamp-2">
												{skill.description}
											</p>
										</div>
										{attached ? (
											<Check className="w-4 h-4 text-setra-400 flex-shrink-0 mt-0.5" />
										) : (
											<Plus className="w-4 h-4 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
										)}
									</div>
								</button>
							);
						})}
					</div>
				</Section>
			)}
		</div>
	);
}

function RunsTab({ agentId }: { agentId: string }) {
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [visibleCount, setVisibleCount] = useState(20);

	const { data: runs = [], isLoading } = useQuery({
		queryKey: ["agent-runs", agentId],
		queryFn: () => api.agentDetail.getRuns(agentId),
		refetchInterval: 10_000,
	});

	const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

	if (isLoading) {
		return (
			<div className="space-y-3">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-16 glass rounded-lg animate-pulse" />
				))}
			</div>
		);
	}

	return (
		<div className="flex gap-5 h-[calc(100vh-280px)] min-h-[400px]">
			{/* Left: run list */}
			<div className="w-80 flex-shrink-0 flex flex-col gap-2 overflow-y-auto pr-1">
				{runs.length === 0 && (
					<div className="glass rounded-xl py-10 flex flex-col items-center gap-2 text-center">
						<Bot className="w-7 h-7 text-muted-foreground/30" />
						<p className="text-xs text-muted-foreground">No runs yet</p>
					</div>
				)}
				{runs.slice(0, visibleCount).map((run) => (
					<AgentRunCard
						key={run.id}
						run={run}
						isSelected={run.id === selectedRunId}
						onClick={() => setSelectedRunId(run.id)}
					/>
				))}
				{runs.length > visibleCount && (
					<button
						type="button"
						onClick={() => setVisibleCount((c) => c + 20)}
						className="text-xs text-setra-400 hover:text-setra-300 py-2 text-center transition-colors"
					>
						Load more ({runs.length - visibleCount} remaining)
					</button>
				)}
			</div>

			{/* Right: log viewer or empty state */}
			<div className="flex-1 min-w-0">
				{selectedRun ? (
					<div className="space-y-3 h-full flex flex-col">
						{/* Run meta */}
						<div className="glass rounded-xl p-4">
							<div className="flex items-center justify-between flex-wrap gap-3">
								<div className="flex items-center gap-3">
									<RunStatusBadge status={selectedRun.status} />
									<span className="text-sm font-medium text-foreground">
										{selectedRun.issueTitle ?? "Untitled run"}
									</span>
								</div>
								<div className="flex items-center gap-4 text-xs text-muted-foreground/60">
									<span>Started {timeAgo(selectedRun.startedAt)}</span>
									<span>{formatDuration(selectedRun.durationMs)}</span>
									<span>
										{formatTokens(
											selectedRun.inputTokens + selectedRun.outputTokens,
										)}{" "}
										tok
									</span>
									<span className="font-medium text-muted-foreground">
										{formatCost(selectedRun.costUsd)}
									</span>
								</div>
							</div>
						</div>
						{/* Log viewer */}
						<div className="flex-1">
							<AgentRunLogViewer
								agentId={agentId}
								runId={selectedRun.id}
								isLive={selectedRun.status === "running"}
							/>
						</div>
					</div>
				) : (
					<div className="glass rounded-xl h-full flex flex-col items-center justify-center gap-3 text-center">
						<Bot className="w-8 h-8 text-muted-foreground/30" />
						<p className="text-sm text-muted-foreground">
							Select a run to view logs
						</p>
					</div>
				)}
			</div>
		</div>
	);
}

type BudgetPeriod = AgentBudgetPolicy["period"];

function BudgetTab({ agentId }: { agentId: string }) {
	const queryClient = useQueryClient();

	const { data: budget, isLoading } = useQuery({
		queryKey: ["agent-budget", agentId],
		queryFn: () => api.agentDetail.getBudget(agentId),
	});

	const [period, setPeriod] = useState<BudgetPeriod>("weekly");
	const [limitStr, setLimitStr] = useState<string>("");
	const [showForm, setShowForm] = useState(false);
	const [saved, setSaved] = useState(false);

	// Sync form from fetched data
	useEffect(() => {
		if (budget) {
			setPeriod(budget.period);
			setLimitStr(String(budget.limitUsd));
			setShowForm(true);
		}
	}, [budget]);

	const mutation = useMutation({
		mutationFn: () =>
			api.agentDetail.setBudget(agentId, {
				scope: "agent",
				period,
				limitUsd: Number.parseFloat(limitStr) || 0,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["agent-budget", agentId] });
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		},
	});

	if (isLoading) {
		return <div className="h-32 glass rounded-xl animate-pulse" />;
	}

	const spentUsd = budget?.spentUsd ?? 0;
	const limitUsd = budget?.limitUsd ?? (Number.parseFloat(limitStr) || 0);
	const spendPct = limitUsd > 0 ? (spentUsd / limitUsd) * 100 : 0;

	const barColor =
		spendPct > 90
			? "bg-accent-red"
			: spendPct > 70
				? "bg-accent-yellow"
				: "bg-setra-400";

	return (
		<div className="space-y-6 max-w-lg">
			{/* Policy card */}
			<Section title="Spend Limit">
				<div className="glass rounded-xl p-5 space-y-4">
					{!showForm && !budget ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground/70">
								No spend limit set for this agent.
							</p>
							<button
								type="button"
								onClick={() => setShowForm(true)}
								className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-setra-600/20 hover:bg-setra-600/30 text-setra-300 text-xs font-medium transition-colors"
							>
								<Plus className="w-3.5 h-3.5" />
								Add limit
							</button>
						</div>
					) : (
						<div className="space-y-4">
							{/* Period radio */}
							<div>
								<label className="block text-xs text-muted-foreground/60 mb-2">
									Period
								</label>
								<div className="flex gap-2">
									{(["daily", "weekly", "monthly"] as BudgetPeriod[]).map(
										(p) => (
											<button
												key={p}
												type="button"
												onClick={() => setPeriod(p)}
												className={cn(
													"px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
													period === p
														? "bg-setra-600/20 text-setra-300 border-setra-600/30"
														: "text-muted-foreground border-border/40 hover:text-foreground",
												)}
											>
												{p.charAt(0).toUpperCase() + p.slice(1)}
											</button>
										),
									)}
								</div>
							</div>

							{/* Limit input */}
							<div>
								<label className="block text-xs text-muted-foreground/60 mb-1">
									Limit (USD)
								</label>
								<div className="relative">
									<span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
										$
									</span>
									<input
										type="number"
										value={limitStr}
										onChange={(e) => setLimitStr(e.target.value)}
										step="0.01"
										min="0"
										className="w-40 pl-6 pr-3 py-2 rounded-md border border-border/50 bg-card/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500/50"
										placeholder="10.00"
									/>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={() => mutation.mutate()}
									disabled={mutation.isPending || !limitStr}
									className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-setra-600/20 hover:bg-setra-600/30 text-setra-300 text-xs font-medium transition-colors disabled:opacity-50"
								>
									{mutation.isPending ? (
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
									) : (
										<Save className="w-3.5 h-3.5" />
									)}
									Save policy
								</button>
								{saved && (
									<span className="flex items-center gap-1 text-xs text-accent-green">
										<Check className="w-3.5 h-3.5" /> Saved
									</span>
								)}
							</div>
						</div>
					)}
				</div>
			</Section>

			{/* Spend bar */}
			{budget && (
				<Section title="Usage">
					<div className="glass rounded-xl p-5 space-y-3">
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground/70">
								This {budget.period}: {formatCost(spentUsd)}
							</span>
							<span className="text-muted-foreground/50">
								/ {formatCost(budget.limitUsd)}
							</span>
						</div>
						<div className="h-2 rounded-full bg-setra-400/10 overflow-hidden">
							<div
								className={cn("h-full rounded-full transition-all", barColor)}
								style={{ width: `${Math.min(spendPct, 100)}%` }}
							/>
						</div>
						<p className="text-xs text-muted-foreground/50">
							{spendPct.toFixed(1)}% of {budget.period} limit used
						</p>

						{/* Over-limit warning */}
						{spendPct > 90 && (
							<div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 mt-2">
								<AlertTriangle className="w-4 h-4 text-accent-red flex-shrink-0 mt-0.5" />
								<p className="text-xs text-accent-red">
									{spendPct >= 100
										? `Exceeded ${budget.period} limit of ${formatCost(budget.limitUsd)}.`
										: `Approaching ${budget.period} limit — ${(100 - spendPct).toFixed(1)}% remaining.`}
								</p>
							</div>
						)}
					</div>
				</Section>
			)}
		</div>
	);
}

// ─── Chat Tab ───────────────────────────────────────────────────────────────

interface ChatMessage {
	id: string;
	agentSlug: string;
	channel: string;
	body: string;
	threadId: string | null;
	createdAt: string;
	messageKind?: string | null;
}

function ChatTab({ agent, agentId }: { agent: AgentDetail; agentId: string }) {
	const { user } = useAuth();
	const queryClient = useQueryClient();
	const [input, setInput] = useState("");
	const [sending, setSending] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const channel = `agent-chat:${agentId}`;

	const { data: messages = [], isLoading } = useQuery({
		queryKey: ["agent-chat", agentId],
		queryFn: () => api.collaboration.messages(channel, 100),
		refetchInterval: 5_000,
	});

	// Auto-scroll on new messages
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages.length]);

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const sendMessage = useCallback(async () => {
		const text = input.trim();
		if (!text || sending) return;
		setSending(true);
		try {
			await api.collaboration.post({
				channel,
				body: text,
				agentSlug: "human",
			});
			setInput("");
			await queryClient.invalidateQueries({
				queryKey: ["agent-chat", agentId],
			});
		} finally {
			setSending(false);
			inputRef.current?.focus();
		}
	}, [input, sending, channel, agentId, queryClient]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void sendMessage();
			}
		},
		[sendMessage],
	);

	const agentName = agent.displayName || agent.role || agent.slug || "Agent";

	function isAgentMessage(msg: ChatMessage) {
		return msg.agentSlug !== "human" && msg.agentSlug !== user?.email;
	}

	function senderInitials(msg: ChatMessage) {
		if (isAgentMessage(msg)) {
			return agentName.slice(0, 2).toUpperCase();
		}
		if (user?.name) {
			return user.name
				.split(/\s+/)
				.map((p) => p[0]?.toUpperCase())
				.slice(0, 2)
				.join("");
		}
		return user?.email?.[0]?.toUpperCase() ?? "?";
	}

	function senderName(msg: ChatMessage) {
		if (isAgentMessage(msg)) return agentName;
		return user?.name || user?.email || "You";
	}

	if (isLoading) {
		return (
			<div className="h-[calc(100vh-280px)] min-h-[400px] glass rounded-xl animate-pulse" />
		);
	}

	return (
		<div className="flex flex-col h-[calc(100vh-280px)] min-h-[400px] glass rounded-xl border border-border/30 overflow-hidden">
			{/* Messages area */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-3 text-center">
						<div className="p-3 rounded-2xl bg-setra-600/10 border border-setra-600/20">
							<MessageSquare className="w-8 h-8 text-setra-400" />
						</div>
						<p className="text-sm text-muted-foreground">
							Start a conversation with {agentName}
						</p>
						<p className="text-xs text-muted-foreground/50 max-w-sm">
							Send messages, instructions, or follow-up questions. The agent
							will see your messages when it starts its next task.
						</p>
					</div>
				) : (
					messages.map((msg) => {
						const fromAgent = isAgentMessage(msg);
						return (
							<div
								key={msg.id}
								className={cn(
									"flex gap-3 max-w-[85%]",
									fromAgent ? "mr-auto" : "ml-auto flex-row-reverse",
								)}
							>
								{/* Avatar */}
								<div
									className={cn(
										"flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
										fromAgent
											? "bg-setra-600/20 text-setra-400"
											: "bg-accent-blue/20 text-accent-blue",
									)}
								>
									{senderInitials(msg)}
								</div>
								{/* Bubble */}
								<div
									className={cn(
										"rounded-xl px-4 py-2.5 text-sm leading-relaxed",
										fromAgent
											? "bg-card/60 border border-border/30 text-foreground"
											: "bg-setra-600/15 border border-setra-600/20 text-foreground",
									)}
								>
									<div className="flex items-center gap-2 mb-1">
										<span className="text-xs font-medium text-muted-foreground">
											{senderName(msg)}
										</span>
										<span className="text-[10px] text-muted-foreground/40">
											{new Date(msg.createdAt).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
									</div>
									<p className="whitespace-pre-wrap break-words">{msg.body}</p>
								</div>
							</div>
						);
					})
				)}
			</div>

			{/* Input area */}
			<div className="border-t border-border/30 p-3">
				<div className="flex items-end gap-2">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={`Message ${agentName}...`}
						rows={1}
						className="flex-1 resize-none rounded-lg border border-border/50 bg-card/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-setra-500/50 max-h-32 overflow-y-auto"
						style={{ minHeight: "40px" }}
						onInput={(e) => {
							const el = e.currentTarget;
							el.style.height = "auto";
							el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
						}}
					/>
					<button
						type="button"
						onClick={() => void sendMessage()}
						disabled={!input.trim() || sending}
						className={cn(
							"flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
							input.trim() && !sending
								? "bg-setra-600 text-[#2b2418] hover:bg-setra-500"
								: "bg-muted/30 text-muted-foreground/40 cursor-not-allowed",
						)}
					>
						{sending ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<Send className="w-4 h-4" />
						)}
					</button>
				</div>
				<p className="text-[10px] text-muted-foreground/40 mt-1.5 px-1">
					Press Enter to send · Shift+Enter for new line
				</p>
			</div>
		</div>
	);
}
