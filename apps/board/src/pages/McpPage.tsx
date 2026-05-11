import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
	AlertCircle,
	Brain,
	ChevronDown,
	ChevronRight,
	Code,
	Database,
	Download,
	FileSearch,
	Globe,
	Loader2,
	Pencil,
	Play,
	Plug,
	Search,
	Square,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, PageHeader } from "../components/ui";
import {
	type McpServerConfig,
	type McpServerInfo,
	type McpToolInfo,
	api,
} from "../lib/api";
import { cn } from "../lib/utils";

type Transport = "stdio" | "sse" | "http";

type ServerForm = {
	name: string;
	transport: Transport;
	command: string;
	args: string;
	url: string;
	env: string;
	autoStart: boolean;
	description: string;
};

const TRANSPORT_OPTIONS: Transport[] = ["stdio", "sse", "http"];

/* ── Popular MCP tools catalog ────────────────────────────────────────── */

interface CatalogTool {
	name: string;
	description: string;
	command: string;
	args: string[];
	icon: React.ElementType;
	category: string;
	npxPackage: string;
}

const MCP_CATALOG: CatalogTool[] = [
	{
		name: "Sequential Thinking",
		description:
			"Dynamic, reflective problem-solving through structured thought sequences",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
		icon: Brain,
		category: "Reasoning",
		npxPackage: "@modelcontextprotocol/server-sequential-thinking",
	},
	{
		name: "Filesystem",
		description:
			"Read, write, search, and manage files on the local filesystem",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
		icon: FileSearch,
		category: "Files",
		npxPackage: "@modelcontextprotocol/server-filesystem",
	},
	{
		name: "Brave Search",
		description: "Web search using the Brave Search API (needs BRAVE_API_KEY)",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-brave-search"],
		icon: Search,
		category: "Search",
		npxPackage: "@modelcontextprotocol/server-brave-search",
	},
	{
		name: "GitHub",
		description: "Manage repos, issues, PRs, and files via GitHub API",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-github"],
		icon: Code,
		category: "Dev Tools",
		npxPackage: "@modelcontextprotocol/server-github",
	},
	{
		name: "Puppeteer",
		description: "Browser automation — navigate, screenshot, click, fill forms",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-puppeteer"],
		icon: Globe,
		category: "Browser",
		npxPackage: "@modelcontextprotocol/server-puppeteer",
	},
	{
		name: "SQLite",
		description: "Query and manage SQLite databases with full SQL support",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-sqlite"],
		icon: Database,
		category: "Database",
		npxPackage: "@modelcontextprotocol/server-sqlite",
	},
	{
		name: "Fetch",
		description: "Fetch and convert web pages to markdown for AI consumption",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-fetch"],
		icon: Globe,
		category: "Web",
		npxPackage: "@modelcontextprotocol/server-fetch",
	},
	{
		name: "Memory",
		description:
			"Persistent knowledge graph for long-term memory across sessions",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-memory"],
		icon: Brain,
		category: "Memory",
		npxPackage: "@modelcontextprotocol/server-memory",
	},
	{
		name: "Exa Search",
		description:
			"Neural search engine for finding similar content and meaning-based search",
		command: "npx",
		args: ["-y", "exa-mcp-server"],
		icon: Search,
		category: "Search",
		npxPackage: "exa-mcp-server",
	},
	{
		name: "Shell",
		description:
			"Execute shell commands securely with configurable restrictions",
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-shell"],
		icon: Terminal,
		category: "System",
		npxPackage: "@modelcontextprotocol/server-shell",
	},
];

const statusStyles: Record<string, { dot: string; label: string }> = {
	connected: { dot: "bg-accent-green", label: "Connected" },
	stopped: { dot: "bg-muted-foreground/40", label: "Stopped" },
	starting: { dot: "bg-accent-yellow animate-pulse", label: "Starting" },
	error: { dot: "bg-accent-red", label: "Error" },
};

function emptyForm(): ServerForm {
	return {
		name: "",
		transport: "stdio",
		command: "",
		args: "",
		url: "",
		env: "",
		autoStart: false,
		description: "",
	};
}

