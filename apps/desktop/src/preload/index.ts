import type { ResolvedCommand, SlashCommandEntry } from "@setra/commands";
import type { SetraInstance } from "@setra/shared";
import type { RenderedSkill, Skill } from "@setra/skills";
import type {
	CreatePlot,
	CreateRun,
	TerminalResizeInput,
	TerminalSpawnInput,
	TerminalWriteInput,
	TraceSearchInput,
	UpdatePlot,
} from "@setra/types";
import { contextBridge, ipcRenderer } from "electron";

// ─────────────────────────────────────────────────────────────────────────────
// Type-safe IPC event listener helpers
// ─────────────────────────────────────────────────────────────────────────────

type IpcListener = (...args: unknown[]) => void;
const listenerMap = new WeakMap<IpcListener, IpcListener>();

function on(channel: string, listener: IpcListener): void {
	const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
		listener(...args);
	listenerMap.set(listener, wrapped as IpcListener);
	ipcRenderer.on(channel, wrapped as Parameters<typeof ipcRenderer.on>[1]);
}

function off(channel: string, listener: IpcListener): void {
	const wrapped = listenerMap.get(listener);
	if (wrapped) {
		ipcRenderer.removeListener(
			channel,
			wrapped as Parameters<typeof ipcRenderer.removeListener>[1],
		);
		listenerMap.delete(listener);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects domain
// ─────────────────────────────────────────────────────────────────────────────
const projectsApi = {
	list: () => ipcRenderer.invoke("projects:list") as Promise<unknown[]>,

	get: (id: string) =>
		ipcRenderer.invoke("projects:get", id) as Promise<unknown>,

	create: (input: {
		name: string;
		repoPath: string;
		remoteUrl?: string;
		defaultBranch?: string;
	}) => ipcRenderer.invoke("projects:create", input) as Promise<unknown>,

	update: (
		id: string,
		updates: { name?: string; remoteUrl?: string; defaultBranch?: string },
	) => ipcRenderer.invoke("projects:update", id, updates) as Promise<unknown>,

	delete: (id: string) =>
		ipcRenderer.invoke("projects:delete", id) as Promise<{ ok: boolean }>,

	touch: (id: string) =>
		ipcRenderer.invoke("projects:touch", id) as Promise<{ ok: boolean }>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Plots domain
// ─────────────────────────────────────────────────────────────────────────────
const plotsApi = {
	list: (projectId: string) =>
		ipcRenderer.invoke("plots:list", projectId) as Promise<unknown[]>,

	get: (id: string) => ipcRenderer.invoke("plots:get", id) as Promise<unknown>,

	create: (input: CreatePlot) =>
		ipcRenderer.invoke("plots:create", input) as Promise<unknown>,

	update: (id: string, input: UpdatePlot) =>
		ipcRenderer.invoke("plots:update", { id, ...input }) as Promise<unknown>,

	delete: (id: string) =>
		ipcRenderer.invoke("plots:delete", id) as Promise<void>,

	archive: (id: string) =>
		ipcRenderer.invoke("plots:archive", id) as Promise<void>,

	onStatusChanged: (listener: (plotId: string, status: string) => void) => {
		const wrapped = (plotId: string, status: string) =>
			listener(plotId, status);
		on("plots:status-changed", wrapped as IpcListener);
		return () => off("plots:status-changed", wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Runs domain
// ─────────────────────────────────────────────────────────────────────────────
const runsApi = {
	list: (plotId: string) =>
		ipcRenderer.invoke("runs:list", plotId) as Promise<unknown[]>,

	get: (id: string) => ipcRenderer.invoke("runs:get", id) as Promise<unknown>,

	create: (input: CreateRun) =>
		ipcRenderer.invoke("runs:create", input) as Promise<unknown>,

	cancel: (id: string) =>
		ipcRenderer.invoke("runs:cancel", id) as Promise<void>,

	getChunks: (runId: string, fromSequence = 0) =>
		ipcRenderer.invoke("runs:get-chunks", { runId, fromSequence }) as Promise<
			unknown[]
		>,

	onCostUpdate: (listener: (runId: string, costUsd: number) => void) => {
		const wrapped = (runId: string, costUsd: number) =>
			listener(runId, costUsd);
		on("runs:cost-update", wrapped as IpcListener);
		return () => off("runs:cost-update", wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Grounds domain
// ─────────────────────────────────────────────────────────────────────────────
const groundsApi = {
	list: () => ipcRenderer.invoke("grounds:list") as Promise<unknown[]>,

	create: (input: unknown) =>
		ipcRenderer.invoke("grounds:create", input) as Promise<unknown>,

	update: (id: string, input: Record<string, unknown>) =>
		ipcRenderer.invoke("grounds:update", { id, ...input }) as Promise<unknown>,

	delete: (id: string) =>
		ipcRenderer.invoke("grounds:delete", id) as Promise<void>,

	ping: (id: string) =>
		ipcRenderer.invoke("grounds:ping", id) as Promise<{ latencyMs: number }>,

	createDb: (input: {
		name: string;
		driver: string;
		host: string;
		port: number;
		database: string;
		user: string;
		passwordEnv: string;
		ssl: boolean;
		allowWrite: boolean;
		connectionStringEnv?: string;
	}) => ipcRenderer.invoke("grounds:create-db", input) as Promise<unknown>,

	testDbConnection: (input: {
		driver: string;
		host: string;
		port: number;
		database: string;
		user: string;
		passwordEnv?: string;
		ssl: boolean;
		allowWrite: boolean;
		connectionStringEnv?: string;
	}) =>
		ipcRenderer.invoke("grounds:test-db-connection", input) as Promise<{
			ok: boolean;
			error?: string;
			tablesFound?: number;
		}>,

	getSchema: (id: string) =>
		ipcRenderer.invoke("grounds:get-schema", id) as Promise<unknown>,

	runQuery: (id: string, sql: string, limit?: number) =>
		ipcRenderer.invoke("grounds:run-query", {
			id,
			sql,
			limit,
		}) as Promise<unknown>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Terminal domain
// ─────────────────────────────────────────────────────────────────────────────
const terminalApi = {
	spawn: (input: TerminalSpawnInput) =>
		ipcRenderer.invoke("terminal:spawn", input) as Promise<{ pid: number }>,

	write: (input: TerminalWriteInput) =>
		ipcRenderer.invoke("terminal:write", input) as Promise<void>,

	resize: (input: TerminalResizeInput) =>
		ipcRenderer.invoke("terminal:resize", input) as Promise<void>,

	kill: (runId: string) =>
		ipcRenderer.invoke("terminal:kill", runId) as Promise<void>,

	// Subscribe to live PTY output for a run
	onData: (runId: string, listener: (data: string) => void) => {
		const channel = `terminal:data:${runId}`;
		const wrapped = (data: string) => listener(data);
		on(channel, wrapped as IpcListener);
		return () => off(channel, wrapped as IpcListener);
	},

	onExit: (runId: string, listener: (exitCode: number) => void) => {
		const channel = `terminal:exit:${runId}`;
		const wrapped = (exitCode: number) => listener(exitCode);
		on(channel, wrapped as IpcListener);
		return () => off(channel, wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Traces domain (vector memory)
// ─────────────────────────────────────────────────────────────────────────────
const tracesApi = {
	list: (projectId: string) =>
		ipcRenderer.invoke("traces:list", projectId) as Promise<unknown[]>,

	search: (input: TraceSearchInput) =>
		ipcRenderer.invoke("traces:search", input) as Promise<unknown[]>,

	delete: (id: string) =>
		ipcRenderer.invoke("traces:delete", id) as Promise<void>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Ledger domain (cost dashboard)
// ─────────────────────────────────────────────────────────────────────────────
const ledgerApi = {
	summary: (projectId?: string) =>
		ipcRenderer.invoke("ledger:summary", projectId) as Promise<unknown>,

	entries: (opts: { projectId?: string; limit?: number; offset?: number }) =>
		ipcRenderer.invoke("ledger:entries", opts) as Promise<unknown[]>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tools domain (MCP registry)
// ─────────────────────────────────────────────────────────────────────────────
const toolsApi = {
	list: () => ipcRenderer.invoke("tools:list") as Promise<unknown[]>,

	register: (input: unknown) =>
		ipcRenderer.invoke("tools:register", input) as Promise<unknown>,

	remove: (id: string) =>
		ipcRenderer.invoke("tools:remove", id) as Promise<void>,

	checkHealth: (id: string) =>
		ipcRenderer.invoke("tools:check-health", id) as Promise<{ status: string }>,
};

// ─────────────────────────────────────────────────────────────────────────────
// MCP domain (Model Context Protocol servers)
// ─────────────────────────────────────────────────────────────────────────────
const mcpApi = {
	list: () => ipcRenderer.invoke("mcp:list") as Promise<unknown[]>,

	add: (config: unknown) =>
		ipcRenderer.invoke("mcp:add", config) as Promise<void>,

	remove: (id: string) =>
		ipcRenderer.invoke("mcp:remove", { id }) as Promise<void>,

	start: (id: string) =>
		ipcRenderer.invoke("mcp:start", { id }) as Promise<void>,

	stop: (id: string) => ipcRenderer.invoke("mcp:stop", { id }) as Promise<void>,

	discoverClaude: () =>
		ipcRenderer.invoke("mcp:discoverClaude") as Promise<unknown[]>,

	callTool: (
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	) =>
		ipcRenderer.invoke("mcp:callTool", {
			serverId,
			toolName,
			args,
		}) as Promise<unknown>,

	onStateChanged: (listener: (states: unknown[]) => void) => {
		const wrapped = (states: unknown[]) => listener(states);
		on("mcp:state-changed", wrapped as IpcListener);
		return () => off("mcp:state-changed", wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Team domain (multi-agent coordination)
// ─────────────────────────────────────────────────────────────────────────────
const teamApi = {
	listMessages: (channel: string, fromSequence = 0) =>
		ipcRenderer.invoke("team:list-messages", {
			channel,
			fromSequence,
		}) as Promise<unknown[]>,

	sendMessage: (input: unknown) =>
		ipcRenderer.invoke("team:send-message", input) as Promise<unknown>,

	onMessage: (channel: string, listener: (msg: unknown) => void) => {
		const eventChannel = `team:message:${channel}`;
		const wrapped = (msg: unknown) => listener(msg);
		on(eventChannel, wrapped as IpcListener);
		return () => off(eventChannel, wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Commands domain (slash command registry)
// ─────────────────────────────────────────────────────────────────────────────
const commandsApi = {
	list: (cwd: string) =>
		ipcRenderer.invoke("commands:list", cwd) as Promise<SlashCommandEntry[]>,

	resolve: (text: string, cwd: string) =>
		ipcRenderer.invoke("commands:resolve", {
			text,
			cwd,
		}) as Promise<ResolvedCommand>,

	createCustom: (input: {
		name: string;
		description: string;
		template: string;
		projectDir?: string;
	}) => ipcRenderer.invoke("commands:createCustom", input) as Promise<void>,

	deleteCustom: (filePath: string) =>
		ipcRenderer.invoke("commands:deleteCustom", { filePath }) as Promise<void>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Skills domain (reusable prompt templates)
// ─────────────────────────────────────────────────────────────────────────────
const skillsApi = {
	list: (cwd: string) =>
		ipcRenderer.invoke("skills:list", { cwd }) as Promise<Skill[]>,

	get: (id: string, cwd?: string) =>
		ipcRenderer.invoke("skills:get", { id, cwd }) as Promise<Skill | null>,

	create: (
		skill: Omit<Skill, "id" | "source" | "filePath">,
		scope: "global" | "project",
		projectDir?: string,
	) =>
		ipcRenderer.invoke("skills:create", {
			skill,
			scope,
			projectDir,
		}) as Promise<{ filePath: string }>,

	update: (filePath: string, updates: Partial<Skill>) =>
		ipcRenderer.invoke("skills:update", { filePath, updates }) as Promise<void>,

	delete: (filePath: string) =>
		ipcRenderer.invoke("skills:delete", { filePath }) as Promise<void>,

	render: (skillId: string, args: Record<string, string>, cwd?: string) =>
		ipcRenderer.invoke("skills:render", {
			skillId,
			args,
			cwd,
		}) as Promise<RenderedSkill>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Instances domain (multi-instance support)
// ─────────────────────────────────────────────────────────────────────────────
const instancesApi = {
	list: () =>
		ipcRenderer.invoke("instances:list") as Promise<
			Array<SetraInstance & { alive: boolean }>
		>,

	connect: (id: string) =>
		ipcRenderer.invoke("instances:connect", { id }) as Promise<void>,

	getActive: () =>
		ipcRenderer.invoke("instances:get-active") as Promise<SetraInstance | null>,

	add: (name: string, host: string, port: number) =>
		ipcRenderer.invoke("instances:add", {
			name,
			host,
			port,
		}) as Promise<SetraInstance>,

	remove: (id: string) =>
		ipcRenderer.invoke("instances:remove", { id }) as Promise<void>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory domain (cross-session semantic memory)
// ─────────────────────────────────────────────────────────────────────────────
const memoryApi = {
	add: (input: {
		content: string;
		metadata?: Record<string, unknown>;
		context?: { sessionId?: string; plotId?: string; agentId?: string };
	}) =>
		ipcRenderer.invoke("memory:add", input) as Promise<{
			id: string;
			message?: string;
		}>,

	search: (input: {
		query: string;
		limit?: number;
		minScore?: number;
		plotId?: string;
		sessionId?: string;
	}) => ipcRenderer.invoke("memory:search", input) as Promise<unknown[]>,

	delete: (id: string) =>
		ipcRenderer.invoke("memory:delete", { id }) as Promise<void>,

	clear: (plotId?: string) =>
		ipcRenderer.invoke("memory:clear", { plotId }) as Promise<void>,

	count: () => ipcRenderer.invoke("memory:count") as Promise<number>,

	getModelStatus: () =>
		ipcRenderer.invoke("memory:model-status") as Promise<{
			downloaded: boolean;
			downloading: boolean;
			modelId: string;
			path: string;
			message?: string;
			error?: string | null;
		}>,

	downloadModel: () =>
		ipcRenderer.invoke("memory:download-model") as Promise<{
			downloaded: boolean;
			downloading: boolean;
			modelId: string;
			path: string;
			message?: string;
			error?: string | null;
		}>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Governance domain (air-gap / offline policy)
// ─────────────────────────────────────────────────────────────────────────────
const governanceApi = {
	getPolicy: () =>
		ipcRenderer.invoke("governance:getPolicy") as Promise<unknown>,

	savePolicy: (policy: unknown) =>
		ipcRenderer.invoke("governance:savePolicy", { policy }) as Promise<void>,

	validate: (modelId: string) =>
		ipcRenderer.invoke("governance:validate", { modelId }) as Promise<{
			allowed: boolean;
			reason?: string;
		}>,

	getAuditLog: (limit?: number) =>
		ipcRenderer.invoke("governance:getAuditLog", { limit }) as Promise<
			unknown[]
		>,

	clearAuditLog: () =>
		ipcRenderer.invoke("governance:clearAuditLog") as Promise<void>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Company domain (multi-agent broker integration)
// The renderer opens EventSource directly using the broker URL from IPC.
// ─────────────────────────────────────────────────────────────────────────────
const companyApi = {
	// Get the base broker URL (e.g. "http://localhost:7891") for a running company.
	// Returns null if no broker is registered for this run yet.
	getBrokerUrl: (runId: string) =>
		ipcRenderer.invoke("company:get-broker-url", runId) as Promise<
			string | null
		>,

	getBrokerPort: (runId: string) =>
		ipcRenderer.invoke("company:get-broker-port", runId) as Promise<
			number | null
		>,

	// Get all live agent activity snapshots.
	getActivity: (runId: string) =>
		ipcRenderer.invoke("company:get-activity", runId) as Promise<unknown[]>,

	// Post a human message to the broker.
	postMessage: (runId: string, msg: Record<string, unknown>) =>
		ipcRenderer.invoke("company:post-message", runId, msg) as Promise<unknown>,

	// Get paginated messages from a channel.
	getMessages: (runId: string, channel?: string, sinceId?: string) =>
		ipcRenderer.invoke(
			"company:get-messages",
			runId,
			channel ?? "general",
			sinceId,
		) as Promise<unknown>,

	listTemplates: () =>
		ipcRenderer.invoke("company:list-templates") as Promise<unknown[]>,

	saveCompany: (company: Record<string, unknown>) =>
		ipcRenderer.invoke("company:save", company) as Promise<void>,

	listCompanies: () => ipcRenderer.invoke("company:list") as Promise<unknown[]>,

	deleteCompany: (name: string) =>
		ipcRenderer.invoke("company:delete", name) as Promise<void>,
};
const appApi = {
	version: () => ipcRenderer.invoke("app:version") as Promise<string>,
	openExternal: (url: string) => ipcRenderer.invoke("app:open-external", url),
	pickFolder: () =>
		ipcRenderer.invoke("app:pick-folder") as Promise<string | null>,
	setTheme: (theme: "dark" | "light" | "system") =>
		ipcRenderer.send("app:set-theme", theme),
	onDeepLinkNavigate: (listener: (path: string) => void) => {
		on("deep-link-navigate", listener as IpcListener);
		return () => off("deep-link-navigate", listener as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Models domain (local SLM management via Ollama)
// ─────────────────────────────────────────────────────────────────────────────

export interface OllamaStatus {
	installed: boolean;
	running: boolean;
	version: string;
	path: string;
	port: number;
}

export interface InstalledModel {
	name: string;
	size: string;
	modified: string;
}

export interface PullProgress {
	modelName: string;
	status: string;
	percent?: number;
	downloaded?: string;
	total?: string;
	raw: string;
}

const modelsApi = {
	checkOllama: () =>
		ipcRenderer.invoke("models:check-ollama") as Promise<OllamaStatus>,

	installOllama: () =>
		ipcRenderer.invoke("models:install-ollama") as Promise<void>,

	list: () => ipcRenderer.invoke("models:list") as Promise<InstalledModel[]>,

	pull: (modelName: string) =>
		ipcRenderer.invoke("models:pull", modelName) as Promise<void>,

	delete: (modelName: string) =>
		ipcRenderer.invoke("models:delete", modelName) as Promise<void>,

	onInstallProgress: (cb: (line: string) => void): (() => void) => {
		const wrapped = (line: string) => cb(line);
		on("models:install-progress", wrapped as IpcListener);
		return () => off("models:install-progress", wrapped as IpcListener);
	},

	onPullProgress: (cb: (data: PullProgress) => void): (() => void) => {
		const wrapped = (data: PullProgress) => cb(data);
		on("models:pull-progress", wrapped as IpcListener);
		return () => off("models:pull-progress", wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// PR Review domain
// ─────────────────────────────────────────────────────────────────────────────
const prApi = {
	list: (ownerRepo: string) =>
		ipcRenderer.invoke("pr:list", ownerRepo) as Promise<unknown[]>,

	getDiff: (ownerRepo: string, prNumber: number) =>
		ipcRenderer.invoke("pr:get-diff", ownerRepo, prNumber) as Promise<
			unknown[]
		>,

	submitReview: (
		ownerRepo: string,
		prNumber: number,
		event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
		body: string,
	) =>
		ipcRenderer.invoke(
			"pr:submit-review",
			ownerRepo,
			prNumber,
			event,
			body,
		) as Promise<unknown>,

	startReview: (ownerRepo: string, prNumber: number) =>
		ipcRenderer.invoke(
			"pr:start-review",
			ownerRepo,
			prNumber,
		) as Promise<string>,
};

const monitorApi = {
	getSnapshot: () => ipcRenderer.invoke("monitor:stats") as Promise<unknown>,

	subscribe: (listener: (snap: unknown) => void): (() => void) => {
		void ipcRenderer.invoke("monitor:subscribe");
		on("monitor:snapshot", listener as IpcListener);
		return () => {
			void ipcRenderer.invoke("monitor:unsubscribe");
			off("monitor:snapshot", listener as IpcListener);
		};
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Profile domain (User Intelligence Profile)
// ─────────────────────────────────────────────────────────────────────────────
const profileApi = {
	load: () => ipcRenderer.invoke("profile:load") as Promise<unknown>,

	save: (data: unknown) =>
		ipcRenderer.invoke("profile:save", data) as Promise<{ ok: boolean }>,

	update: (updates: unknown) =>
		ipcRenderer.invoke("profile:update", updates) as Promise<unknown>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Integrations domain
// ─────────────────────────────────────────────────────────────────────────────
const integrationsApi = {
	list: () => ipcRenderer.invoke("integrations:list") as Promise<unknown[]>,

	save: (config: unknown) =>
		ipcRenderer.invoke("integrations:save", config) as Promise<{ ok: boolean }>,

	remove: (integrationId: string) =>
		ipcRenderer.invoke("integrations:remove", integrationId) as Promise<{
			ok: boolean;
		}>,

	test: (integrationId: string, values: Record<string, string>) =>
		ipcRenderer.invoke("integrations:test", integrationId, values) as Promise<{
			ok: boolean;
			message: string;
		}>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Security Tools domain (Sentinel Tool Installer)
// ─────────────────────────────────────────────────────────────────────────────
const securityToolsApi = {
	list: () => ipcRenderer.invoke("security-tools:list") as Promise<unknown>,

	install: (toolId: string) =>
		ipcRenderer.invoke("security-tools:install", toolId) as Promise<{
			success?: boolean;
			error?: string;
		}>,

	installAll: () =>
		ipcRenderer.invoke("security-tools:install-all") as Promise<void>,

	check: (toolId: string) =>
		ipcRenderer.invoke("security-tools:check", toolId) as Promise<{
			installed: boolean;
			version?: string;
		}>,

	onInstallEvent: (
		toolId: string,
		cb: (evt: unknown) => void,
	): (() => void) => {
		const channel = `security-tools:install-event:${toolId}`;
		const wrapped = (evt: unknown) => cb(evt);
		on(channel, wrapped as IpcListener);
		return () => off(channel, wrapped as IpcListener);
	},

	onInstallAllEvent: (cb: (evt: unknown) => void): (() => void) => {
		const wrapped = (evt: unknown) => cb(evt);
		on("security-tools:install-all-event", wrapped as IpcListener);
		return () =>
			off("security-tools:install-all-event", wrapped as IpcListener);
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Wiki domain
// ─────────────────────────────────────────────────────────────────────────────
const wikiApi = {
	read: (slug: string) =>
		ipcRenderer.invoke("wiki:read", slug) as Promise<unknown>,

	write: (slug: string, content: string, authorSlug?: string) =>
		ipcRenderer.invoke("wiki:write", slug, content, authorSlug) as Promise<{
			slug: string;
			commitSha: string;
			created: boolean;
		}>,

	list: (section?: string) =>
		ipcRenderer.invoke("wiki:list", section) as Promise<unknown[]>,

	search: (query: string) =>
		ipcRenderer.invoke("wiki:search", query) as Promise<unknown[]>,

	toc: () => ipcRenderer.invoke("wiki:toc") as Promise<string>,

	delete: (slug: string, authorSlug?: string) =>
		ipcRenderer.invoke("wiki:delete", slug, authorSlug) as Promise<{
			ok: boolean;
		}>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Kanban domain
// ─────────────────────────────────────────────────────────────────────────────
const kanbanApi = {
	listBoards: () =>
		ipcRenderer.invoke("kanban:list-boards") as Promise<unknown[]>,

	createBoard: (name: string, description?: string, createdBy?: string) =>
		ipcRenderer.invoke(
			"kanban:create-board",
			name,
			description,
			createdBy,
		) as Promise<unknown>,

	getBoard: (boardId: string) =>
		ipcRenderer.invoke("kanban:get-board", boardId) as Promise<unknown>,

	createCard: (
		boardId: string,
		columnId: string,
		title: string,
		priority?: string,
		opts?: unknown,
		createdBy?: string,
	) =>
		ipcRenderer.invoke(
			"kanban:create-card",
			boardId,
			columnId,
			title,
			priority,
			opts,
			createdBy,
		) as Promise<unknown>,

	moveCard: (cardId: string, toColumnId: string, toPosition?: number) =>
		ipcRenderer.invoke(
			"kanban:move-card",
			cardId,
			toColumnId,
			toPosition,
		) as Promise<{ ok: boolean }>,

	updateCard: (cardId: string, updates: unknown) =>
		ipcRenderer.invoke(
			"kanban:update-card",
			cardId,
			updates,
		) as Promise<unknown>,

	deleteCard: (cardId: string) =>
		ipcRenderer.invoke("kanban:delete-card", cardId) as Promise<{
			ok: boolean;
		}>,

	createColumn: (
		boardId: string,
		name: string,
		position: number,
		color?: string,
		wipLimit?: number,
	) =>
		ipcRenderer.invoke(
			"kanban:create-column",
			boardId,
			name,
			position,
			color,
			wipLimit,
		) as Promise<unknown>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Web Search API
// ─────────────────────────────────────────────────────────────────────────────
const webSearchApi = {
	search: (query: string, maxResults?: number) =>
		ipcRenderer.invoke(
			"web-search:search",
			query,
			maxResults,
		) as Promise<unknown>,
	provider: () => ipcRenderer.invoke("web-search:provider") as Promise<string>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Settings API — persists API keys and config in SQLite (main process)
// ─────────────────────────────────────────────────────────────────────────────
const settingsApi = {
	get: () =>
		ipcRenderer.invoke("settings:get") as Promise<Record<string, string>>,
	set: (key: string, value: string) =>
		ipcRenderer.invoke("settings:set", key, value) as Promise<{ ok: boolean }>,
	setMany: (entries: Record<string, string>) =>
		ipcRenderer.invoke("settings:set-many", entries) as Promise<{
			ok: boolean;
		}>,
	delete: (key: string) =>
		ipcRenderer.invoke("settings:delete", key) as Promise<{ ok: boolean }>,
};

// ─────────────────────────────────────────────────────────────────────────────
// Expose the full typed API via contextBridge
// window.setra is available in the renderer with full TypeScript types
// ─────────────────────────────────────────────────────────────────────────────
const setraApi = {
	projects: projectsApi,
	plots: plotsApi,
	runs: runsApi,
	grounds: groundsApi,
	terminal: terminalApi,
	traces: tracesApi,
	ledger: ledgerApi,
	tools: toolsApi,
	mcp: mcpApi,
	team: teamApi,
	commands: commandsApi,
	skills: skillsApi,
	instances: instancesApi,
	memory: memoryApi,
	governance: governanceApi,
	models: modelsApi,
	app: appApi,
	monitor: monitorApi,
	company: companyApi,
	pr: prApi,
	securityTools: securityToolsApi,
	profile: profileApi,
	integrations: integrationsApi,
	wiki: wikiApi,
	kanban: kanbanApi,
	settings: settingsApi,
	webSearch: webSearchApi,
};

contextBridge.exposeInMainWorld("setra", setraApi);

// Extend Window interface — import this declaration in renderer tsconfig
declare global {
	interface Window {
		setra: typeof setraApi;
	}
}
