import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	FlaskConical,
	Loader2,
	Package,
	Plug,
	Settings2,
	Terminal,
	Trash2,
	TriangleAlert,
	XCircle,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge, PageHeader } from "../components/ui";
import { type AdapterConfig, instanceSettings } from "../lib/api";
import { cn } from "../lib/utils";

const DEFAULT_ADAPTERS = [
	"claude",
	"codex",
	"openai",
	"gemini",
	"amp",
	"ollama",
	"opencode",
	"lmstudio",
	"mistral",
];

const DEFAULT_FLAGS = [
	{
		id: "streaming",
		name: "Streaming responses",
		description:
			"Stream agent output token-by-token instead of waiting for completion.",
	},
	{
		id: "multi-agent-collab",
		name: "Multi-agent collaboration",
		description: "Allow agents to delegate subtasks to other agents.",
	},
	{
		id: "parallel-tasks",
		name: "Parallel task execution",
		description: "Run multiple tasks simultaneously per agent.",
	},
	{
		id: "beta-ui",
		name: "Beta UI features",
		description: "Enable unreleased UI components and layouts.",
	},
	{
		id: "verbose-logging",
		name: "Verbose agent logging",
		description: "Log all LLM prompts and responses to disk.",
	},
];

const MARKETPLACE_PLUGINS = [
	{
		id: "setra-github",
		name: "setra-github",
		description: "Connect to GitHub repositories, issues, and pull requests.",
	},
	{
		id: "setra-jira",
		name: "setra-jira",
		description: "Sync tasks with Jira projects and sprints.",
	},
	{
		id: "setra-linear",
		name: "setra-linear",
		description: "Integrate Linear issues and project cycles.",
	},
	{
		id: "setra-slack",
		name: "setra-slack",
		description: "Send notifications and interact via Slack channels.",
	},
	{
		id: "setra-pagerduty",
		name: "setra-pagerduty",
		description: "Route incidents and alerts through PagerDuty.",
	},
	{
		id: "setra-datadog",
		name: "setra-datadog",
		description: "Monitor metrics, logs, and traces with Datadog.",
	},
];

const PLUGIN_FIELDS: Record<
	string,
	{ key: string; label: string; type?: "password" | undefined }[]
> = {
	"setra-github": [
		{ key: "token", label: "Personal Access Token", type: "password" },
		{ key: "org", label: "Organization" },
	],
	"setra-slack": [
		{ key: "webhookUrl", label: "Webhook URL" },
		{ key: "channel", label: "Channel" },
	],
	"setra-jira": [
		{ key: "host", label: "Host URL" },
		{ key: "token", label: "API Token", type: "password" },
		{ key: "project", label: "Project Key" },
	],
};

type Tab = "adapters" | "plugins" | "experimental";

function ToggleSwitch({
	value,
	onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={value}
			onClick={() => onChange(!value)}
			className={cn(
				"relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-setra-600/50",
				value ? "bg-setra-600" : "bg-muted",
			)}
		>
			<span
				className={cn(
					"absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
					value ? "translate-x-4" : "translate-x-0.5",
				)}
			/>
		</button>
	);
}

function PasswordInput({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string | undefined;
}) {
	const [show, setShow] = useState(false);
	return (
		<div className="relative">
			<input
				type={show ? "text" : "password"}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full bg-input border border-border rounded-md px-3 py-1.5 pr-9 text-sm font-mono outline-none focus:border-setra-600 transition-colors"
			/>
			<button
				type="button"
				onClick={() => setShow((v) => !v)}
				tabIndex={-1}
				className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
			>
				{show ? (
					<EyeOff className="w-3.5 h-3.5" />
				) : (
					<Eye className="w-3.5 h-3.5" />
				)}
			</button>
		</div>
	);
}

