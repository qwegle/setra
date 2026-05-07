import { execSync } from "node:child_process";
import path from "node:path";
import { getDb, getRawDb, runMigrations } from "@setra/db";

const DEFAULT_SERVER_URL = "http://localhost:7820";
const DEFAULT_AGENTS = ["ceo", "cto", "developer", "designer", "qa", "ops"];

type RawDb = ReturnType<typeof getRawDb>;

export type VaultEntry = {
	key: string;
	value: string;
	updatedAt: string;
};

export type ActivityEntry = {
	timestamp: string;
	agent: string;
	action: string;
	entity: string;
	summary: string;
	projectId: string | null;
};

export type DispatchAssignment = {
	id: string;
	agentSlug: string;
	taskTitle: string;
	status: "queued" | "in_progress" | "done";
	progress: number;
	notes: string | null;
	updatedAt: string;
};

export type DispatchStatus = {
	id: string;
	task: string;
	budget: number | null;
	status: "running" | "completed";
	createdAt: string;
	assignments: DispatchAssignment[];
};

export type DeploymentStatus = {
	id: string;
	projectId: string;
	environment: string;
	status: "running" | "completed" | "failed";
	currentStage: string;
	url: string | null;
	createdAt: string;
	updatedAt: string;
};

export type TeamAgent = {
	slug: string;
	status: "idle" | "running" | "stopped";
	currentTask: string | null;
	updatedAt: string;
};

export function getServerBaseUrl(): string {
	return process.env["SETRA_SERVER_URL"] ?? DEFAULT_SERVER_URL;
}

export async function isServerReachable(
	baseUrl = getServerBaseUrl(),
): Promise<boolean> {
	try {
		const response = await fetch(new URL("/health", baseUrl), {
			signal: AbortSignal.timeout(1_500),
		});
		return response.ok;
	} catch {
		return false;
	}
}