function formFromConfig(config?: McpServerConfig | null): ServerForm {
	if (!config) return emptyForm();
	return {
		name: config.name ?? "",
		transport: (config.transport as Transport) ?? "stdio",
		command: config.command ?? "",
		args: config.args?.join("\n") ?? "",
		url: config.url ?? "",
		env: Object.entries(config.env ?? {})
			.map(([key, value]) => `${key}=${value}`)
			.join("\n"),
		autoStart: Boolean(config.autoStart),
		description: config.description ?? "",
	};
}

function parseArgs(value: string): string[] | undefined {
	const args = value
		.split(/\r?\n|,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
		.map((item) => item.trim())
		.filter(Boolean);
	return args.length > 0 ? args : undefined;
}

function parseEnv(value: string): Record<string, string> | undefined {
	const entries = value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const separator = line.indexOf("=");
			if (separator === -1) return null;
			return [
				line.slice(0, separator).trim(),
				line.slice(separator + 1).trim(),
			];
		})
		.filter((entry): entry is [string, string] => Boolean(entry?.[0]));
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toPayload(form: ServerForm): Partial<McpServerConfig> {
	const description = form.description.trim();
	const command = form.command.trim();
	const url = form.url.trim();
	const args = form.transport === "stdio" ? parseArgs(form.args) : undefined;
	const env = form.transport === "stdio" ? parseEnv(form.env) : undefined;

	return {
		name: form.name.trim(),
		transport: form.transport,
		autoStart: form.autoStart,
		...(description ? { description } : {}),
		...(form.transport === "stdio" && command ? { command } : {}),
		...(form.transport === "stdio" && args ? { args } : {}),
		...(form.transport === "stdio" && env ? { env } : {}),
		...(form.transport !== "stdio" && url ? { url } : {}),
	};
}

function validateForm(form: ServerForm): string | null {
	if (!form.name.trim()) return "Name is required.";
	if (form.transport === "stdio" && !form.command.trim()) {
		return "Command is required for stdio servers.";
	}
	if (form.transport !== "stdio" && !form.url.trim()) {
		return "URL is required for HTTP/SSE servers.";
	}
	return null;
}