function StatusBadge({ status }: { status: AdapterConfig["status"] }) {
	const map: Record<AdapterConfig["status"], { cls: string; label: string }> = {
		ok: {
			cls: "border-accent-green/60 text-accent-green bg-accent-green/10",
			label: "Active",
		},
		disabled: {
			cls: "border-yellow-500/60 text-yellow-400 bg-yellow-500/10",
			label: "Disabled",
		},
		unconfigured: {
			cls: "border-border text-muted-foreground bg-muted",
			label: "Not set",
		},
	};
	const cfg = map[status];
	return (
		<span
			className={cn(
				"text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
				cfg.cls,
			)}
		>
			{cfg.label}
		</span>
	);
}

function KindBadge({ kind }: { kind: AdapterConfig["kind"] }) {
	const map: Record<
		AdapterConfig["kind"],
		{ cls: string; label: string; desc: string }
	> = {
		cli: {
			cls: "border-blue-500/60 text-blue-400 bg-blue-500/10",
			label: "CLI",
			desc: "Runs via installed CLI binary",
		},
		api: {
			cls: "border-purple-500/60 text-purple-400 bg-purple-500/10",
			label: "API",
			desc: "Direct API calls, no CLI needed",
		},
		local: {
			cls: "border-emerald-500/60 text-emerald-400 bg-emerald-500/10",
			label: "Local",
			desc: "Runs on your machine, free",
		},
	};
	const cfg = map[kind];
	return (
		<span
			className={cn(
				"text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
				cfg.cls,
			)}
			title={cfg.desc}
		>
			{cfg.label}
		</span>
	);
}

const CLI_SETUP_INSTRUCTIONS: Record<
	string,
	{ install: string; auth: string; verify: string }
> = {
	claude: {
		install: "npm install -g @anthropic-ai/claude-code",
		auth: "claude  (follow the browser auth flow — uses your Claude subscription, no API key needed)",
		verify: "claude --version",
	},
	codex: {
		install: "npm install -g @openai/codex",
		auth: "export OPENAI_API_KEY=sk-… (or login via: codex --login)",
		verify: "codex --version",
	},
	gemini: {
		install:
			"npm install -g @anthropic-ai/claude-code  # then: npx @anthropic-ai/claude-code gemini",
		auth: "export GEMINI_API_KEY=… (or: gcloud auth login)",
		verify: "gemini --version",
	},
	amp: {
		install:
			"npm install -g @anthropic-ai/claude-code  # then: npx @anthropic-ai/claude-code amp",
		auth: "amp login (follow the browser auth flow)",
		verify: "amp --version",
	},
	opencode: {
		install: "go install github.com/nicholasgasior/opencode@latest",
		auth: "export OPENAI_API_KEY=sk-…",
		verify: "opencode --version",
	},
};

