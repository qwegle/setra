import type {
	Agent,
	ApprovalRequest,
	BoardProject,
	BudgetSummary,
	CreateIssueInput,
	CreateProjectInput,
	Issue,
	UpdateIssueInput,
} from "./types.js";

export interface SetraClientOptions {
	/** Base URL of the setra server. Defaults to http://localhost:3141 */
	baseUrl?: string;
	/** Bearer token for enterprise/cloud auth. Optional for local OSS server. */
	token?: string;
}

export class SetraClient {
	private readonly base: string;
	private readonly headers: Record<string, string>;

	constructor(opts: SetraClientOptions = {}) {
		this.base = (opts.baseUrl ?? "http://localhost:3141").replace(/\/$/, "");
		this.headers = {
			"Content-Type": "application/json",
			...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
		};
	}

	private async req<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await fetch(`${this.base}/api${path}`, {
			headers: { ...this.headers, ...init?.headers },
			...init,
		});
		if (!res.ok) {
			const body = await res.text().catch(() => res.statusText);
			throw new Error(`SetraClient ${res.status} ${path}: ${body}`);
		}
		if (res.status === 204) return undefined as T;
		return res.json() as Promise<T>;
	}

	// ─── Projects ──────────────────────────────────────────────────────────────
	readonly projects = {
		list: () => this.req<BoardProject[]>("/projects"),
		get: (id: string) => this.req<BoardProject>(`/projects/${id}`),
		create: (body: CreateProjectInput) =>
			this.req<BoardProject>("/projects", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		issues: (projectId: string) =>
			this.req<Issue[]>(`/projects/${projectId}/issues`),
	};

	// ─── Issues ────────────────────────────────────────────────────────────────
	readonly issues = {
		get: (id: string) => this.req<Issue>(`/issues/${id}`),
		create: (body: CreateIssueInput) =>
			this.req<Issue>("/issues", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (id: string, body: UpdateIssueInput) =>
			this.req<Issue>(`/issues/${id}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),
		delete: (id: string) =>
			this.req<void>(`/issues/${id}`, { method: "DELETE" }),
	};

	// ─── Agents ────────────────────────────────────────────────────────────────
	readonly agents = {
		list: () => this.req<Agent[]>("/agents"),
		get: (id: string) => this.req<Agent>(`/agents/${id}`),
	};

	// ─── Budget ────────────────────────────────────────────────────────────────
	readonly budget = {
		summary: () => this.req<BudgetSummary>("/budget/summary"),
	};

	// ─── Approvals ─────────────────────────────────────────────────────────────
	readonly approvals = {
		list: () => this.req<ApprovalRequest[]>("/approvals"),
		resolve: (
			id: string,
			decision: "approved" | "rejected",
			resolution?: string,
		) =>
			this.req<ApprovalRequest>(`/approvals/${id}`, {
				method: "PATCH",
				body: JSON.stringify({ status: decision, resolution }),
			}),
	};

	// ─── Health ────────────────────────────────────────────────────────────────
	health = () => this.req<{ status: string; version: string }>("/health");
}

/** Singleton for browser/TUI usage. */
export function createClient(opts?: SetraClientOptions): SetraClient {
	return new SetraClient(opts);
}