function ServerCard({
	server,
	expanded,
	onToggleExpand,
	onEdit,
	onRemove,
	onToggleRun,
	actionPending,
}: {
	server: McpServerInfo;
	expanded: boolean;
	onToggleExpand: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onToggleRun: () => void;
	actionPending: boolean;
}) {
	const connected = server.status === "connected";
	const canStop = server.status === "connected" || server.status === "starting";
	const style = statusStyles[server.status] ?? {
		dot: "bg-muted-foreground/40",
		label: server.status,
	};
	const summary =
		server.config.transport === "stdio"
			? (server.config.command ?? "No command configured")
			: (server.config.url ?? "No URL configured");
	const { data: tools = server.tools ?? [], isLoading: toolsLoading } =
		useQuery({
			queryKey: ["mcp-tools", server.config.id],
			queryFn: () => api.mcp.tools(server.config.id),
			enabled: expanded && connected,
			initialData: server.tools,
		});

	return (
		<motion.div
			layout
			className="glass rounded-xl border border-border/50 overflow-hidden"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
		>
			<div className="p-4 space-y-3">
				<div className="flex items-start gap-3 justify-between">
					<div className="min-w-0 space-y-2">
						<div className="flex items-center gap-2 flex-wrap">
							<h2 className="text-sm font-semibold text-foreground">
								{server.config.name}
							</h2>
							<span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-muted/60 text-muted-foreground">
								{server.config.transport}
							</span>
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								<span className={cn("status-dot", style.dot)} />
								{style.label}
							</span>
							{server.pid ? (
								<span className="text-[10px] font-mono text-muted-foreground/60">
									pid {server.pid}
								</span>
							) : null}
						</div>
						<p className="text-xs font-mono text-muted-foreground/70 truncate max-w-2xl">
							{summary}
						</p>
						{server.config.description ? (
							<p className="text-xs text-muted-foreground leading-relaxed">
								{server.config.description}
							</p>
						) : null}
						{server.error ? (
							<p className="text-xs text-accent-red flex items-center gap-1.5">
								<AlertCircle className="w-3.5 h-3.5" />
								{server.error}
							</p>
						) : null}
					</div>

					<div className="flex items-center gap-2 shrink-0">
						<button
							type="button"
							onClick={onToggleRun}
							disabled={actionPending}
							className={cn(
								"flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50",
								canStop
									? "border-accent-red/30 text-accent-red hover:bg-accent-red/10"
									: "border-setra-600/30 text-setra-300 hover:bg-setra-600/10",
							)}
						>
							{actionPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : canStop ? (
								<Square className="w-3.5 h-3.5" />
							) : (
								<Play className="w-3.5 h-3.5" />
							)}
							{canStop ? "Stop" : "Start"}
						</button>
						<button
							type="button"
							onClick={onEdit}
							className="p-2 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
						>
							<Pencil className="w-3.5 h-3.5" />
						</button>
						<button
							type="button"
							onClick={onRemove}
							className="p-2 rounded-md border border-border/50 text-muted-foreground hover:text-accent-red hover:bg-accent-red/10 transition-colors"
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					</div>
				</div>

				<div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
					<button
						type="button"
						onClick={onToggleExpand}
						disabled={!connected}
						className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground transition-colors"
					>
						{expanded ? (
							<ChevronDown className="w-3.5 h-3.5" />
						) : (
							<ChevronRight className="w-3.5 h-3.5" />
						)}
						{connected
							? `Tools (${tools.length})`
							: "Tools available when connected"}
					</button>
					<span className="text-[10px] text-muted-foreground/50">
						{server.config.autoStart ? "Auto-start enabled" : "Manual start"}
					</span>
				</div>
			</div>

			<AnimatePresence initial={false}>
				{expanded && connected ? (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						className="border-t border-border/40 overflow-hidden"
					>
						<div className="p-4 space-y-2 bg-muted/10">
							{toolsLoading ? (
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading
									tools…
								</div>
							) : tools.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									No tools reported yet.
								</p>
							) : (
								tools.map((tool: McpToolInfo) => (
									<div
										key={`${tool.serverId}:${tool.name}`}
										className="rounded-lg border border-border/40 bg-card/50 px-3 py-2"
									>
										<div className="flex items-center gap-2">
											<span className="text-xs font-medium text-foreground">
												{tool.name}
											</span>
											<span className="text-[10px] text-muted-foreground/50 font-mono">
												{Object.keys(tool.inputSchema ?? {}).length} schema keys
											</span>
										</div>
										<p className="text-xs text-muted-foreground mt-1">
											{tool.description || "No description provided."}
										</p>
									</div>
								))
							)}
						</div>
					</motion.div>
				) : null}
			</AnimatePresence>
		</motion.div>
	);
}