function AdapterCard({ adapter }: { adapter: AdapterConfig }) {
	const qc = useQueryClient();
	const [expanded, setExpanded] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState(adapter.baseUrl ?? "");
	const [defaultModel, setDefaultModel] = useState(
		adapter.defaultModel ?? adapter.models[0] ?? "",
	);
	const [testResult, setTestResult] = useState<{
		ok: boolean;
		latencyMs?: number | undefined;
		error?: string | undefined;
	} | null>(null);

	const showBaseUrl =
		["ollama", "lmstudio"].includes(adapter.id) || adapter.baseUrl != null;
	const cliSetup = CLI_SETUP_INSTRUCTIONS[adapter.id];
	const needsApiKey = adapter.kind !== "local" && !cliSetup;

	const toggleMut = useMutation({
		mutationFn: (enabled: boolean) =>
			instanceSettings.adapters.update(adapter.id, { enabled }),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["instance-adapters"] }),
	});

	const saveMut = useMutation({
		mutationFn: () =>
			instanceSettings.adapters.update(adapter.id, {
				...(apiKey !== "" ? { apiKey } : {}),
				...(baseUrl !== "" ? { baseUrl } : {}),
				...(defaultModel !== "" ? { defaultModel } : {}),
				enabled: true,
			}),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["instance-adapters"] }),
	});

	const testMut = useMutation({
		mutationFn: () => instanceSettings.adapters.test(adapter.id),
		onSuccess: (res) => setTestResult(res),
		onError: (err) =>
			setTestResult({
				ok: false,
				error: err instanceof Error ? err.message : "Connection failed",
			}),
	});

	return (
		<div
			className={cn(
				"glass rounded-lg overflow-hidden transition-opacity",
				!adapter.enabled && adapter.isConfigured && "opacity-60",
			)}
		>
			<div className="flex items-center gap-3 p-4">
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="flex items-center gap-3 flex-1 min-w-0 text-left hover:bg-white/5 -m-1 p-1 rounded transition-colors"
				>
					<div className="w-8 h-8 rounded-full bg-setra-600/20 text-setra-400 flex items-center justify-center text-sm font-bold flex-shrink-0 select-none">
						{(adapter.id[0] ?? "?").toUpperCase()}
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium">{adapter.name}</p>
						<p className="text-xs text-muted-foreground/60">
							{adapter.models.length} model
							{adapter.models.length !== 1 ? "s" : ""} available
						</p>
					</div>
					<KindBadge kind={adapter.kind} />
					<StatusBadge status={adapter.status} />
					{expanded ? (
						<ChevronDown className="w-4 h-4 text-muted-foreground/40 ml-1 flex-shrink-0" />
					) : (
						<ChevronRight className="w-4 h-4 text-muted-foreground/40 ml-1 flex-shrink-0" />
					)}
				</button>
				<ToggleSwitch
					value={adapter.enabled}
					onChange={(v) => toggleMut.mutate(v)}
				/>
			</div>

			{expanded && (
				<div className="border-t border-border/30 p-4 space-y-4">
					{/* CLI setup instructions */}
					{cliSetup && (
						<div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-3 space-y-2">
							<p className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
								<Terminal className="w-3.5 h-3.5" />
								CLI Setup Required
							</p>
							<div className="space-y-1.5">
								<div>
									<span className="text-[10px] text-muted-foreground/50 uppercase">
										1. Install:
									</span>
									<code className="block text-xs font-mono text-zinc-300 bg-zinc-800/50 px-2 py-1 rounded mt-0.5 select-all">
										{cliSetup.install}
									</code>
								</div>
								<div>
									<span className="text-[10px] text-muted-foreground/50 uppercase">
										2. Authenticate:
									</span>
									<code className="block text-xs font-mono text-zinc-300 bg-zinc-800/50 px-2 py-1 rounded mt-0.5 select-all">
										{cliSetup.auth}
									</code>
								</div>
								<div>
									<span className="text-[10px] text-muted-foreground/50 uppercase">
										3. Verify:
									</span>
									<code className="block text-xs font-mono text-zinc-300 bg-zinc-800/50 px-2 py-1 rounded mt-0.5 select-all">
										{cliSetup.verify}
									</code>
								</div>
							</div>
							{adapter.id === "claude" && (
								<p className="text-[11px] text-blue-300/70 mt-1">
									💡 Claude Code uses your Claude subscription — no API key
									needed if you have a Max/Team plan.
								</p>
							)}
							{adapter.id === "codex" && (
								<p className="text-[11px] text-blue-300/70 mt-1">
									💡 Codex uses your OpenAI API key or Codex Plus subscription.
								</p>
							)}
						</div>
					)}

					{/* API key field (not shown for local-only adapters without API keys) */}
					{needsApiKey && (
						<div className="space-y-1">
							<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
								API Key
								{adapter.apiKeyEnvVar && (
									<span className="font-normal ml-1 normal-case">
										(env: {adapter.apiKeyEnvVar})
									</span>
								)}
							</label>
							<PasswordInput
								value={apiKey}
								onChange={setApiKey}
								placeholder={adapter.apiKeyHint ?? "sk-…"}
							/>
							{adapter.signupUrl && (
								<a
									href={adapter.signupUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-[11px] text-accent-blue hover:underline"
								>
									Get an API key →
								</a>
							)}
						</div>
					)}

					{showBaseUrl && (
						<div className="space-y-1">
							<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
								Base URL
							</label>
							<input
								type="text"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								placeholder="http://localhost:11434"
								className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-sm font-mono outline-none focus:border-setra-600 transition-colors"
							/>
						</div>
					)}

					{adapter.models.length > 0 && (
						<div className="space-y-1">
							<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
								Default Model
							</label>
							<select
								value={defaultModel}
								onChange={(e) => setDefaultModel(e.target.value)}
								className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:border-setra-600 transition-colors"
							>
								{adapter.models.map((m) => (
									<option key={m} value={m}>
										{m}
										{m === adapter.defaultModel ? " (current)" : ""}
									</option>
								))}
							</select>
						</div>
					)}

					<div className="flex items-center gap-2 pt-1">
						<button
							type="button"
							onClick={() => testMut.mutate()}
							disabled={testMut.isPending}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
						>
							{testMut.isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Zap className="w-3.5 h-3.5" />
							)}
							Test connection
						</button>
						<button
							type="button"
							onClick={() => saveMut.mutate()}
							disabled={saveMut.isPending}
							className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-setra-600 text-white rounded-md hover:bg-setra-500 transition-colors disabled:opacity-50"
						>
							{saveMut.isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<CheckCircle className="w-3.5 h-3.5" />
							)}
							Save & Enable
						</button>
					</div>

					{testResult !== null && (
						<div
							className={cn(
								"flex items-center gap-2 text-xs p-2 rounded-md",
								testResult.ok
									? "bg-accent-green/10 text-accent-green"
									: "bg-accent-red/10 text-accent-red",
							)}
						>
							{testResult.ok ? (
								<>
									<CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
									Connection OK — {testResult.latencyMs}ms
								</>
							) : (
								<>
									<XCircle className="w-3.5 h-3.5 flex-shrink-0" />
									{testResult.error ?? "Connection failed"}
								</>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function AdaptersTab() {
	const { data: adapters = [], isLoading } = useQuery({
		queryKey: ["instance-adapters"],
		queryFn: instanceSettings.adapters.list,
	});

	const displayAdapters: AdapterConfig[] =
		adapters.length > 0
			? adapters
			: DEFAULT_ADAPTERS.map((id) => ({
					id,
					name: id.charAt(0).toUpperCase() + id.slice(1),
					enabled: false,
					kind: "api" as const,
					isConfigured: false,
					status: "unconfigured" as const,
					models: [],
					defaultModel: null,
					signupUrl: null,
					apiKeyEnvVar: null,
				}));

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12 text-muted-foreground/40">
				<Loader2 className="w-5 h-5 animate-spin mr-2" />
				Loading adapters…
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{displayAdapters.map((adapter) => (
				<AdapterCard key={adapter.id} adapter={adapter} />
			))}
		</div>
	);
}

interface PluginItem {
	id: string;
	name: string;
	version: string;
	description: string;
	isEnabled: boolean;
	config: Record<string, string>;
}

function PluginRow({
	plugin,
	onRefresh,
}: { plugin: PluginItem; onRefresh: () => void }) {
	const [configOpen, setConfigOpen] = useState(false);
	const [configValues, setConfigValues] = useState<Record<string, string>>({
		...plugin.config,
	});

	const toggleMut = useMutation({
		mutationFn: () =>
			instanceSettings.plugins.toggle(plugin.id, !plugin.isEnabled),
		onSuccess: onRefresh,
	});

	const configureMut = useMutation({
		mutationFn: () =>
			instanceSettings.plugins.configure(plugin.id, configValues),
		onSuccess: () => {
			onRefresh();
			setConfigOpen(false);
		},
	});

	const uninstallMut = useMutation({
		mutationFn: () => instanceSettings.plugins.uninstall(plugin.id),
		onSuccess: onRefresh,
	});

	const fields = PLUGIN_FIELDS[plugin.id] ?? [];

	return (
		<div className="glass rounded-lg overflow-hidden">
			<div className="flex items-center gap-3 p-3">
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium">{plugin.name}</p>
					<p className="text-xs text-muted-foreground/60">
						{plugin.description}
					</p>
				</div>
				<span className="text-xs text-muted-foreground/40 font-mono">
					{plugin.version}
				</span>
				<ToggleSwitch
					value={plugin.isEnabled}
					onChange={() => toggleMut.mutate()}
				/>
				<button
					type="button"
					onClick={() => setConfigOpen((v) => !v)}
					className="p-1.5 text-muted-foreground/40 hover:text-foreground transition-colors rounded"
					title="Configure"
				>
					<Settings2 className="w-3.5 h-3.5" />
				</button>
				<button
					type="button"
					onClick={() => uninstallMut.mutate()}
					disabled={uninstallMut.isPending}
					className="p-1.5 text-muted-foreground/40 hover:text-accent-red transition-colors rounded disabled:opacity-50"
					title="Uninstall"
				>
					<Trash2 className="w-3.5 h-3.5" />
				</button>
			</div>

			{configOpen && (
				<div className="border-t border-border/30 p-3 space-y-2">
					{fields.length === 0 ? (
						<p className="text-xs text-muted-foreground/40">
							No configuration fields for this plugin.
						</p>
					) : (
						fields.map((f) => (
							<div key={f.key} className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									{f.label}
								</label>
								{f.type === "password" ? (
									<PasswordInput
										value={configValues[f.key] ?? ""}
										onChange={(v) =>
											setConfigValues((prev) => ({ ...prev, [f.key]: v }))
										}
									/>
								) : (
									<input
										type="text"
										value={configValues[f.key] ?? ""}
										onChange={(e) =>
											setConfigValues((prev) => ({
												...prev,
												[f.key]: e.target.value,
											}))
										}
										className="w-full bg-input border border-border rounded-md px-3 py-1.5 text-sm font-mono outline-none focus:border-setra-600 transition-colors"
									/>
								)}
							</div>
						))
					)}
					{fields.length > 0 && (
						<button
							type="button"
							onClick={() => configureMut.mutate()}
							disabled={configureMut.isPending}
							className="flex items-center gap-1.5 mt-1 px-3 py-1.5 text-xs bg-setra-600 text-white rounded-md hover:bg-setra-500 transition-colors disabled:opacity-50"
						>
							{configureMut.isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<CheckCircle className="w-3.5 h-3.5" />
							)}
							Save config
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function PluginsTab() {
	const qc = useQueryClient();
	const { data: plugins = [], isLoading } = useQuery({
		queryKey: ["instance-plugins"],
		queryFn: instanceSettings.plugins.list,
	});

	const installedIds = new Set(plugins.map((p) => p.id));

	const installMut = useMutation({
		mutationFn: (id: string) => instanceSettings.plugins.install(id),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["instance-plugins"] }),
	});

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12 text-muted-foreground/40">
				<Loader2 className="w-5 h-5 animate-spin mr-2" />
				Loading plugins…
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Installed */}
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
					Installed
				</p>
				{plugins.length === 0 ? (
					<div className="glass rounded-lg p-6 text-center text-sm text-muted-foreground/40">
						No plugins installed yet.
					</div>
				) : (
					<div className="space-y-2">
						{plugins.map((plugin) => (
							<PluginRow
								key={plugin.id}
								plugin={plugin}
								onRefresh={() =>
									void qc.invalidateQueries({ queryKey: ["instance-plugins"] })
								}
							/>
						))}
					</div>
				)}
			</div>

			{/* Available */}
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
					Available
				</p>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{MARKETPLACE_PLUGINS.map((mp) => (
						<div
							key={mp.id}
							className="glass rounded-lg p-4 flex items-start gap-3"
						>
							<Package className="w-5 h-5 text-setra-400 flex-shrink-0 mt-0.5" />
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium">{mp.name}</p>
								<p className="text-xs text-muted-foreground/60 mt-0.5">
									{mp.description}
								</p>
							</div>
							{installedIds.has(mp.id) ? (
								<span className="text-[10px] font-semibold uppercase tracking-wider text-accent-green">
									Installed
								</span>
							) : (
								<button
									type="button"
									onClick={() => installMut.mutate(mp.id)}
									disabled={
										installMut.isPending && installMut.variables === mp.id
									}
									className="flex-shrink-0 text-xs px-2.5 py-1 bg-setra-600/20 text-setra-400 border border-setra-600/30 rounded hover:bg-setra-600/30 transition-colors disabled:opacity-50"
								>
									Install
								</button>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function ExperimentalTab() {
	const qc = useQueryClient();
	const { data: serverFlags = [] } = useQuery({
		queryKey: ["instance-flags"],
		queryFn: instanceSettings.flags.list,
	});

	// Merge: prefer server data, fall back to defaults
	const flagMap = new Map(serverFlags.map((f) => [f.id, f]));
	const mergedFlags = DEFAULT_FLAGS.map((df) => {
		const serverFlag = flagMap.get(df.id);
		return {
			id: df.id,
			name: df.name,
			description: df.description,
			enabled: serverFlag?.enabled ?? false,
		};
	});

	const toggleMut = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			instanceSettings.flags.toggle(id, enabled),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["instance-flags"] }),
	});

	return (
		<div className="space-y-4">
			<div className="flex items-start gap-3 p-4 rounded-lg border border-accent-yellow/30 bg-accent-yellow/5">
				<TriangleAlert className="w-4 h-4 text-accent-yellow flex-shrink-0 mt-0.5" />
				<p className="text-sm text-accent-yellow/80">
					Experimental features may cause instability. Use with caution.
				</p>
			</div>

			<div className="space-y-2">
				{mergedFlags.map((flag) => (
					<div
						key={flag.id}
						className="glass rounded-lg p-4 flex items-start gap-4"
					>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium">{flag.name}</p>
							<p className="text-xs text-muted-foreground/60 mt-0.5">
								{flag.description}
							</p>
						</div>
						<ToggleSwitch
							value={flag.enabled}
							onChange={(enabled) => toggleMut.mutate({ id: flag.id, enabled })}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

const TABS: { id: Tab; label: string; icon: typeof Plug }[] = [
	{ id: "adapters", label: "Adapters", icon: Plug },
	{ id: "plugins", label: "Plugins", icon: Package },
	{ id: "experimental", label: "Experimental", icon: FlaskConical },
];

export function InstanceSettingsPage() {
	const [activeTab, setActiveTab] = useState<Tab>("adapters");

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6">
			<PageHeader
				title="Instance Settings"
				subtitle="Configure adapters, plugins, and experimental features."
				actions={<Badge variant="info">{activeTab}</Badge>}
			/>

			{/* Tabs */}
			<div className="flex gap-1 border-b border-border/30">
				{TABS.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						type="button"
						onClick={() => setActiveTab(id)}
						className={cn(
							"flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
							activeTab === id
								? "border-setra-600 text-setra-400"
								: "border-transparent text-muted-foreground/60 hover:text-foreground",
						)}
					>
						<Icon className="w-3.5 h-3.5" />
						{label}
					</button>
				))}
			</div>

			{/* Content */}
			{activeTab === "adapters" && <AdaptersTab />}
			{activeTab === "plugins" && <PluginsTab />}
			{activeTab === "experimental" && <ExperimentalTab />}
		</div>
	);
}
