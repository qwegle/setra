// Typed API wrapper — thin fetch client
// Enterprise version replaces this with @setra/core-client + tRPC

const BASE = import.meta.env.VITE_API_URL ?? "/api";

const AUTH_TOKEN_KEY = "setra:auth-token";
// Mirrors STORAGE_KEY_SELECTED from CompanyContext.tsx — kept as a string
// literal (not imported) so we don't pull React into pure fetch helpers.
const SELECTED_COMPANY_KEY = "setra:selectedCompanyId";

function getAuthToken(): string | null {
	try {
		const token = localStorage.getItem(AUTH_TOKEN_KEY)?.trim();
		return token ? token : null;
	} catch {
		return null;
	}
}

function clearStoredAuth() {
	try {
		localStorage.removeItem(AUTH_TOKEN_KEY);
		localStorage.removeItem(SELECTED_COMPANY_KEY);
	} catch {
		// Ignore storage failures during forced logout.
	}
}

function getSelectedCompanyId(): string | null {
	try {
		const raw = localStorage.getItem(SELECTED_COMPANY_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw);
		return typeof v === "string" && v.length > 0 ? v : null;
	} catch {
		return null;
	}
}

function formatRequestError(status: number, text: string): string {
	const raw = text.trim();
	let message = raw;
	if (raw.startsWith("{")) {
		try {
			const parsed = JSON.parse(raw) as {
				message?: string;
				error?: string;
				details?: string;
			};
			message = parsed.message ?? parsed.error ?? parsed.details ?? raw;
		} catch {
			message = raw;
		}
	}
	message = message.replace(/\s+/g, " ").trim();
	if (
		/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|Failed to fetch|fetch failed|NetworkError/i.test(
			message,
		)
	) {
		return "Could not connect to the server. Make sure it is running.";
	}
	if (!message) {
		if (status === 404) return "We could not find what you were looking for.";
		if (status === 401 || status === 403)
			return "You do not have permission to do that.";
		if (status >= 500)
			return "The server hit a problem. Please try again in a moment.";
		return "Something went wrong. Please try again.";
	}
	if (status >= 500)
		return "The server hit a problem. Please try again in a moment.";
	if (status === 404)
		return message || "We could not find what you were looking for.";
	if (status === 401 || status === 403) {
		return message || "You do not have permission to do that.";
	}
	return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const cid = getSelectedCompanyId();
	const token = getAuthToken();
	const headers = new Headers(init?.headers);
	if (!headers.has("Content-Type"))
		headers.set("Content-Type", "application/json");
	if (cid && !headers.has("x-company-id")) headers.set("x-company-id", cid);
	if (token && !headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	const hasAuth = headers.has("Authorization");

	let res: Response;
	try {
		res = await globalThis.fetch(`${BASE}${path}`, { ...init, headers });
	} catch {
		throw new Error(
			"Could not connect to the server. Make sure it is running.",
		);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		if (res.status === 401) {
			clearStoredAuth();
			if (
				hasAuth &&
				typeof window !== "undefined" &&
				window.location.pathname !== "/login"
			) {
				window.location.replace("/login");
			}
		}
		throw new Error(formatRequestError(res.status, text));
	}
	return res.json() as Promise<T>;
}

const fetch = <T>(path: string) => request<T>(path);
const post = <T = unknown>(path: string, body?: unknown) =>
	request<T>(path, {
		method: "POST",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
const put = <T = unknown>(path: string, body?: unknown) =>
	request<T>(path, {
		method: "PUT",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
const del = <T = unknown>(path: string) =>
	request<T>(path, {
		method: "DELETE",
	});

export type IssueStatus =
	| "backlog"
	| "todo"
	| "in_progress"
	| "in_review"
	| "done"
	| "cancelled"
	| "blocked";
export type IssuePriority = "none" | "urgent" | "high" | "medium" | "low";
export type IssueTestStatus =
	| "none"
	| "pending"
	| "running"
	| "passed"
	| "failed";
export type AgentStatus =
	| "idle"
	| "running"
	| "waiting_approval"
	| "paused"
	| "error"
	| "done"
	| "completed"
	| "pending"
	| "inactive"
	| "awaiting_key"
	| "on_break";
export type AgentRunMode = "on_demand" | "continuous" | "scheduled";

// SDLC delivery loop — every issue moves through this 9-stage pipeline.
// 'cancelled' is a terminal off-ramp from any stage. The state machine lives
// server-side at apps/server/src/lib/lifecycle.ts.
export type LifecycleStage =
	| "backlog"
	| "branched"
	| "committed"
	| "pr_open"
	| "in_review"
	| "merged"
	| "deployed"
	| "verified"
	| "cancelled";

export interface LifecycleEvent {
	id: string;
	fromStage: LifecycleStage | null;
	toStage: LifecycleStage;
	actorType: "system" | "human" | "agent";
	actorId: string | null;
	occurredAt: string;
}

export interface Issue {
	id: string;
	projectId: string;
	slug: string;
	title: string;
	description: string | null;
	status: IssueStatus;
	priority: IssuePriority;
	assignedAgentId: string | null;
	estimatedCostUsd: number | null;
	actualCostUsd: number | null;
	labels: string;
	tags: string;
	createdAt: string;
	updatedAt: string;
	reviewStatus?: string | null;
	reviewRound?: number;
	subIssueCount?: number;
	// Git binding (added in v1 SDLC backbone)
	branchName?: string | null;
	prUrl?: string | null;
	prState?: "open" | "merged" | "closed" | null;
	commitShas?: string | null;
	// SDLC delivery loop
	lifecycleStage?: LifecycleStage;
	lifecycle?: LifecycleEvent[];
	acceptanceCriteria?: string;
	testCommand?: string;
	testStatus?: IssueTestStatus;
	// Extended fields
	identifier?: string;
	parentIssueId?: string | null;
	dueDate?: string | null;
	blockedByIssueIds?: string[];
}

export interface IssueComment {
	id: string;
	issue_id: string;
	author: string;
	body: string;
	created_at: string;
	updated_at: string;
}

export interface ActivityEntry {
	id: string;
	issue_id: string | null;
	project_id: string | null;
	actor: string;
	event: string;
	payload: string | null;
	created_at: string;
}

export interface PaginatedActivityEntries {
	items: ActivityEntry[];
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
}

export interface CreateIssueInput {
	projectId: string;
	title: string;
	description?: string;
	status?: IssueStatus;
	priority?: IssuePriority;
	assignedAgentId?: string;
	parentIssueId?: string;
	acceptanceCriteria?: string;
	testCommand?: string;
	testStatus?: IssueTestStatus;
}

export type ProjectPlanStatus =
	| "none"
	| "draft"
	| "approved"
	| "in_progress"
	| "completed";

export interface ProjectSettings {
	autoTestEnabled: boolean;
	testCommand: string;
	maxParallelRuns: number;
	budgetCapUsd: number;
	autoApprove: boolean;
	defaultBranch: string;
}

export interface Project {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	issueCount: number;
	activeAgentCount: number;
	totalCostUsd: number;
	createdAt: string;
	workspacePath?: string | null;
	companyId?: string | null;
	// Git binding
	repoUrl?: string | null;
	repoPath?: string | null;
	defaultBranch?: string | null;
	gitInitialized?: number | boolean | null;
	// Project planning
	requirements?: string | null;
	planStatus?: ProjectPlanStatus | null;
	settingsJson?: string | null;
	// SDLC delivery loop
	color?: string | null;
}

export interface ProjectRule {
	name: string;
	glob?: string;
	content: string;
}

export interface Environment {
	id: string;
	name: string;
	ground_type: "local" | "ssh" | "docker" | "database";
	host: string;
	port: number;
	username: string;
	auth_type: "key" | "password" | "agent";
	key_path: string | null;
	secret_ref: string | null;
	company_id: string | null;
	project_id: string | null;
	docker_image: string | null;
	docker_network: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface EnvironmentInput {
	name: string;
	type: "local" | "ssh" | "docker";
	host?: string | undefined;
	port?: number;
	username?: string | undefined;
	authType?: "key" | "password" | "agent";
	keyPath?: string | undefined;
	secretRef?: string | undefined;
	projectId?: string | undefined;
	dockerImage?: string | undefined;
	dockerNetwork?: string | undefined;
	notes?: string | undefined;
}

// Returned by GET /api/projects/:id/sdlc-stats.
export interface SdlcStats {
	counts: Record<LifecycleStage, number>;
	cycle_time_median_hours: number | null;
	activity_last_24h: number;
	activity_sparkline: number[]; // 24 hourly buckets, oldest first
}

export interface Agent {
	id: string;
	slug: string;
	displayName: string;
	role: string;
	adapterType?: string;
	model: string | null;
	status: AgentStatus;
	currentIssueId: string | null;
	runMode?: AgentRunMode;
	continuousIntervalMs?: number;
	idlePrompt?: string | null;
	lastRunEndedAt?: string | null;
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens?: number;
	totalRuns?: number;
	lastActiveAt: string | null;
	credibility?: number;
	successRate?: number | null;
	experienceLevel?: string;
	topSkills?: string[];
}

export interface ProjectAgent {
	id: string;
	projectId: string;
	agentRosterId: string;
	role: string;
	assignedBy: string | null;
	assignedAt: string;
	agentId: string;
	slug: string;
	displayName: string;
	agentRole: string;
	status: AgentStatus;
	adapterType: string | null;
	modelId: string | null;
	isActive: number;
	lastRefreshedAt: string | null;
}

export interface ContextRefreshResult {
	pruned: number;
	remaining: number;
	summary: string;
	projects?: Array<{
		projectId: string;
		pruned: number;
		remaining: number;
		summary: string;
	}>;
	agents?: Array<{
		agentRosterId: string;
		slug: string;
		pruned: number;
		remaining: number;
		summary: string;
	}>;
}

export interface ProjectBreakResponse {
	breakId: string;
	endsAt: string;
	agents: Array<{ id: string; slug: string; displayName: string }>;
}

export interface DatabaseConnection {
	id: string;
	name: string;
	type: string;
	connectionString?: string;
	host?: string;
	port?: number;
	database?: string;
	status: "connected" | "error";
	createdAt: string;
}

export interface RunStatus {
	running: boolean;
	lines: string[];
	url: string | null;
	startedAt?: string;
}

export interface ChecklistItem {
	id: string;
	category: string;
	title: string;
	description: string;
	status: "pending" | "pass" | "fail";
}

export interface CollabMessage {
	id: string;
	channel: string;
	fromAgent: string;
	content: string;
	createdAt: string;
}

export interface ProjectChannel {
	slug: string;
	name: string;
}

export interface AgentHeartbeat {
	agentId: string;
	slug: string;
	lastHeartbeatAt: string | null;
	ageSeconds: number | null;
	stale: boolean;
	activeRuns: number;
}

export interface FileTreeEntry {
	type: "file" | "dir";
	name: string;
	path: string;
	children?: FileTreeEntry[];
}

export interface FilesActivity {
	runId: string;
	agentSlug: string;
	status: string;
	updatedAt: string;
	issueId: string | null;
	issueTitle: string | null;
	preview: string;
}

export interface FileContentResponse {
	path: string;
	content: string | null;
	isBinary: boolean;
	size: number;
	mimeType: string | null;
	encoding: "utf8" | "base64" | null;
}

export interface FileSearchMatch {
	line: number;
	column: number;
	preview: string;
	before: string | null;
	after: string | null;
}

export interface FileSearchResult {
	path: string;
	matches: FileSearchMatch[];
}

export interface FileSearchResponse {
	query: string;
	results: FileSearchResult[];
}

export interface ProjectExecResponse {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	pid: number | null;
}

export interface ProjectExecStopResponse {
	ok: boolean;
	message?: string;
	pid?: number | null;
}

export interface McpServerConfig {
	id: string;
	name: string;
	transport: string;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	autoStart: boolean;
	description?: string;
}

export interface McpToolInfo {
	serverId: string;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpServerInfo {
	config: McpServerConfig;
	status: string;
	tools: McpToolInfo[];
	pid?: number;
	error?: string;
}

export interface ProjectSecret {
	id: string;
	key: string;
	maskedValue: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectContextDocument {
	content: string;
	updatedAt: string;
}

export interface GitCommit {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	date: string;
	filesChanged?: number;
}

export interface GitLogResponse {
	commits: GitCommit[];
}

export interface GitBranchesResponse {
	branches: { name: string; current: boolean }[];
}

export interface GitDiffResponse {
	sha: string;
	message: string;
	diff: string;
}

export interface GitWorkingDiffResponse {
	path: string;
	diff: string;
}

export interface GitStatusFile {
	path: string;
	status: string;
	indexStatus: string;
	workingTreeStatus: string;
	staged: boolean;
}

export interface GitStatusResponse {
	files: GitStatusFile[];
}

export interface BudgetSummary {
	dailyCostUsd: number;
	weeklyCostUsd: number;
	monthlyCostUsd: number;
	cacheHitRate: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	topAgents: Array<{ slug: string; costUsd: number; model: string }>;
	alerts?: string[];
	periodDays?: number;
	periodSpendUsd?: number;
	estimatedCacheSavingsUsd?: number;
	hardStop?: {
		triggered: boolean;
		agentsPaused: number;
		runsCancelled: number;
	};
}

export interface Skill {
	id: string;
	name: string;
	slug: string;
	description: string;
	category: "code" | "web" | "security" | "data" | "custom";
	trigger: string;
	prompt: string;
	isActive: boolean;
	usageCount: number;
	lastUsedAt: string | null;
	createdAt: string;
}

export interface Artifact {
	id: string;
	name: string;
	type: "code" | "document" | "image" | "archive" | "data";
	mimeType: string;
	sizeBytes: number;
	issueId: string | null;
	issueSlug: string | null;
	agentSlug: string;
	description: string;
	content: string | null;
	downloadUrl: string;
	createdAt: string;
}

export interface WikiEntry {
	id: string;
	title: string;
	slug: string;
	content: string;
	category: string;
	tags: string[];
	authorSlug: string;
	updatedAt: string;
	createdAt: string;
}

export interface ReviewItem {
	id: string;
	type: "approval" | "code_review" | "budget_override" | "security_sign_off";
	title: string;
	description: string;
	requestedBy: string;
	targetIssueSlug: string | null;
	estimatedCostUsd: number | null;
	diff: string | null;
	riskLevel: "low" | "medium" | "high";
	status: "pending" | "approved" | "rejected";
	comment: string | null;
	createdAt: string;
	resolvedAt: string | null;
}

export interface OrgMember {
	id: string;
	name: string;
	email: string;
	role: "owner" | "admin" | "member" | "viewer";
	joinedAt: string;
}

export interface OrgStats {
	totalAgentRuns: number;
	totalCostUsd: number;
	activeMembers: number;
	thisMonthCostUsd: number;
}

export interface CloneProfile {
	id: string;
	name: string;
	mode: "training" | "locked";
	brief: string | null;
	trainedAt: string | null;
	lockedAt: string | null;
}

export interface CloneQaItem {
	id: string;
	question: string;
	aspect: string;
	answer: string | null;
}

export type CostTier = "low" | "medium" | "high";

export interface AgentTemplate {
	id: string;
	name: string;
	description: string | null;
	agent: string;
	model: string | null;
	system_prompt: string | null;
	tools: string | null;
	context_inject: string | null;
	estimated_cost_tier: CostTier;
	is_builtin: number;
	created_at: string;
	updated_at: string;
}

export interface RosterEntry {
	id: string;
	display_name: string;
	reports_to: string | null;
	is_active: number;
	hired_at: string;
	updated_at: string;
	template_id: string;
	template_name: string;
	description: string | null;
	agent: string;
	model: string | null;
	estimated_cost_tier: CostTier;
	is_builtin: number;
	/** Live runtime status from agent_roster (joined). Null if no matching row. */
	runtime_status:
		| "idle"
		| "awaiting_key"
		| "running"
		| "paused"
		| "on_break"
		| null;
	paused_reason: string | null;
	adapter_type: string | null;
	model_id: string | null;
	run_mode?: AgentRunMode;
	continuous_interval_ms?: number | null;
	idle_prompt?: string | null;
	last_run_ended_at?: string | null;
	/** agent_roster.id (different from id which is company_roster.id). Use this for /agents/:id deep links. */
	agent_id: string | null;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	score?: number;
}
export interface SearchResponse {
	query: string;
	provider: string;
	results: SearchResult[];
}

const listActivity = ((page?: number, pageSize = 50, filter?: string) => {
	const params = new URLSearchParams({
		page: String(page ?? 1),
		pageSize: String(pageSize),
	});
	if (filter && filter !== "all") params.set("filter", filter);
	return request<PaginatedActivityEntries>(
		`/activity?${params.toString()}`,
	).then((result) => (page === undefined ? result.items : result));
}) as {
	(): Promise<ActivityEntry[]>;
	(
		page: number,
		pageSize?: number,
		filter?: string,
	): Promise<PaginatedActivityEntries>;
};

export interface CliStatus {
	id: string;
	label: string;
	bin: string;
	installed: boolean;
	version: string | null;
	installCommand: string;
	docUrl: string;
	checkedAt: number;
}

export const api = {
	auth: {
		login: (body: { email: string; password: string }) =>
			request<{
				token: string;
				user: {
					id: string;
					email: string;
					name: string | null;
					companyId: string;
					role: "owner" | "admin" | "member";
				};
			}>("/auth/login", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		register: (body: {
			email: string;
			password: string;
			name: string;
			companyName: string;
		}) =>
			request<{
				token: string;
				user: {
					id: string;
					email: string;
					name: string | null;
					companyId: string;
					role: "owner" | "admin" | "member";
				};
				company?: { id: string; name: string };
			}>("/auth/register", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		me: () =>
			request<{
				user: {
					id: string;
					email: string;
					name: string | null;
					companyId: string;
					role: "owner" | "admin" | "member";
				};
			}>("/auth/me"),
		logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
	},
	projects: {
		list: () => request<Project[]>("/projects"),
		get: (id: string) => request<Project>(`/projects/${id}`),
		create: (body: {
			name: string;
			description?: string;
			workspacePath?: string;
			repoUrl?: string;
			color?: string;
			requirements?: string;
			planStatus?: ProjectPlanStatus;
		}) =>
			request<Project>("/projects", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (
			id: string,
			body: {
				name?: string;
				description?: string | null;
				color?: string;
				workspacePath?: string | null;
				repoUrl?: string | null;
				defaultBranch?: string | null;
				requirements?: string | null;
				planStatus?: ProjectPlanStatus;
			},
		) =>
			request<{ ok: true; noop?: boolean }>(`/projects/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		requirements: {
			get: (id: string) =>
				request<{ requirements: string }>(`/projects/${id}/requirements`),
			update: (id: string, requirements: string) =>
				put<{ ok: true; requirements: string }>(
					`/projects/${id}/requirements`,
					{
						requirements,
					},
				),
		},
		settings: {
			get: (id: string) => request<ProjectSettings>(`/projects/${id}/settings`),
			update: (id: string, body: Partial<ProjectSettings>) =>
				put<{ ok: true }>(`/projects/${id}/settings`, body),
		},
		rules: {
			list: (id: string) => request<ProjectRule[]>(`/projects/${id}/rules`),
			upsert: (id: string, name: string, body: { content: string }) =>
				put<ProjectRule>(
					`/projects/${id}/rules/${encodeURIComponent(name)}`,
					body,
				),
			delete: (id: string, name: string) =>
				del<{ deleted: boolean }>(
					`/projects/${id}/rules/${encodeURIComponent(name)}`,
				),
		},
		sdlcStats: (id: string) => request<SdlcStats>(`/projects/${id}/sdlc-stats`),
	},
	issues: {
		list: (projectId: string) =>
			request<Issue[]>(`/projects/${projectId}/issues`),
		get: (id: string) => request<Issue>(`/issues/${id}`),
		create: (body: CreateIssueInput) =>
			request<Issue>("/issues", { method: "POST", body: JSON.stringify(body) }),
		update: (id: string, body: Partial<Issue>) =>
			request<Issue>(`/issues/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		delete: (id: string) =>
			request<{ deleted: boolean }>(`/issues/${id}`, { method: "DELETE" }),
		branch: (id: string) =>
			request<{ ok: true; branchName: string; fromBranch: string }>(
				`/issues/${id}/branch`,
				{ method: "POST", body: JSON.stringify({}) },
			),
		commit: (id: string, body: { message: string; files?: string[] }) =>
			request<{ ok: true; sha: string; noChanges: boolean }>(
				`/issues/${id}/commit`,
				{ method: "POST", body: JSON.stringify(body) },
			),
		openPr: (id: string, body: { title: string; body?: string }) =>
			request<{ ok: true; prUrl: string; prState: "open"; stub: boolean }>(
				`/issues/${id}/pr`,
				{ method: "POST", body: JSON.stringify(body) },
			),
		mergePr: (id: string) =>
			request<{ ok: true; prState: "merged"; mergeSha: string | null }>(
				`/issues/${id}/pr/merge`,
				{ method: "POST", body: JSON.stringify({}) },
			),
		link: (
			id: string,
			body: {
				commitSha?: string;
				prUrl?: string;
				prState?: "open" | "merged" | "closed";
			},
		) =>
			request<{
				ok: true;
				prUrl: string | null;
				prState: "open" | "merged" | "closed" | null;
				commitShas: string[];
			}>(`/issues/${id}/link`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
		lifecycle: (id: string, stage: LifecycleStage) =>
			request<{ ok: true; stage: LifecycleStage }>(`/issues/${id}/lifecycle`, {
				method: "POST",
				body: JSON.stringify({ stage }),
			}),
		comments: {
			list: (issueId: string) =>
				request<IssueComment[]>(`/issues/${issueId}/comments`),
			create: (issueId: string, body: { body: string; author?: string }) =>
				request<IssueComment>(`/issues/${issueId}/comments`, {
					method: "POST",
					body: JSON.stringify(body),
				}),
			delete: (issueId: string, commentId: string) =>
				request<{ deleted: boolean }>(
					`/issues/${issueId}/comments/${commentId}`,
					{ method: "DELETE" },
				),
		},
		subIssues: (issueId: string) =>
			request<Issue[]>(`/issues/${issueId}/sub-issues`),
		runTests: (issueId: string) =>
			request<{ ok: true }>(`/issues/${issueId}/tests/run`, {
				method: "POST",
				body: JSON.stringify({}),
			}),
		activity: (issueId: string) =>
			request<ActivityEntry[]>(`/issues/${issueId}/activity`),
	},
	agents: {
		list: () => request<Agent[]>("/agents"),
		heartbeat: () => request<AgentHeartbeat[]>("/agents/heartbeat"),
		getExperienceSummary: () =>
			request<AgentsExperienceSummary>("/agents/experience/summary"),
		get: (id: string) => request<Agent>(`/agents/${id}`),
		update: (id: string, body: { model?: string; status?: string }) =>
			request<Agent>(`/agents/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		templates: {
			list: () => request<AgentTemplate[]>("/agents/templates"),
			create: (body: {
				name: string;
				description?: string;
				agent: string;
				model?: string;
				systemPrompt?: string;
				estimatedCostTier?: string;
			}) =>
				request<AgentTemplate>("/agents/templates", {
					method: "POST",
					body: JSON.stringify(body),
				}),
		},
		roster: {
			list: (companyId?: string) =>
				request<RosterEntry[]>(
					`/agents/roster${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`,
				),
			hire: (body: {
				templateId: string;
				displayName: string;
				reportsTo?: string | null;
				companyId?: string | null;
				modelId?: string | null;
				adapterType?: string | undefined;
				runMode?: AgentRunMode;
				continuousIntervalMs?: number;
				idlePrompt?: string | null;
			}) =>
				request<RosterEntry>("/agents/roster", {
					method: "POST",
					body: JSON.stringify(body),
				}),
			update: (
				id: string,
				body: {
					displayName?: string;
					reportsTo?: string | null;
					isActive?: boolean;
					runMode?: AgentRunMode;
					continuousIntervalMs?: number;
					idlePrompt?: string | null;
				},
			) =>
				request<RosterEntry>(`/agents/roster/${id}`, {
					method: "PATCH",
					body: JSON.stringify(body),
				}),
			setMode: (
				id: string,
				body: {
					runMode: AgentRunMode;
					continuousIntervalMs?: number;
					idlePrompt?: string | null;
				},
			) =>
				request<RosterEntry>(`/agents/roster/${id}/mode`, {
					method: "PATCH",
					body: JSON.stringify(body),
				}),
			fire: (id: string) =>
				request<{ ok: boolean }>(`/agents/roster/${id}`, { method: "DELETE" }),
		},
		generateInstructions: (body: {
			role: string;
			companyGoal?: string;
			companyName?: string;
		}) =>
			request<{ instructions: string }>("/agents/generate-instructions", {
				method: "POST",
				body: JSON.stringify(body),
			}),
	},
	files: {
		tree: (projectId: string) =>
			request<{ root: string; tree: FileTreeEntry[] }>(
				`/files/tree?projectId=${encodeURIComponent(projectId)}`,
			),
		content: (projectId: string, filePath: string) =>
			request<FileContentResponse>(
				`/files/content?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`,
			),
		search: (projectId: string, query: string) =>
			request<FileSearchResponse>(
				`/projects/${projectId}/files/search?q=${encodeURIComponent(query)}`,
			),
		save: (body: { projectId: string; path: string; content: string }) =>
			request<{ ok: true }>("/files/content", {
				method: "PUT",
				body: JSON.stringify(body),
			}),
		createFile: (body: { projectId: string; path: string; content?: string }) =>
			request<{ ok: true }>("/files/file", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		createFolder: (body: { projectId: string; path: string }) =>
			request<{ ok: true }>("/files/folder", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		deletePath: (projectId: string, filePath: string) =>
			request<{ ok: true }>(
				`/files/node?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`,
				{ method: "DELETE" },
			),
		renamePath: (body: {
			projectId: string;
			fromPath: string;
			toPath: string;
		}) =>
			request<{ ok: true; fromPath: string; toPath: string }>("/files/rename", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		activity: (projectId: string) =>
			request<FilesActivity[]>(
				`/files/activity?projectId=${encodeURIComponent(projectId)}`,
			),
	},
	mcp: {
		servers: () =>
			fetch<{ servers: McpServerInfo[] }>("/mcp/servers").then(
				(r) => r.servers,
			),
		add: (config: Partial<McpServerConfig>) => post("/mcp/servers", config),
		update: (id: string, config: Partial<McpServerConfig>) =>
			put(`/mcp/servers/${id}`, config),
		remove: (id: string) => del(`/mcp/servers/${id}`),
		start: (id: string) => post(`/mcp/servers/${id}/start`),
		stop: (id: string) => post(`/mcp/servers/${id}/stop`),
		tools: (id: string) =>
			fetch<{ tools: McpToolInfo[] }>(`/mcp/servers/${id}/tools`).then(
				(r) => r.tools,
			),
		discover: () =>
			post<{ servers: McpServerConfig[] }>("/mcp/discover").then(
				(r) => r.servers,
			),
	},
	projectSecrets: {
		list: (projectId: string) =>
			fetch<{ secrets: Array<ProjectSecret & { value?: string }> }>(
				`/projects/${projectId}/secrets`,
			).then((response) =>
				response.secrets.map((secret) => ({
					...secret,
					maskedValue: secret.maskedValue ?? secret.value ?? "",
				})),
			),
		create: (projectId: string, key: string, value: string) =>
			post(`/projects/${projectId}/secrets`, { key, value }),
		remove: (projectId: string, key: string) =>
			del(`/projects/${projectId}/secrets/${key}`),
	},
	projectGit: {
		log: (projectId: string, page?: number) =>
			fetch<GitLogResponse>(`/projects/${projectId}/git/log?page=${page ?? 1}`),
		branches: (projectId: string) =>
			fetch<GitBranchesResponse>(`/projects/${projectId}/git/branches`),
		checkout: (projectId: string, branch: string) =>
			post<{ ok: true; branch: string }>(
				`/projects/${projectId}/git/checkout`,
				{
					branch,
				},
			),
		pull: (projectId: string) =>
			post<{ ok: true; output: string }>(`/projects/${projectId}/git/pull`),
		push: (projectId: string) =>
			post<{ ok: true; output: string }>(`/projects/${projectId}/git/push`),
		stage: (projectId: string, filePath: string) =>
			post<{ ok: true; path: string }>(`/projects/${projectId}/git/stage`, {
				path: filePath,
			}),
		unstage: (projectId: string, filePath: string) =>
			post<{ ok: true; path: string }>(`/projects/${projectId}/git/unstage`, {
				path: filePath,
			}),
		stashSave: (projectId: string, message?: string) =>
			post<{ ok: true; output: string }>(`/projects/${projectId}/git/stash`, {
				...(message ? { message } : {}),
			}),
		stashPop: (projectId: string) =>
			post<{ ok: true; output: string }>(
				`/projects/${projectId}/git/stash/pop`,
			),
		diff: (projectId: string, sha: string) =>
			fetch<GitDiffResponse>(`/projects/${projectId}/git/diff/${sha}`),
		workingDiff: (projectId: string, filePath: string) =>
			fetch<GitWorkingDiffResponse>(
				`/projects/${projectId}/git/working-diff?path=${encodeURIComponent(filePath)}`,
			),
		commit: (projectId: string, message: string) =>
			post<{ ok: true; sha: string }>(`/projects/${projectId}/git/commit`, {
				message,
			}),
		status: (projectId: string) =>
			fetch<GitStatusResponse>(`/projects/${projectId}/git/status`),
		revert: (projectId: string, sha: string, hard = false) =>
			post<{ ok: boolean; head: string }>(`/projects/${projectId}/git/revert`, {
				sha,
				hard,
			}),
		remote: (projectId: string) =>
			fetch<{ remoteUrl: string | null; branch: string }>(
				`/projects/${projectId}/git/remote`,
			),
	},
	projectWorkspace: {
		exec: (
			projectId: string,
			body: { command: string; cwd?: string },
			init?: { signal?: AbortSignal },
		) =>
			request<ProjectExecResponse>(`/projects/${projectId}/exec`, {
				method: "POST",
				body: JSON.stringify(body),
				...(init?.signal ? { signal: init.signal } : {}),
			}),
		stopExec: (projectId: string) =>
			post<ProjectExecStopResponse>(`/projects/${projectId}/exec/stop`),
	},
	projectContext: {
		get: (projectId: string) =>
			fetch<ProjectContextDocument>(`/projects/${projectId}/context`),
		update: (projectId: string, content: string) =>
			put(`/projects/${projectId}/context`, { content }),
	},
	getProjectAgents: (projectId: string) =>
		request<ProjectAgent[]>(`/projects/${projectId}/agents`),
	assignAgent: (projectId: string, agentRosterId: string, role = "member") =>
		post<{ ok: true }>(`/projects/${projectId}/agents`, {
			agentRosterId,
			role,
		}),
	unassignAgent: (projectId: string, agentRosterId: string) =>
		del<{ ok: true }>(`/projects/${projectId}/agents/${agentRosterId}`),
	reassignAgent: (
		projectId: string,
		agentRosterId: string,
		fromProjectId?: string | null,
	) =>
		post<{ ok: true }>(`/projects/${projectId}/agents/reassign`, {
			agentRosterId,
			fromProjectId: fromProjectId ?? null,
		}),
	autoAssignLeadership: (projectId: string) =>
		post<{ ok: true; assigned: number }>(
			`/projects/${projectId}/agents/auto-assign-leadership`,
		),
	refreshAgentContext: (agentRosterId: string) =>
		post<ContextRefreshResult>(
			`/agents/roster/${agentRosterId}/refresh-context`,
		),
	refreshProjectContext: (projectId: string) =>
		post<ContextRefreshResult>(`/projects/${projectId}/refresh-context`),
	startBreak: (projectId: string) =>
		post<ProjectBreakResponse>(`/projects/${projectId}/break`),

	projectDb: {
		list: (projectId: string) =>
			request<DatabaseConnection[]>(`/projects/${projectId}/database`),
		connect: (
			projectId: string,
			data: {
				connectionString?: string;
				name?: string;
				type?: string;
				host?: string;
				port?: number;
				database?: string;
				username?: string;
				password?: string;
			},
		) =>
			post<DatabaseConnection>(`/projects/${projectId}/database/connect`, data),
		remove: (projectId: string, connId: string) =>
			request<{ ok: boolean }>(`/projects/${projectId}/database/${connId}`, {
				method: "DELETE",
			}),
		query: (projectId: string, query: string) =>
			post<{ columns: string[]; rows: Record<string, unknown>[] }>(
				`/projects/${projectId}/database/query`,
				{ query },
			),
	},

	projectRun: {
		status: (projectId: string) =>
			request<RunStatus>(`/projects/${projectId}/run`),
		start: (projectId: string) =>
			post<{ ok: boolean; command: string; startedAt: string }>(
				`/projects/${projectId}/run`,
			),
		stop: (projectId: string) =>
			request<{ ok: boolean }>(`/projects/${projectId}/run`, {
				method: "DELETE",
			}),
	},

	projectProduction: {
		get: (projectId: string) =>
			request<ChecklistItem[]>(`/projects/${projectId}/production-checklist`),
		generate: (projectId: string) =>
			post<ChecklistItem[]>(`/projects/${projectId}/production-checklist`),
		updateItem: (
			projectId: string,
			itemId: string,
			status: "pending" | "pass" | "fail",
		) =>
			request<ChecklistItem>(
				`/projects/${projectId}/production-checklist/${itemId}`,
				{ method: "PATCH", body: JSON.stringify({ status }) },
			),
	},

	projectDiscussion: {
		channel: (projectId: string) =>
			request<ProjectChannel | null>(`/projects/${projectId}/channel`),
		messages: (channel: string) =>
			request<CollabMessage[]>(
				`/collaboration/messages?channel=${encodeURIComponent(channel)}&limit=100&hideSystem=true`,
			),
		send: (channel: string, content: string) =>
			post<{ id: string; createdAt: string }>("/collaboration/messages", {
				channel,
				body: content,
				agentSlug: "human",
			}),
	},
	budget: {
		summary: () => request<BudgetSummary>("/budget/summary"),
		settings: () =>
			request<{
				limitUsd: number | null;
				periodDays: number;
				alertPercent: number;
			}>("/budget/settings"),
		updateSettings: (data: {
			limitUsd?: number;
			periodDays?: number;
			alertPercent?: number;
		}) =>
			request<{ ok: boolean }>("/budget/settings", {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		enforce: () =>
			request<BudgetSummary>("/budget/enforce", { method: "POST" }),
		resume: () =>
			request<{ ok: boolean }>("/budget/resume", { method: "POST" }),
	},
	runtime: {
		availableModels: () =>
			request<
				Array<{
					id: string;
					label?: string;
					provider: string;
					available: boolean;
				}>
			>("/runtime/available-models"),
		cliStatus: () =>
			request<{
				codex: {
					installed: boolean;
					loggedIn: boolean;
					version: string | null;
				};
				claude: {
					installed: boolean;
					loggedIn: boolean;
					version: string | null;
				};
				copilot: {
					installed: boolean;
					loggedIn: boolean;
					version: string | null;
				};
			}>("/runtime/cli-status"),
		installCli: (tool: "codex" | "claude" | "copilot") =>
			request<{ ok: boolean; error?: string }>("/runtime/install-cli", {
				method: "POST",
				body: JSON.stringify({ tool }),
			}),
		loginCli: (tool: "codex" | "claude" | "copilot") =>
			request<{ ok: boolean; output?: string; error?: string }>(
				"/runtime/cli-login",
				{
					method: "POST",
					body: JSON.stringify({ tool }),
				},
			),
		installOllama: () =>
			request<{ ok: boolean; error?: string }>("/runtime/install-ollama", {
				method: "POST",
			}),
		pickFolder: () =>
			request<{ ok: boolean; path?: string; error?: string }>(
				"/runtime/pick-folder",
			),
		modelsCatalog: () =>
			request<{
				models: Array<{
					id: string;
					label: string;
					provider: string;
					tier: string;
				}>;
				defaultModel: string;
			}>("/settings/models"),
		modelsForProvider: (provider: string) =>
			request<
				Array<{
					id: string;
					name?: string;
					displayName?: string;
					provider?: string;
				}>
			>(`/llm/providers/${encodeURIComponent(provider)}/models`),
	},
	health: {
		snapshot: () =>
			request<{
				system: {
					cpuCount: number;
					loadAvg1m: number;
					cpuPercent: number;
					ramTotalMb: number;
					ramUsedMb: number;
					ramFreeMb: number;
					ramPercent: number;
				};
				process: {
					pid: number;
					rssMb: number;
					heapUsedMb: number;
					heapTotalMb: number;
					externalMb: number;
					arrayBuffersMb: number;
					uptimeSeconds: number;
				};
				os: {
					platform: string;
					arch: string;
					hostname: string;
					uptimeSeconds: number;
					nodeVersion: string;
				};
				timestamp: number;
			}>("/health"),
		triggerGc: () =>
			request<{
				gcAvailable: boolean;
				freedMb: number;
				before: { rssMb: number; heapUsedMb: number };
				after: { rssMb: number; heapUsedMb: number };
			}>("/health/gc", { method: "POST" }),
		processes: () =>
			request<{
				header: string;
				processes: Array<{
					pid: number;
					cpu: number;
					mem: number;
					rssMb: number;
					name: string;
				}>;
			}>("/health/processes"),
	},
	llm: {
		status: () =>
			request<{
				modelId: string | null;
				modelName: string | null;
				provider: string | null;
				configured: boolean;
				live: boolean;
			}>("/llm/status"),
		testProvider: (provider: string, apiKey?: string) =>
			request<{ ok: boolean; provider: string; error?: string }>(
				`/llm/providers/${encodeURIComponent(provider)}/test`,
				{ method: "POST", body: JSON.stringify(apiKey ? { apiKey } : {}) },
			),
		catalog: () =>
			request<
				Array<{
					id: string;
					displayName: string;
					provider: string;
					requiresKey?: string;
					reasoningTier?: string;
					costTier?: string;
					contextWindow?: number;
					description?: string;
				}>
			>("/llm/catalog"),
		providerTest: (provider: string, body: { apiKey?: string }) =>
			request<{
				ok: boolean;
				provider: string;
				model?: string;
				error?: string;
			}>(`/llm/providers/${encodeURIComponent(provider)}/test`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
	},
	skills: {
		list: (params?: {
			page?: number;
			pageSize?: number;
			search?: string;
			category?: string;
		}) => {
			const query = new URLSearchParams();
			if (params?.page !== undefined) query.set("page", String(params.page));
			if (params?.pageSize !== undefined)
				query.set("pageSize", String(params.pageSize));
			if (params?.search) query.set("search", params.search);
			if (params?.category) query.set("category", params.category);
			const suffix = query.toString();
			return request<{
				items: Skill[];
				total: number;
				page: number;
				pageSize: number;
				totalPages: number;
			}>(`/skills${suffix ? `?${suffix}` : ""}`);
		},
		library: () => request<Skill[]>("/skills/library"),
		recommended: (params?: { role?: string; limit?: number }) => {
			const query = new URLSearchParams();
			if (params?.role) query.set("role", params.role);
			if (params?.limit !== undefined) query.set("limit", String(params.limit));
			const suffix = query.toString();
			return request<Skill[]>(
				`/skills/recommended${suffix ? `?${suffix}` : ""}`,
			);
		},
		create: (
			body: Omit<Skill, "id" | "usageCount" | "lastUsedAt" | "createdAt">,
		) =>
			request<Skill>("/skills", { method: "POST", body: JSON.stringify(body) }),
		update: (
			id: string,
			body: Partial<
				Pick<
					Skill,
					| "name"
					| "slug"
					| "description"
					| "category"
					| "trigger"
					| "prompt"
					| "isActive"
				>
			>,
		) =>
			request<Skill>(`/skills/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		toggle: (id: string, isActive: boolean) =>
			request<Skill>(`/skills/${id}`, {
				method: "PATCH",
				body: JSON.stringify({ isActive }),
			}),
		delete: (id: string) =>
			request<void>(`/skills/${id}`, { method: "DELETE" }),
	},
	artifacts: {
		list: (filters?: { issueId?: string; agentSlug?: string }) => {
			const q = new URLSearchParams(
				filters as Record<string, string>,
			).toString();
			return request<Artifact[]>(`/artifacts${q ? `?${q}` : ""}`);
		},
		downloadUrl: (id: string) => `${BASE}/artifacts/${id}/download`,
		delete: (id: string) =>
			request<void>(`/artifacts/${id}`, { method: "DELETE" }),
	},
	wiki: {
		list: (category?: string) =>
			request<WikiEntry[]>(`/wiki${category ? `?category=${category}` : ""}`),
		get: (id: string) => request<WikiEntry>(`/wiki/${id}`),
		create: (body: Partial<WikiEntry>) =>
			request<WikiEntry>("/wiki", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (id: string, body: Partial<WikiEntry>) =>
			request<WikiEntry>(`/wiki/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		delete: (id: string) => request<void>(`/wiki/${id}`, { method: "DELETE" }),
	},
	review: {
		list: (status?: string) =>
			request<ReviewItem[]>(
				`/review${status && status !== "all" ? `?status=${status}` : ""}`,
			),
		resolve: (
			id: string,
			decision: "approved" | "rejected",
			comment?: string,
		) =>
			request<ReviewItem>(`/review/${id}`, {
				method: "PATCH",
				body: JSON.stringify({ status: decision, comment }),
			}),
	},
	org: {
		members: () => request<OrgMember[]>("/org/members"),
		stats: () => request<OrgStats>("/org/stats"),
		invite: (email: string, role: OrgMember["role"]) =>
			request<{ ok: boolean }>("/org/invite", {
				method: "POST",
				body: JSON.stringify({ email, role }),
			}),
	},
	clone: {
		profile: () => request<CloneProfile>("/clone"),
		setMode: (mode: "training" | "locked") =>
			request<CloneProfile>("/clone/mode", {
				method: "PATCH",
				body: JSON.stringify({ mode }),
			}),
		questions: () => request<CloneQaItem[]>("/clone/questions"),
		answer: (id: string, answer: string) =>
			request<CloneQaItem>(`/clone/questions/${id}`, {
				method: "PATCH",
				body: JSON.stringify({ answer }),
			}),
		observe: (content: string, source?: string) =>
			request<{ ok: boolean }>("/clone/observe", {
				method: "POST",
				body: JSON.stringify({ content, source }),
			}),
		regenerateBrief: () =>
			request<{ updated: boolean; brief: string | null }>(
				"/clone/regenerate-brief",
				{ method: "POST" },
			),
	},
	parseGoal: (goal: string) =>
		request<{
			issues: Array<{
				title: string;
				description: string;
				priority: IssuePriority;
				suggestedAgent: string;
				estimatedComplexity: number;
			}>;
			modelUsed: string;
		}>("/parse-goal", { method: "POST", body: JSON.stringify({ goal }) }),
	agentDetail: {
		get: (id: string) => request<AgentDetail>(`/agents/${id}`),
		update: (id: string, data: Partial<AgentDetail>) =>
			request<AgentDetail>(`/agents/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		getRuns: (id: string) => request<AgentRun[]>(`/agents/${id}/runs`),
		getExperience: (id: string) =>
			request<AgentExperience>(`/agents/roster/${id}/experience`),
		getRunLog: (id: string, runId: string) =>
			request<AgentRunLogChunk[]>(`/agents/${id}/runs/${runId}/log`),
		getBudget: (id: string) =>
			request<AgentBudgetPolicy | null>(`/agents/${id}/budget`),
		setBudget: (
			id: string,
			policy: Omit<AgentBudgetPolicy, "agentId" | "spentUsd">,
		) =>
			request<AgentBudgetPolicy>(`/agents/${id}/budget`, {
				method: "PUT",
				body: JSON.stringify(policy),
			}),
		loginWithClaude: (id: string) =>
			request<{ loginUrl: string; stdout?: string; stderr?: string }>(
				`/agents/${id}/claude-login`,
				{ method: "POST" },
			),
		createRun: (
			id: string,
			body: {
				task?: string;
				agentArgs?: string[];
				issueId?: string;
				model?: string;
			},
		) =>
			request<AgentRun>(`/agents/${id}/runs`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
		heartbeat: (runId: string) =>
			request<{ ok: boolean; updatedAt: string }>(
				`/agents/runs/${runId}/heartbeat`,
				{ method: "PATCH" },
			),
		updateRunStatus: (
			runId: string,
			body: {
				status: "pending" | "running" | "completed" | "failed" | "cancelled";
				exitCode?: number;
				errorMessage?: string;
				costUsd?: number;
				promptTokens?: number;
				completionTokens?: number;
				cacheReadTokens?: number;
			},
		) =>
			request<{ ok: boolean }>(`/agents/runs/${runId}/status`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
	},
	companies: {
		create: (data: {
			name: string;
			goal?: string;
			type?: string;
			size?: string;
			isOfflineOnly?: boolean;
		}) =>
			request<{ id: string; name: string; issuePrefix: string }>("/companies", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		list: () =>
			request<
				Array<{
					id: string;
					name: string;
					issuePrefix: string;
					brandColor?: string;
					logoUrl?: string | null;
				}>
			>("/companies"),
		update: (
			id: string,
			data: Partial<{
				name: string;
				goal: string;
				type: string;
				size: string;
				brandColor: string;
				logoUrl: string;
			}>,
		) =>
			request<{ id: string; name: string }>(`/companies/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		delete: (id: string) =>
			request<{ ok: true }>(`/companies/${id}`, { method: "DELETE" }),
	},
	cliStatus: {
		list: (opts?: { force?: boolean; only?: readonly string[] }) => {
			const qs = new URLSearchParams();
			if (opts?.force) qs.set("force", "1");
			if (opts?.only?.length) qs.set("only", opts.only.join(","));
			const suffix = qs.toString() ? `?${qs.toString()}` : "";
			return request<{ adapters: CliStatus[] }>(`/cli-status${suffix}`);
		},
	},
	issueDetail: {
		get: (id: string) =>
			request<Issue & { comments: IssueComment[]; activity: ActivityEntry[] }>(
				`/issues/${id}`,
			),
		getActivity: (id: string) =>
			request<ActivityEntry[]>(`/issues/${id}/activity`),
		getComments: (id: string) =>
			request<IssueComment[]>(`/issues/${id}/comments`),
		createComment: (id: string, data: { body: string }) =>
			request<IssueComment>(`/issues/${id}/comments`, {
				method: "POST",
				body: JSON.stringify(data),
			}),
		deleteComment: (id: string, commentId: string) =>
			request<void>(`/issues/${id}/comments/${commentId}`, {
				method: "DELETE",
			}),
		update: (id: string, data: Partial<Issue>) =>
			request<Issue>(`/issues/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
	},
	approvals: {
		list: (filter?: "pending" | "all") =>
			request<Approval[]>(`/approvals${filter ? `?status=${filter}` : ""}`),
		approve: (id: string) =>
			request<Approval>(`/approvals/${id}/approve`, { method: "POST" }),
		reject: (id: string, reason?: string) =>
			request<Approval>(`/approvals/${id}/reject`, {
				method: "POST",
				body: JSON.stringify({ reason }),
			}),
		get: (id: string) => request<Approval>(`/approvals/${id}`),
	},
	plans: {
		list: (filters?: { status?: string; issueId?: string }) => {
			const params = new URLSearchParams();
			if (filters?.status) params.set("status", filters.status);
			if (filters?.issueId) params.set("issueId", filters.issueId);
			const query = params.toString();
			return request<Plan[]>(`/plans${query ? `?${query}` : ""}`);
		},
		get: (id: string) => request<Plan>(`/plans/${id}`),
		approve: (id: string) =>
			request<Plan>(`/plans/${id}/approve`, { method: "POST" }),
		reject: (id: string, feedback?: string) =>
			request<Plan>(`/plans/${id}/reject`, {
				method: "POST",
				body: JSON.stringify({ feedback }),
			}),
	},
	goals: {
		list: (companyId?: string) =>
			request<Goal[]>(
				`/goals${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`,
			),
		create: (data: {
			title: string;
			description?: string;
			parentGoalId?: string;
			companyId?: string;
		}) =>
			request<Goal>("/goals", { method: "POST", body: JSON.stringify(data) }),
		update: (id: string, data: Partial<Goal>) =>
			request<Goal>(`/goals/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		delete: (id: string) => request<void>(`/goals/${id}`, { method: "DELETE" }),
	},
	routines: {
		list: () => request<Routine[]>("/routines"),
		create: (data: {
			name: string;
			description?: string | undefined;
			schedule?: string;
			agentId?: string;
			prompt?: string | undefined;
			isActive?: boolean;
		}) =>
			request<Routine>("/routines", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		update: (id: string, data: Partial<Routine>) =>
			request<Routine>(`/routines/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		toggle: (id: string) =>
			request<Routine>(`/routines/${id}/toggle`, { method: "POST" }),
		delete: (id: string) =>
			request<void>(`/routines/${id}`, { method: "DELETE" }),
		run: (id: string) =>
			request<RoutineRun>(`/routines/${id}/run`, { method: "POST" }),
		getRuns: (id: string) => request<RoutineRun[]>(`/routines/${id}/runs`),
	},
	inbox: {
		list: (tab: "mine" | "unread" | "all") =>
			request<{
				issues: Issue[];
				approvals: Approval[];
				alerts: Array<{
					id: string;
					type: string;
					message: string;
					severity: "info" | "warn" | "error";
					createdAt: string;
				}>;
			}>(`/inbox?tab=${tab}`),
		archive: (issueId: string) =>
			request<void>(`/inbox/archive/${issueId}`, { method: "POST" }),
	},
	activity: {
		list: listActivity,
	},
	search: {
		query: (query: string, maxResults = 8) =>
			request<SearchResponse>("/search", {
				method: "POST",
				body: JSON.stringify({ query, maxResults }),
			}),
		provider: () =>
			request<{ provider: string; hasKey: boolean }>("/search/provider"),
	},
	collaboration: {
		channels: () => request<string[]>("/collaboration/channels"),
		messages: (channel: string, limit = 80) =>
			request<
				Array<{
					id: string;
					agentSlug: string;
					channel: string;
					body: string;
					threadId: string | null;
					createdAt: string;
					messageKind?: string | null;
					pinned?: number | boolean | null;
				}>
			>(
				`/collaboration/messages?channel=${encodeURIComponent(channel)}&limit=${limit}&hideSystem=true`,
			),
		post: (data: { channel: string; body: string; agentSlug?: string }) =>
			request<{ id: string }>("/collaboration/messages", {
				method: "POST",
				body: JSON.stringify(data),
			}),
	},
	integrations: {
		list: () =>
			request<
				Array<{
					id: string;
					type: string;
					name: string;
					status: "active" | "inactive" | "error" | "disconnected";
					config: Record<string, string>;
					config_json?: string;
					last_triggered_at: string | null;
					created_at: string;
					updated_at?: string | null;
				}>
			>("/integrations"),
		create: (body: {
			type: string;
			name: string;
			config: Record<string, string>;
		}) =>
			request<{
				id: string;
				type: string;
				name: string;
				status: "active" | "inactive" | "error" | "disconnected";
				config: Record<string, string>;
				config_json?: string;
				last_triggered_at: string | null;
				created_at: string;
				updated_at?: string | null;
			}>("/integrations", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		github: {
			verify: (token: string) =>
				request<{
					valid: boolean;
					user: { login: string; avatar_url: string; name: string | null };
					repos: Array<{
						full_name: string;
						private: boolean;
						default_branch: string;
					}>;
				}>("/integrations/github/verify", {
					method: "POST",
					body: JSON.stringify({ token }),
				}),
			repos: () =>
				request<
					Array<{
						full_name: string;
						private: boolean;
						default_branch: string;
					}>
				>("/integrations/github/repos"),
		},
		slack: {
			test: (webhookUrl: string) =>
				request<{ ok: boolean }>("/integrations/slack/test", {
					method: "POST",
					body: JSON.stringify({ webhookUrl }),
				}),
		},
		calendar: {
			events: () =>
				request<{
					events: Array<{
						title: string;
						start: string | null;
						end: string | null;
						link: string | null;
					}>;
				}>("/integrations/calendar/events"),
		},
		update: (
			id: string,
			body: { status?: string; config?: Record<string, string> },
		) =>
			request<{
				id: string;
				type: string;
				name: string;
				status: "active" | "inactive" | "error" | "disconnected";
				config: Record<string, string>;
				config_json?: string;
				last_triggered_at: string | null;
				created_at: string;
				updated_at?: string | null;
			}>(`/integrations/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		delete: (id: string) =>
			request<{ ok: boolean }>(`/integrations/${id}`, { method: "DELETE" }),
	},
	webhooks: {
		events: () =>
			request<
				Array<{
					id: string;
					integration_id: string;
					company_id: string;
					direction: "inbound" | "outbound";
					event_name: string | null;
					target_url: string | null;
					payload: string | null;
					status: string;
					issue_id: string | null;
					response_status: number | null;
					error_message: string | null;
					created_at: string;
				}>
			>("/webhooks/events"),
	},
	secrets: {
		list: () =>
			request<
				Array<{
					id: string;
					name: string;
					description: string | null;
					value_hint: string | null;
					created_at: string;
					updated_at: string;
				}>
			>("/integrations/secrets"),
		create: (body: { name: string; description: string; value: string }) =>
			request<{ id: string }>("/integrations/secrets", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (id: string, body: { value: string }) =>
			request<{ updated: true }>(`/integrations/secrets/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		value: (id: string) =>
			request<{ value: string }>(`/integrations/secrets/${id}/value`),
		delete: (id: string) =>
			request<{ ok: boolean }>(`/integrations/secrets/${id}`, {
				method: "DELETE",
			}),
	},
	environments: {
		list: (projectId?: string) =>
			request<Environment[]>(
				`/environments${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
			),
		create: (data: EnvironmentInput) =>
			request<Environment>("/environments", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		update: (id: string, data: Partial<EnvironmentInput>) =>
			request<Environment>(`/environments/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		delete: (id: string) =>
			request<{ ok: boolean }>(`/environments/${id}`, { method: "DELETE" }),
	},
	costs: {
		summary: () => request<CostSummary>("/costs/summary"),
		providers: () =>
			request<
				{
					name: string;
					isConfigured: boolean;
					keyHint: string | null;
					models: string[];
					spendMtdUsd: number;
					status: "ok" | "error" | "unconfigured";
				}[]
			>("/costs/providers"),
	},
	lan: {
		status: () =>
			request<{
				instanceId: string;
				discoverable: boolean;
				broadcasting: boolean;
				addresses: string[];
				port: number;
				companyName: string;
				companyId: string;
				publicUrl: string | null;
				instanceUrl: string;
			}>("/lan/status"),
		setDiscoverable: (enabled: boolean) =>
			request<{ discoverable: boolean; broadcasting: boolean }>(
				"/lan/discoverable",
				{
					method: "POST",
					body: JSON.stringify({ enabled }),
				},
			),
		setPublicUrl: (publicUrl: string | null) =>
			request<{ publicUrl: string | null }>("/lan/public-url", {
				method: "POST",
				body: JSON.stringify({ publicUrl }),
			}),
		peers: () =>
			request<{
				peers: Array<{
					instanceId: string;
					companyId: string;
					companyName: string;
					ownerEmail: string;
					host: string;
					address: string;
					port: number;
					proto: "http" | "https";
					url: string;
					lastSeen: number;
				}>;
			}>("/lan/peers"),
		joinRequests: () =>
			request<{
				requests: Array<{
					id: string;
					email: string;
					name: string | null;
					message: string | null;
					status: string;
					sentAt: string;
				}>;
			}>("/lan/join-requests"),
		approve: (id: string) =>
			request<{ requestId: string; status: string }>(
				`/lan/join-request/${id}/approve`,
				{ method: "POST" },
			),
		reject: (id: string) =>
			request<{ requestId: string; status: string }>(
				`/lan/join-request/${id}/reject`,
				{ method: "POST" },
			),
		requestJoin: async (
			peerUrl: string,
			body: {
				companyId: string;
				email: string;
				name?: string;
				message?: string;
			},
		) => {
			const res = await globalThis.fetch(
				`${peerUrl.replace(/\/$/, "")}/api/lan/join-request`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
			);
			if (!res.ok) {
				const text = await res.text().catch(() => res.statusText);
				throw new Error(text || `Request failed (${res.status})`);
			}
			return res.json() as Promise<{ requestId: string; status: string }>;
		},
		pollJoinRequest: async (peerUrl: string, requestId: string) => {
			const res = await globalThis.fetch(
				`${peerUrl.replace(/\/$/, "")}/api/lan/join-request/${requestId}`,
			);
			if (!res.ok) throw new Error(`Poll failed (${res.status})`);
			return res.json() as Promise<{ requestId: string; status: string }>;
		},
		probeRemote: async (peerUrl: string) => {
			const res = await globalThis.fetch(
				`${peerUrl.replace(/\/$/, "")}/api/health`,
			);
			if (!res.ok) throw new Error(`Probe failed (${res.status})`);
			return res.json() as Promise<{ ok: boolean }>;
		},
	},
};

export interface AgentRun {
	id: string;
	agentId: string;
	issueId: string | null;
	issueTitle: string | null;
	status: "pending" | "running" | "done" | "failed" | "cancelled" | "completed";
	startedAt: string;
	completedAt: string | null;
	durationMs: number | null;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
	modelId: string;
}

export interface AgentRunLogChunk {
	type:
		| "assistant"
		| "tool_use"
		| "tool_result"
		| "system"
		| "input"
		| "stdout"
		| "stderr"
		| "output";
	timestamp: string;
	content: string;
	toolName?: string;
	sequence?: number;
}

export interface AgentBudgetPolicy {
	scope: "agent";
	period: "daily" | "weekly" | "monthly";
	limitUsd: number;
	spentUsd: number;
	agentId: string;
}

export interface AgentDetail extends Agent {
	systemPrompt: string | null;
	adapterType: string;
	modelId: string;
	command: string | null;
	commandArgs: string | null;
	httpUrl: string | null;
	envVars: Record<string, string>;
	allowedPermissions: string[];
	skills: Array<{ id: string; name: string; slug: string }>;
	totalRuns: number;
	avgDurationMs: number | null;
	mode: "write" | "read_only" | "plan" | "conversation";
	autonomyLevel?: "none" | "basic" | "plus" | "semi" | "full";
	runMode?: AgentRunMode;
	continuousIntervalMs?: number;
	idlePrompt?: string | null;
	lastRunEndedAt?: string | null;
}

export interface AgentExperienceSkill {
	name: string;
	total: number;
	success: number;
	failed: number;
	successRate: number;
}

export interface AgentExperienceReflection {
	id: string;
	runId: string;
	outcome: "success" | "partial" | "failed";
	reflection: string;
	lessonsLearned: string;
	skillTags: string[];
	createdAt: string;
}

export interface AgentExperience {
	totalReflections: number;
	successCount: number;
	failedCount: number;
	partialCount: number;
	skills: AgentExperienceSkill[];
	trend: number[];
	recent: AgentExperienceReflection[];
	level: string;
	credibility: number;
	successes: number;
	failures: number;
}

export interface AgentsExperienceSummary {
	totalAgents: number;
	totalRuns: number;
	totalSuccess: number;
	totalFailed: number;
	overallSuccessRate: number;
	totalCost: number;
	topSkills: Array<[string, number]>;
	avgCredibility: number;
}

export interface Approval {
	id: string;
	type:
		| "task_start"
		| "pr_merge"
		| "agent_hire"
		| "budget_override"
		| "approval"
		| "code_review"
		| "security_sign_off"
		| string
		| null;
	entityType: string | null;
	entityId: string | null;
	title: string | null;
	description: string | null;
	requestedBy: string | null;
	targetIssueSlug: string | null;
	estimatedCostUsd: number | null;
	diff: string | null;
	riskLevel: "low" | "medium" | "high" | string;
	status: "pending" | "approved" | "rejected";
	comment: string | null;
	createdAt: string;
	resolvedAt: string | null;
	entityTitle: string | null;
	entitySlug: string | null;
	entityUrl: string | null;
}

export interface PlanSubtask {
	id: string;
	title: string;
	description: string;
	assignTo: "cto" | "dev" | "auto";
	priority: number;
	dependsOn: string[];
	status: "pending" | "in_progress" | "done";
	issueId?: string;
}

export interface Plan {
	id: string;
	issueId: string;
	companyId: string;
	title: string;
	approach: string;
	subtasks: PlanSubtask[];
	status: "draft" | "pending_approval" | "approved" | "rejected" | "executing";
	createdBy: string;
	feedback: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface Goal {
	id: string;
	title: string;
	description: string | null;
	status: "no_status" | "on_track" | "at_risk" | "off_track" | "done";
	parentGoalId: string | null;
	children?: Goal[];
	createdAt: string;
	updatedAt: string;
}

export interface Routine {
	id: string;
	name: string;
	description: string | null;
	schedule: string | null;
	agentId: string | null;
	agentName: string | null;
	prompt: string | null;
	isActive: boolean;
	lastTriggeredAt: string | null;
	nextRunAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface RoutineRun {
	id: string;
	routineId: string;
	status: "pending" | "running" | "done" | "failed";
	startedAt?: string;
	completedAt?: string | null;
	createdAt?: string;
}

export interface LlmModel {
	id: string;
	name: string;
	provider: "ollama" | "lmstudio";
	sizeGb: number;
	paramCount: string;
	isInstalled: boolean;
	isRunning?: boolean | undefined;
	lastUsedAt?: string | undefined;
	digest?: string | undefined;
	family?: string | undefined;
}

export const llm = {
	list: () => request<LlmModel[]>("/llm/models"),
	pull: (name: string) =>
		request<{ jobId: string }>("/llm/models/pull", {
			method: "POST",
			body: JSON.stringify({ name }),
		}),
	remove: (name: string) =>
		request<void>(`/llm/models/${encodeURIComponent(name)}`, {
			method: "DELETE",
		}),
	pullProgress: (jobId: string) =>
		request<{ progress: number; status: string }>(
			`/llm/pull-progress/${jobId}`,
		),
	settings: {
		get: () =>
			request<{
				ollamaUrl: string;
				lmstudioUrl: string;
				defaultOfflineModel: string;
				maxConcurrentPulls: number;
			}>("/llm/settings"),
		update: (data: {
			ollamaUrl?: string | undefined;
			lmstudioUrl?: string | undefined;
			defaultOfflineModel?: string | undefined;
			maxConcurrentPulls?: number | undefined;
		}) =>
			request<void>("/llm/settings", {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
	},
};

export interface CostSummary {
	totalMtdUsd: number;
	budgetMonthlyUsd: number;
	projectedMonthEndUsd: number;
	costPerTaskUsd: number;
	dailySeries: { date: string; costUsd: number }[];
	byAgent: {
		agentId: string;
		agentSlug: string;
		tasks: number;
		tokens: number;
		costUsd: number;
	}[];
	byProject: {
		projectId: string;
		projectName: string;
		tasks: number;
		tokens: number;
		costUsd: number;
	}[];
}

export const costs = {
	summary: () => request<CostSummary>("/costs/summary"),
	budgets: {
		list: () =>
			request<
				{
					agentId: string;
					agentSlug: string;
					limitUsd: number;
					usedUsd: number;
				}[]
			>("/costs/budgets"),
		update: (agentId: string, limitUsd: number) =>
			request<void>(`/costs/budgets/${agentId}`, {
				method: "PUT",
				body: JSON.stringify({ limitUsd }),
			}),
	},
	providers: () =>
		request<
			{
				name: string;
				isConfigured: boolean;
				keyHint: string | null;
				models: string[];
				spendMtdUsd: number;
				status: "ok" | "error" | "unconfigured";
			}[]
		>("/costs/providers"),
};

export interface CompanyMember {
	id: string;
	name: string;
	email: string;
	role: "owner" | "admin" | "member";
	joinedAt: string;
	avatarUrl?: string | null | undefined;
}

export const companySettings = {
	get: () =>
		request<{
			name: string;
			type: string;
			size: string;
			goal: string | null;
			brandColor: string | null;
			isOfflineOnly: boolean;
			issuePrefix: string;
			timezone: string;
			envVars?: Record<string, string>;
		}>("/company/settings"),
	update: (data: Record<string, unknown>) =>
		request<void>("/company/settings", {
			method: "PATCH",
			body: JSON.stringify(data),
		}),
	/** Save a per-company API provider key. `provider` must be one of: anthropic | openai | openrouter | groq | gemini | together. */
	setKey: (provider: string, key: string) => {
		const fieldMap: Record<string, string> = {
			anthropic: "anthropicApiKey",
			openai: "openaiApiKey",
			openrouter: "openrouterApiKey",
			groq: "groqApiKey",
			gemini: "geminiApiKey",
			together: "togetherApiKey",
		};
		const field = fieldMap[provider] ?? `${provider}ApiKey`;
		return request<{ ok: boolean }>("/settings", {
			method: "POST",
			body: JSON.stringify({ [field]: key }),
		});
	},
	members: {
		list: () => request<CompanyMember[]>("/company/members"),
		updateRole: (memberId: string, role: string) =>
			request<void>(`/company/members/${memberId}/role`, {
				method: "PUT",
				body: JSON.stringify({ role }),
			}),
		remove: (memberId: string) =>
			request<void>(`/company/members/${memberId}`, { method: "DELETE" }),
	},
	invites: {
		list: () =>
			request<
				{
					id: string;
					email: string;
					role: string;
					sentAt: string;
					expiresAt: string;
					joinUrl?: string;
				}[]
			>("/company/invites"),
		create: (email: string, role: string) =>
			request<{
				id: string;
				email: string;
				role: string;
				sentAt: string;
				expiresAt: string;
				joinUrl?: string;
			}>("/company/invites", {
				method: "POST",
				body: JSON.stringify({ email, role }),
			}),
		revoke: (id: string) =>
			request<void>(`/company/invites/${id}`, { method: "DELETE" }),
		resend: (id: string) =>
			request<void>(`/company/invites/${id}/resend`, { method: "POST" }),
	},
};

export interface AdapterConfig {
	id: string;
	name: string;
	enabled: boolean;
	kind: "cli" | "api" | "local";
	isConfigured: boolean;
	status: "ok" | "disabled" | "unconfigured";
	models: string[];
	defaultModel?: string | null | undefined;
	apiKeyHint?: string | null | undefined;
	baseUrl?: string | null | undefined;
	signupUrl?: string | null | undefined;
	apiKeyEnvVar?: string | null | undefined;
}

export const instanceSettings = {
	adapters: {
		list: () => request<AdapterConfig[]>("/instance/adapters"),
		update: (id: string, data: Record<string, unknown>) =>
			request<void>(`/instance/adapters/${id}`, {
				method: "PATCH",
				body: JSON.stringify(data),
			}),
		test: (id: string) =>
			request<{ ok: boolean; latencyMs: number; error?: string | undefined }>(
				`/instance/adapters/${id}/test`,
				{ method: "POST" },
			),
	},
	plugins: {
		list: () =>
			request<
				{
					id: string;
					name: string;
					version: string;
					description: string;
					isEnabled: boolean;
					config: Record<string, string>;
				}[]
			>("/instance/plugins"),
		toggle: (id: string, enabled: boolean) =>
			request<void>(`/instance/plugins/${id}/toggle`, {
				method: "POST",
				body: JSON.stringify({ enabled }),
			}),
		configure: (id: string, config: Record<string, string>) =>
			request<void>(`/instance/plugins/${id}/config`, {
				method: "PUT",
				body: JSON.stringify(config),
			}),
		install: (id: string) =>
			request<void>(`/instance/plugins/${id}/install`, { method: "POST" }),
		uninstall: (id: string) =>
			request<void>(`/instance/plugins/${id}/uninstall`, { method: "DELETE" }),
	},
	flags: {
		list: () =>
			request<
				{ id: string; name: string; description: string; enabled: boolean }[]
			>("/instance/flags"),
		toggle: (id: string, enabled: boolean) =>
			request<void>(`/instance/flags/${id}`, {
				method: "POST",
				body: JSON.stringify({ enabled }),
			}),
	},
};

export interface Workspace {
	id: string;
	name: string;
	type: "local" | "docker" | "remote-ssh" | "cloud";
	status: "running" | "stopped" | "unknown";
	isDefault: boolean;
	agentCount: number;
	lastUsedAt?: string | null | undefined;
	config: Record<string, string>;
}

export const workspaces = {
	list: () => request<Workspace[]>("/workspaces"),
	create: (
		data: Omit<Workspace, "id" | "status" | "agentCount" | "lastUsedAt">,
	) =>
		request<Workspace>("/workspaces", {
			method: "POST",
			body: JSON.stringify(data),
		}),
	update: (id: string, data: Partial<Workspace>) =>
		request<Workspace>(`/workspaces/${id}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		}),
	delete: (id: string) =>
		request<void>(`/workspaces/${id}`, { method: "DELETE" }),
	setDefault: (id: string) =>
		request<void>(`/workspaces/${id}/default`, { method: "POST" }),
};