export function McpPage() {
	const qc = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingServer, setEditingServer] = useState<McpServerInfo | null>(
		null,
	);
	const [form, setForm] = useState<ServerForm>(emptyForm);
	const [formError, setFormError] = useState<string | null>(null);
	const [expandedServerId, setExpandedServerId] = useState<string | null>(null);

	const {
		data: servers = [],
		isLoading,
		isError,
		error,
	} = useQuery({
		queryKey: ["mcp-servers"],
		queryFn: api.mcp.servers,
		refetchInterval: 30_000,
	});

	const invalidateServers = () =>
		qc.invalidateQueries({ queryKey: ["mcp-servers"] });

	const addMutation = useMutation({
		mutationFn: (payload: Partial<McpServerConfig>) => api.mcp.add(payload),
		onSuccess: () => {
			setDialogOpen(false);
			setEditingServer(null);
			setForm(emptyForm());
			setFormError(null);
			void invalidateServers();
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({
			id,
			payload,
		}: { id: string; payload: Partial<McpServerConfig> }) =>
			api.mcp.update(id, payload),
		onSuccess: () => {
			setDialogOpen(false);
			setEditingServer(null);
			setForm(emptyForm());
			setFormError(null);
			void invalidateServers();
		},
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => api.mcp.remove(id),
		onSuccess: () => void invalidateServers(),
	});

	const startMutation = useMutation({
		mutationFn: (id: string) => api.mcp.start(id),
		onSuccess: () => void invalidateServers(),
	});

	const stopMutation = useMutation({
		mutationFn: (id: string) => api.mcp.stop(id),
		onSuccess: () => void invalidateServers(),
	});

	const busyMessage = useMemo(() => {
		if (addMutation.isPending || updateMutation.isPending) return "Saving…";
		return null;
	}, [addMutation.isPending, updateMutation.isPending]);

	const [discoverNotice, setDiscoverNotice] = useState<string | null>(null);
	const discoverMutation = useMutation({
		mutationFn: () => api.mcp.discover(),
		onSuccess: (discovered) => {
			if (discovered.length === 0) {
				setDiscoverNotice(
					"No MCP servers found in your Claude Desktop config. Install Claude Desktop and add MCP servers there, or use the catalog below.",
				);
				setTimeout(() => setDiscoverNotice(null), 6000);
			} else {
				setDiscoverNotice(null);
			}
			void invalidateServers();
		},
	});

	const installCatalogItem = useMutation({
		mutationFn: (tool: CatalogTool) =>
			api.mcp.add({
				name: tool.name,
				transport: "stdio",
				command: tool.command,
				args: tool.args,
				autoStart: true,
				description: tool.description,
			}),
		onSuccess: () => void invalidateServers(),
	});

	const installedNames = useMemo(
		() => new Set(servers.map((s) => s.config.name.toLowerCase())),
		[servers],
	);

	function openCreateDialog() {
		setEditingServer(null);
		setForm(emptyForm());
		setFormError(null);
		setDialogOpen(true);
	}

	function openEditDialog(server: McpServerInfo) {
		setEditingServer(server);
		setForm(formFromConfig(server.config));
		setFormError(null);
		setDialogOpen(true);
	}

	function handleDialogChange(open: boolean) {
		setDialogOpen(open);
		if (!open) {
			setEditingServer(null);
			setFormError(null);
		}
	}

	function handleSubmit() {
		const validation = validateForm(form);
		if (validation) {
			setFormError(validation);
			return;
		}
		setFormError(null);
		const payload = toPayload(form);
		if (editingServer) {
			updateMutation.mutate({ id: editingServer.config.id, payload });
			return;
		}
		addMutation.mutate(payload);
	}

	return (
		<div className="flex flex-col h-full overflow-hidden gap-4">
			<div className="px-6 pt-6">
				<PageHeader
					title="AI Tools (MCP)"
					subtitle="Connect external tools so your agents can search, code, browse, and more."
					actions={
						<div className="flex items-center gap-2">
							<Badge variant="info">{servers.length} tools</Badge>
							<Button
								type="button"
								variant="ghost"
								onClick={() => discoverMutation.mutate()}
								loading={discoverMutation.isPending}
							>
								<Download className="h-3.5 w-3.5 mr-1" />
								Import from Claude
							</Button>
							<Button
								type="button"
								onClick={openCreateDialog}
								icon={<Plug className="h-4 w-4" aria-hidden="true" />}
							>
								Add AI Tool
							</Button>
						</div>
					}
				/>
			</div>

			{busyMessage && (
				<div className="px-6 py-4 border-b border-border/30">
					<p className="text-xs text-muted-foreground">{busyMessage}</p>
				</div>
			)}

			{discoverNotice && (
				<div
					role="status"
					className="mx-6 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300"
				>
					{discoverNotice}
				</div>
			)}

			<div className="flex-1 overflow-y-auto p-6">
				{isLoading ? (
					<div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
						<Loader2 className="w-4 h-4 animate-spin" /> Loading AI tools…
					</div>
				) : isError ? (
					<div className="rounded-xl border border-accent-red/30 bg-accent-red/5 px-4 py-3 text-sm text-accent-red">
						{error instanceof Error
							? error.message
							: "We could not load your AI tools."}
					</div>
				) : servers.length === 0 ? (
					<EmptyState
						icon={<Plug className="h-10 w-10" aria-hidden="true" />}
						title="No AI tools configured"
						description="Add a tool manually or install one from the catalog below."
						action={
							<Button
								type="button"
								onClick={openCreateDialog}
								icon={<Plug className="h-4 w-4" aria-hidden="true" />}
							>
								Add AI Tool
							</Button>
						}
					/>
				) : (
					<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
						{servers.map((server) => {
							const id = server.config.id;
							const actionPending =
								(startMutation.isPending && startMutation.variables === id) ||
								(stopMutation.isPending && stopMutation.variables === id) ||
								(removeMutation.isPending && removeMutation.variables === id);
							return (
								<ServerCard
									key={id}
									server={server}
									expanded={expandedServerId === id}
									onToggleExpand={() =>
										setExpandedServerId((current) =>
											current === id ? null : id,
										)
									}
									onEdit={() => openEditDialog(server)}
									onRemove={() => {
										if (
											window.confirm(
												`Remove AI tool \"${server.config.name}\"?`,
											)
										) {
											removeMutation.mutate(id);
										}
									}}
									onToggleRun={() =>
										server.status === "connected" ||
										server.status === "starting"
											? stopMutation.mutate(id)
											: startMutation.mutate(id)
									}
									actionPending={actionPending}
								/>
							);
						})}
					</div>
				)}

				{/* ── Popular MCP Tools Catalog ──────────────────────────────── */}
				{!isLoading && (
					<div className="mt-6 border-t border-border/30 pt-6">
						<h3 className="text-sm font-semibold text-foreground mb-1">
							Popular Tools
						</h3>
						<p className="text-xs text-muted-foreground mb-4">
							One-click install from the official MCP catalog. Tools run locally
							via npx.
						</p>
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
							{MCP_CATALOG.map((tool) => {
								const alreadyInstalled = installedNames.has(
									tool.name.toLowerCase(),
								);
								const installing =
									installCatalogItem.isPending &&
									installCatalogItem.variables?.name === tool.name;
								const Icon = tool.icon;
								return (
									<div
										key={tool.npxPackage}
										className={cn(
											"rounded-lg border p-3 transition-all",
											alreadyInstalled
												? "border-accent-green/30 bg-accent-green/5"
												: "border-border/40 bg-card/50 hover:border-border/60",
										)}
									>
										<div className="flex items-start gap-2.5">
											<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/30">
												<Icon className="h-4 w-4 text-muted-foreground" />
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<p className="text-sm font-medium text-foreground truncate">
														{tool.name}
													</p>
													<span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60 bg-muted/30 rounded px-1 py-0.5 shrink-0">
														{tool.category}
													</span>
												</div>
												<p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
													{tool.description}
												</p>
											</div>
										</div>
										<div className="mt-2.5 flex justify-end">
											{alreadyInstalled ? (
												<Badge variant="success">Installed</Badge>
											) : (
												<button
													type="button"
													disabled={installing}
													onClick={() => installCatalogItem.mutate(tool)}
													className="text-[11px] font-medium px-3 py-1 rounded border border-setra-500/40 bg-setra-600/10 text-setra-300 hover:bg-setra-600/20 transition-colors disabled:opacity-50"
												>
													{installing ? "Installing…" : "Install"}
												</button>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>

			<Dialog.Root open={dialogOpen} onOpenChange={handleDialogChange}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
					<Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-card border border-border/50 rounded-xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
						<div className="flex items-center justify-between gap-4">
							<Dialog.Title className="text-sm font-semibold text-foreground">
								{editingServer ? "Edit AI Tool (MCP Server)" : "Add AI Tool"}
							</Dialog.Title>
							<Dialog.Close asChild>
								<button className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
									<X className="w-4 h-4" />
								</button>
							</Dialog.Close>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
							<div className="space-y-1 md:col-span-2">
								<label className="text-xs text-muted-foreground">Name</label>
								<input
									autoFocus
									value={form.name}
									onChange={(e) =>
										setForm((current) => ({ ...current, name: e.target.value }))
									}
									placeholder="GitHub CLI AI Tool"
									className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-xs text-muted-foreground">
									Transport
								</label>
								<select
									value={form.transport}
									onChange={(e) =>
										setForm((current) => ({
											...current,
											transport: e.target.value as Transport,
										}))
									}
									className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
								>
									{TRANSPORT_OPTIONS.map((option) => (
										<option key={option} value={option}>
											{option.toUpperCase()}
										</option>
									))}
								</select>
							</div>

							<div className="space-y-1 flex items-end">
								<label className="flex items-center gap-2 text-sm text-foreground">
									<input
										type="checkbox"
										checked={form.autoStart}
										onChange={(e) =>
											setForm((current) => ({
												...current,
												autoStart: e.target.checked,
											}))
										}
										className="rounded border-border bg-muted/50"
									/>
									Auto-start on connect
								</label>
							</div>

							{form.transport === "stdio" ? (
								<>
									<div className="space-y-1 md:col-span-2">
										<label className="text-xs text-muted-foreground">
											Command
										</label>
										<input
											value={form.command}
											onChange={(e) =>
												setForm((current) => ({
													...current,
													command: e.target.value,
												}))
											}
											placeholder="npx @modelcontextprotocol/server-github"
											className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
										/>
									</div>
									<div className="space-y-1">
										<label className="text-xs text-muted-foreground">
											Args
										</label>
										<textarea
											value={form.args}
											onChange={(e) =>
												setForm((current) => ({
													...current,
													args: e.target.value,
												}))
											}
											rows={5}
											placeholder="One arg per line"
											className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500 resize-none"
										/>
									</div>
									<div className="space-y-1">
										<label className="text-xs text-muted-foreground">
											Env Vars
										</label>
										<textarea
											value={form.env}
											onChange={(e) =>
												setForm((current) => ({
													...current,
													env: e.target.value,
												}))
											}
											rows={5}
											placeholder="KEY=value"
											className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500 resize-none"
										/>
									</div>
								</>
							) : (
								<div className="space-y-1 md:col-span-2">
									<label className="text-xs text-muted-foreground">URL</label>
									<input
										value={form.url}
										onChange={(e) =>
											setForm((current) => ({
												...current,
												url: e.target.value,
											}))
										}
										placeholder="https://example.com/mcp"
										className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
									/>
								</div>
							)}

							<div className="space-y-1 md:col-span-2">
								<label className="text-xs text-muted-foreground">
									Description
								</label>
								<textarea
									value={form.description}
									onChange={(e) =>
										setForm((current) => ({
											...current,
											description: e.target.value,
										}))
									}
									rows={3}
									placeholder="Optional description"
									className="w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500 resize-none"
								/>
							</div>
						</div>

						{formError ? (
							<p className="text-xs text-accent-red">{formError}</p>
						) : null}
						{(addMutation.isError || updateMutation.isError) && (
							<p className="text-xs text-accent-red">
								{(addMutation.error ?? updateMutation.error) instanceof Error
									? ((addMutation.error ?? updateMutation.error) as Error)
											.message
									: "Could not save this AI tool."}
							</p>
						)}

						<div className="flex items-center justify-end gap-2 pt-2">
							<Dialog.Close asChild>
								<button className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/50">
									Cancel
								</button>
							</Dialog.Close>
							<button
								type="button"
								onClick={handleSubmit}
								disabled={addMutation.isPending || updateMutation.isPending}
								className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md bg-setra-600/15 text-setra-300 border border-setra-600/20 hover:bg-setra-600/25 transition-colors disabled:opacity-50"
							>
								{addMutation.isPending || updateMutation.isPending ? (
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
								) : null}
								{editingServer ? "Save Changes" : "Add AI Tool"}
							</button>
						</div>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</div>
	);
}