export function maskSecret(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "•".repeat(value.length);
	return `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

export async function ensureLocalDb(): Promise<RawDb> {
	getDb();
	await runMigrations();
	const raw = getRawDb();
	ensureRuntimeTables(raw);
	return raw;
}

export async function resolveProjectId(
	projectId?: string,
): Promise<string | null> {
	if (projectId) return projectId;
	const raw = await ensureLocalDb();
	const repoPath = resolveRepoPath();
	const exact = raw
		.prepare(
			"SELECT id FROM projects WHERE lower(repo_path) = lower(?) ORDER BY updated_at DESC LIMIT 1",
		)
		.get(repoPath) as { id: string } | undefined;
	if (exact) return exact.id;

	const prefix = raw
		.prepare(
			"SELECT id, repo_path FROM projects ORDER BY length(repo_path) DESC, updated_at DESC",
		)
		.all() as Array<{ id: string; repo_path: string }>;
	const matched = prefix.find((row) => repoPath.startsWith(row.repo_path));
	if (matched) return matched.id;

	const id = crypto.randomUUID();
	const now = nowIso();
	const name = path.basename(repoPath);
	const defaultBranch = resolveDefaultBranch();
	const remoteUrl = resolveRemoteUrl();
	raw
		.prepare(
			`INSERT INTO projects (id, name, repo_path, remote_url, default_branch, last_active_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(id, name, repoPath, remoteUrl, defaultBranch, now, now, now);
	return id;
}

export async function listVaultEntriesLocal(
	projectId?: string,
): Promise<VaultEntry[]> {
	const raw = await ensureLocalDb();
	return (
		raw
			.prepare(
				"SELECT key, value, updated_at FROM vault_entries WHERE scope = ? ORDER BY key COLLATE NOCASE ASC",
			)
			.all(scopeForProject(projectId)) as Array<{
			key: string;
			value: string;
			updated_at: string;
		}>
	).map((row) => ({
		key: row.key,
		value: row.value,
		updatedAt: row.updated_at,
	}));
}

export async function getVaultEntryLocal(
	key: string,
	projectId?: string,
): Promise<VaultEntry | null> {
	const raw = await ensureLocalDb();
	const row = raw
		.prepare(
			"SELECT key, value, updated_at FROM vault_entries WHERE scope = ? AND key = ?",
		)
		.get(scopeForProject(projectId), key) as
		| { key: string; value: string; updated_at: string }
		| undefined;
	if (!row) return null;
	return { key: row.key, value: row.value, updatedAt: row.updated_at };
}

export async function setVaultEntryLocal(
	key: string,
	value: string,
	projectId?: string,
): Promise<void> {
	const raw = await ensureLocalDb();
	const now = nowIso();
	raw
		.prepare(
			`INSERT INTO vault_entries (scope, key, value, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		)
		.run(scopeForProject(projectId), key, value, now, now);
	insertAuditEntry(raw, {
		projectId: projectId ?? null,
		agent: "vault",
		action: "secret.set",
		entity: key,
		summary: `Updated ${projectId ? "project" : "company"}-scoped secret ${key}`,
	});
}

export async function deleteVaultEntryLocal(
	key: string,
	projectId?: string,
): Promise<boolean> {
	const raw = await ensureLocalDb();
	const result = raw
		.prepare("DELETE FROM vault_entries WHERE scope = ? AND key = ?")
		.run(scopeForProject(projectId), key);
	if (result.changes > 0) {
		insertAuditEntry(raw, {
			projectId: projectId ?? null,
			agent: "vault",
			action: "secret.delete",
			entity: key,
			summary: `Deleted ${projectId ? "project" : "company"}-scoped secret ${key}`,
		});
	}
	return result.changes > 0;
}

export async function getActivityFeedLocal(opts: {
	limit: number;
	since?: string;
}): Promise<ActivityEntry[]> {
	const raw = await ensureLocalDb();
	const params: unknown[] = [];
	let sql =
		"SELECT timestamp, agent, action, entity, summary, project_id FROM audit_log";
	if (opts.since) {
		sql += " WHERE timestamp >= ?";
		params.push(opts.since);
	}
	sql += " ORDER BY timestamp DESC LIMIT ?";
	params.push(opts.limit);
	const rows = raw.prepare(sql).all(...params) as Array<{
		timestamp: string;
		agent: string | null;
		action: string;
		entity: string;
		summary: string;
		project_id: string | null;
	}>;
	if (rows.length > 0) {
		return rows.map((row) => ({
			timestamp: row.timestamp,
			agent: row.agent ?? "system",
			action: row.action,
			entity: row.entity,
			summary: row.summary,
			projectId: row.project_id,
		}));
	}

	const derived = [] as ActivityEntry[];
	const runRows = raw
		.prepare(
			`SELECT runs.started_at, runs.agent, runs.status, plots.name AS plot_name, plots.project_id
			 FROM runs
			 JOIN plots ON plots.id = runs.plot_id
			 ORDER BY runs.started_at DESC
			 LIMIT ?`,
		)
		.all(opts.limit) as Array<{
		started_at: string;
		agent: string;
		status: string;
		plot_name: string;
		project_id: string;
	}>;
	for (const row of runRows) {
		derived.push({
			timestamp: row.started_at,
			agent: row.agent,
			action: "run.start",
			entity: row.plot_name,
			summary: `${row.agent} ${row.status} ${row.plot_name}`,
			projectId: row.project_id,
		});
	}
	return derived
		.filter((entry) => !opts.since || entry.timestamp >= opts.since)
		.slice(0, opts.limit);
}

export async function startDispatchLocal(opts: {
	task: string;
	agents?: string[];
	budget?: number;
}): Promise<DispatchStatus> {
	const raw = await ensureLocalDb();
	bootstrapAgentRegistry(raw);
	const id = crypto.randomUUID();
	const now = nowIso();
	const agents =
		opts.agents && opts.agents.length > 0
			? opts.agents
			: ["ceo", "cto", "developer"];
	raw
		.prepare(
			`INSERT INTO dispatch_runs (id, task, agents, budget, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'running', ?, ?)`,
		)
		.run(id, opts.task, JSON.stringify(agents), opts.budget ?? null, now, now);

	agents.forEach((agent, index) => {
		const taskTitle =
			index === 0
				? `Break down task: ${opts.task}`
				: `Execute ${opts.task} as ${agent}`;
		raw
			.prepare(
				`INSERT INTO dispatch_assignments (id, dispatch_id, agent_slug, task_title, status, progress, notes, updated_at)
			 VALUES (?, ?, ?, ?, 'queued', 0, ?, ?)`,
			)
			.run(
				crypto.randomUUID(),
				id,
				agent,
				taskTitle,
				index === 0 ? "CEO orchestrator created the plan." : null,
				now,
			);
	});

	insertAuditEntry(raw, {
		agent: "ceo",
		action: "dispatch.start",
		entity: id,
		summary: `Dispatched task to ${agents.join(", ")}: ${opts.task}`,
		projectId: null,
	});
	return getDispatchStatusLocal(id);
}

export async function getDispatchStatusLocal(
	dispatchId: string,
): Promise<DispatchStatus> {
	const raw = await ensureLocalDb();
	refreshDispatchState(raw, dispatchId);
	const run = raw
		.prepare(
			"SELECT id, task, budget, status, created_at FROM dispatch_runs WHERE id = ?",
		)
		.get(dispatchId) as
		| {
				id: string;
				task: string;
				budget: number | null;
				status: "running" | "completed";
				created_at: string;
		  }
		| undefined;
	if (!run) {
		throw new Error(`Dispatch not found: ${dispatchId}`);
	}
	const assignments = raw
		.prepare(
			`SELECT id, agent_slug, task_title, status, progress, notes, updated_at
			 FROM dispatch_assignments
			 WHERE dispatch_id = ?
			 ORDER BY rowid ASC`,
		)
		.all(dispatchId) as Array<{
		id: string;
		agent_slug: string;
		task_title: string;
		status: "queued" | "in_progress" | "done";
		progress: number;
		notes: string | null;
		updated_at: string;
	}>;
	return {
		id: run.id,
		task: run.task,
		budget: run.budget,
		status: run.status,
		createdAt: run.created_at,
		assignments: assignments.map((row) => ({
			id: row.id,
			agentSlug: row.agent_slug,
			taskTitle: row.task_title,
			status: row.status,
			progress: row.progress,
			notes: row.notes,
			updatedAt: row.updated_at,
		})),
	};
}

export async function startDeploymentLocal(opts: {
	projectId: string;
	environment: string;
}): Promise<DeploymentStatus> {
	const raw = await ensureLocalDb();
	const id = crypto.randomUUID();
	const now = nowIso();
	raw
		.prepare(
			`INSERT INTO deployment_runs (id, project_id, environment, status, current_stage, url, created_at, updated_at)
		 VALUES (?, ?, ?, 'running', 'prepare', NULL, ?, ?)`,
		)
		.run(id, opts.projectId, opts.environment, now, now);
	insertAuditEntry(raw, {
		projectId: opts.projectId,
		agent: "deploy",
		action: "deploy.start",
		entity: opts.environment,
		summary: `Started ${opts.environment} deployment for ${opts.projectId}`,
	});
	return getDeploymentStatusLocal(id);
}

export async function getDeploymentStatusLocal(
	deploymentId: string,
): Promise<DeploymentStatus> {
	const raw = await ensureLocalDb();
	refreshDeploymentState(raw, deploymentId);
	const row = raw
		.prepare(
			`SELECT id, project_id, environment, status, current_stage, url, created_at, updated_at
			 FROM deployment_runs WHERE id = ?`,
		)
		.get(deploymentId) as
		| {
				id: string;
				project_id: string;
				environment: string;
				status: "running" | "completed" | "failed";
				current_stage: string;
				url: string | null;
				created_at: string;
				updated_at: string;
		  }
		| undefined;
	if (!row) {
		throw new Error(`Deployment not found: ${deploymentId}`);
	}
	return {
		id: row.id,
		projectId: row.project_id,
		environment: row.environment,
		status: row.status,
		currentStage: row.current_stage,
		url: row.url,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function listTeamAgentsLocal(): Promise<TeamAgent[]> {
	const raw = await ensureLocalDb();
	bootstrapAgentRegistry(raw);
	return (
		raw
			.prepare(
				"SELECT slug, status, current_task, updated_at FROM agent_registry ORDER BY slug COLLATE NOCASE ASC",
			)
			.all() as Array<{
			slug: string;
			status: "idle" | "running" | "stopped";
			current_task: string | null;
			updated_at: string;
		}>
	).map((row) => ({
		slug: row.slug,
		status: row.status,
		currentTask: row.current_task,
		updatedAt: row.updated_at,
	}));
}

export async function startTeamAgentLocal(slug: string): Promise<TeamAgent> {
	const raw = await ensureLocalDb();
	bootstrapAgentRegistry(raw);
	const now = nowIso();
	raw
		.prepare(
			`INSERT INTO agent_registry (slug, status, current_task, updated_at)
		 VALUES (?, 'idle', NULL, ?)
		 ON CONFLICT(slug) DO UPDATE SET status = 'idle', updated_at = excluded.updated_at`,
		)
		.run(slug, now);
	insertAuditEntry(raw, {
		projectId: null,
		agent: slug,
		action: "agent.start",
		entity: slug,
		summary: `Started agent ${slug}`,
	});
	return getTeamAgent(raw, slug);
}

export async function stopTeamAgentLocal(slug: string): Promise<TeamAgent> {
	const raw = await ensureLocalDb();
	bootstrapAgentRegistry(raw);
	raw
		.prepare(
			"UPDATE agent_registry SET status = 'stopped', current_task = NULL, updated_at = ? WHERE slug = ?",
		)
		.run(nowIso(), slug);
	insertAuditEntry(raw, {
		projectId: null,
		agent: slug,
		action: "agent.stop",
		entity: slug,
		summary: `Stopped agent ${slug}`,
	});
	return getTeamAgent(raw, slug);
}

export function buildChatResponse(opts: {
	projectId: string;
	agentSlug: string;
	message: string;
}): string {
	const lines = [
		`# ${opts.agentSlug}`,
		"",
		`I received your message for project ${opts.projectId}.`,
		"",
		"## Next steps",
		`- Clarify the task: ${opts.message}`,
		"- Review the current project state and existing runs.",
		"- Propose an execution plan before making changes.",
	];
	return lines.join("\n");
}

function ensureRuntimeTables(raw: RawDb): void {
	raw.exec(`
		CREATE TABLE IF NOT EXISTS vault_entries (
			scope TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope, key)
		);

		CREATE TABLE IF NOT EXISTS audit_log (
			id TEXT PRIMARY KEY,
			timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
			project_id TEXT,
			agent TEXT,
			action TEXT NOT NULL,
			entity TEXT NOT NULL,
			summary TEXT NOT NULL,
			metadata TEXT
		);

		CREATE TABLE IF NOT EXISTS dispatch_runs (
			id TEXT PRIMARY KEY,
			task TEXT NOT NULL,
			agents TEXT NOT NULL,
			budget REAL,
			status TEXT NOT NULL DEFAULT 'running',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS dispatch_assignments (
			id TEXT PRIMARY KEY,
			dispatch_id TEXT NOT NULL REFERENCES dispatch_runs(id) ON DELETE CASCADE,
			agent_slug TEXT NOT NULL,
			task_title TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'queued',
			progress INTEGER NOT NULL DEFAULT 0,
			notes TEXT,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS agent_registry (
			slug TEXT PRIMARY KEY,
			status TEXT NOT NULL DEFAULT 'idle',
			current_task TEXT,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS deployment_runs (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			environment TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'running',
			current_stage TEXT NOT NULL,
			url TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS project_chats (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			agent_slug TEXT NOT NULL,
			role TEXT NOT NULL,
			message TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
	`);
}

function scopeForProject(projectId?: string): string {
	return projectId ? `project:${projectId}` : "company";
}

function resolveRepoPath(): string {
	try {
		return execSync("git rev-parse --show-toplevel", {
			cwd: process.cwd(),
			stdio: "pipe",
		})
			.toString()
			.trim();
	} catch {
		return process.cwd();
	}
}

function resolveDefaultBranch(): string {
	try {
		return (
			execSync("git branch --show-current", {
				cwd: process.cwd(),
				stdio: "pipe",
			})
				.toString()
				.trim() || "main"
		);
	} catch {
		return "main";
	}
}

function resolveRemoteUrl(): string | null {
	try {
		const remote = execSync("git remote get-url origin", {
			cwd: process.cwd(),
			stdio: "pipe",
		})
			.toString()
			.trim();
		return remote || null;
	} catch {
		return null;
	}
}

function insertAuditEntry(
	raw: RawDb,
	entry: Omit<ActivityEntry, "timestamp">,
): void {
	raw
		.prepare(
			`INSERT INTO audit_log (id, timestamp, project_id, agent, action, entity, summary, metadata)
		 VALUES (?, ?, ?, ?, ?, ?, ?, '{}')`,
		)
		.run(
			crypto.randomUUID(),
			nowIso(),
			entry.projectId,
			entry.agent,
			entry.action,
			entry.entity,
			entry.summary,
		);
}

function bootstrapAgentRegistry(raw: RawDb): void {
	const now = nowIso();
	for (const slug of DEFAULT_AGENTS) {
		raw
			.prepare(
				`INSERT INTO agent_registry (slug, status, current_task, updated_at)
			 VALUES (?, 'idle', NULL, ?)
			 ON CONFLICT(slug) DO NOTHING`,
			)
			.run(slug, now);
	}
}

function getTeamAgent(raw: RawDb, slug: string): TeamAgent {
	const row = raw
		.prepare(
			"SELECT slug, status, current_task, updated_at FROM agent_registry WHERE slug = ?",
		)
		.get(slug) as {
		slug: string;
		status: "idle" | "running" | "stopped";
		current_task: string | null;
		updated_at: string;
	};
	return {
		slug: row.slug,
		status: row.status,
		currentTask: row.current_task,
		updatedAt: row.updated_at,
	};
}

function refreshDispatchState(raw: RawDb, dispatchId: string): void {
	const run = raw
		.prepare("SELECT created_at, status FROM dispatch_runs WHERE id = ?")
		.get(dispatchId) as { created_at: string; status: string } | undefined;
	if (!run) return;
	const assignments = raw
		.prepare(
			"SELECT id, agent_slug, task_title FROM dispatch_assignments WHERE dispatch_id = ? ORDER BY rowid ASC",
		)
		.all(dispatchId) as Array<{
		id: string;
		agent_slug: string;
		task_title: string;
	}>;
	const elapsedSeconds = (Date.now() - Date.parse(run.created_at)) / 1_000;
	const stepSeconds = 2;
	let allDone = assignments.length > 0;
	for (const [index, assignment] of assignments.entries()) {
		const start = index * stepSeconds;
		const end = start + stepSeconds;
		let status: DispatchAssignment["status"] = "queued";
		let progress = 0;
		if (elapsedSeconds >= end) {
			status = "done";
			progress = 100;
		} else if (elapsedSeconds >= start) {
			status = "in_progress";
			progress = Math.max(
				10,
				Math.min(
					95,
					Math.round(((elapsedSeconds - start) / stepSeconds) * 100),
				),
			);
			allDone = false;
		} else {
			allDone = false;
		}
		raw
			.prepare(
				"UPDATE dispatch_assignments SET status = ?, progress = ?, updated_at = ? WHERE id = ?",
			)
			.run(status, progress, nowIso(), assignment.id);
		raw
			.prepare(
				"UPDATE agent_registry SET status = ?, current_task = ?, updated_at = ? WHERE slug = ?",
			)
			.run(
				status === "queued" ? "idle" : status === "done" ? "idle" : "running",
				status === "done" ? null : assignment.task_title,
				nowIso(),
				assignment.agent_slug,
			);
	}
	if (allDone && run.status !== "completed") {
		raw
			.prepare(
				"UPDATE dispatch_runs SET status = 'completed', updated_at = ? WHERE id = ?",
			)
			.run(nowIso(), dispatchId);
		insertAuditEntry(raw, {
			projectId: null,
			agent: "ceo",
			action: "dispatch.complete",
			entity: dispatchId,
			summary: `Completed dispatch ${dispatchId}`,
		});
	}
}

function refreshDeploymentState(raw: RawDb, deploymentId: string): void {
	const row = raw
		.prepare(
			"SELECT project_id, environment, created_at, status FROM deployment_runs WHERE id = ?",
		)
		.get(deploymentId) as
		| {
				project_id: string;
				environment: string;
				created_at: string;
				status: string;
		  }
		| undefined;
	if (!row) return;
	const elapsedSeconds = (Date.now() - Date.parse(row.created_at)) / 1_000;
	const stages = ["prepare", "build", "release", "verify"];
	const stageIndex = Math.min(
		stages.length - 1,
		Math.floor(elapsedSeconds / 2),
	);
	const currentStage = stages[stageIndex] ?? "verify";
	const projectNameRow = raw
		.prepare("SELECT name FROM projects WHERE id = ?")
		.get(row.project_id) as { name: string } | undefined;
	const slug = (projectNameRow?.name ?? "project")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	const done = elapsedSeconds >= stages.length * 2;
	const url = done
		? `https://${slug || "setra"}-${row.environment}.setra.local`
		: null;
	raw
		.prepare(
			"UPDATE deployment_runs SET status = ?, current_stage = ?, url = ?, updated_at = ? WHERE id = ?",
		)
		.run(
			done ? "completed" : "running",
			currentStage,
			url,
			nowIso(),
			deploymentId,
		);
	if (done && row.status !== "completed") {
		insertAuditEntry(raw, {
			projectId: row.project_id,
			agent: "deploy",
			action: "deploy.complete",
			entity: row.environment,
			summary: `Deployment finished for ${row.project_id}`,
		});
	}
}

function nowIso(): string {
	return new Date().toISOString();
}
