import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { AgentsService, RunsService } from "@setra/application";
import { getRawDb } from "@setra/db";
import {
	SqliteAgentsRepository,
	SqliteRunsRepository,
	requireTenantScope,
} from "@setra/infrastructure";
import { Hono } from "hono";
import type { agentRoster } from "../db/schema.js";
import { isCloudAdapter, normalizeAdapterId } from "../lib/adapter-policy.js";
import { getAgentExperience } from "../lib/agent-reflection.js";
import { logActivity } from "../lib/audit.js";
import { postChannelMessage } from "../lib/channel-hooks.js";
import { getCompanyId } from "../lib/company-scope.js";
import { getAgentScore } from "../lib/credibility.js";
import {
	type AdapterId,
	type Complexity,
	pickTierModel,
	resolveAutoAdapter,
} from "../lib/resolve-auto-adapter.js";
import { checkBudgetAllowed } from "../middleware/budget-guard.js";
import * as agentsRepo from "../repositories/agents.repo.js";
import { isOfflineForCompany } from "../repositories/runtime.repo.js";
import { domainEventBus } from "../sse/handler.js";
import {
	CreateAgentRunSchema,
	CreateTemplateSchema,
	GenerateInstructionsSchema,
	HireAgentSchema,
	UpdateAgentSchema,
	UpdateRosterModeSchema,
	UpdateRosterSchema,
	UpdateRunStatusSchema,
	UpsertAgentBudgetSchema,
} from "../validators/agents.validators.js";

export const agentsRoute = new Hono();
const agentsService = new AgentsService(new SqliteAgentsRepository());
const runsService = new RunsService(new SqliteRunsRepository(), domainEventBus);

// ─── GET / — List agents ──────────────────────────────────────────────────────

agentsRoute.get("/", async (c) => {
	// Strict company-scoped roster lookup.
	const cid = getCompanyId(c);
	const rosterRows = cid
		? agentsRepo.listRosterByCompany(cid)
		: agentsRepo.listRosterGlobal();

	if (rosterRows.length > 0) {
		return c.json(
			rosterRows.map((r) => {
				const stats = agentsRepo.getAgentStats(r.slug);
				const activeRun = agentsRepo.getActiveRun(r.slug);
				const score = getAgentScore(r.slug);
				const experience = cid ? getAgentExperience(r.slug, cid) : null;
				const runtimeStatus =
					typeof (r as { status?: string }).status === "string"
						? (r as { status?: string }).status
						: "idle";
				const status = r.is_active ? runtimeStatus : "inactive";
				const completedRuns = score.successes + score.failures;

				return {
					id: r.id,
					slug: r.slug,
					displayName: r.display_name,
					role: r.slug,
					model: r.model_id ?? null,
					adapterType: r.adapter_type,
					isActive: Boolean(r.is_active),
					status,
					runMode: (r as { run_mode?: string }).run_mode ?? "on_demand",
					continuousIntervalMs:
						(r as { continuous_interval_ms?: number | null })
							.continuous_interval_ms ?? 60_000,
					idlePrompt:
						(r as { idle_prompt?: string | null }).idle_prompt ?? null,
					lastRunEndedAt:
						(r as { last_run_ended_at?: string | null }).last_run_ended_at ??
						null,
					totalCostUsd: stats?.totalCostUsd ?? 0,
					totalInputTokens: stats?.totalInputTokens ?? 0,
					totalOutputTokens: stats?.totalOutputTokens ?? 0,
					totalCacheReadTokens: stats?.totalCacheReadTokens ?? 0,
					lastActiveAt: stats?.lastActiveAt ?? null,
					totalRuns: stats?.totalRuns ?? 0,
					currentIssueId: activeRun?.issue_id ?? null,
					credibility: score.credibility,
					successRate:
						completedRuns > 0
							? Math.round((score.successes / completedRuns) * 100)
							: null,
					experienceLevel: experience?.level ?? "Novice",
					topSkills:
						experience?.skills.slice(0, 3).map((skill) => skill.name) ?? [],
				};
			}),
		);
	}

	// Fall back to runs-based aggregation with stable slug as id
	const rows = await agentsRepo.listRunsAggregate();
	return c.json(rows);
});

// ─── GET /heartbeat — per-agent heartbeat observability ───────────────────────
agentsRoute.get("/heartbeat", (c) => {
	const cid = getCompanyId(c);
	const rows = agentsRepo.listRosterByCompany(cid);
	const now = Date.now();
	const result = rows.map((r) => {
		const latest = agentsRepo.getLatestHeartbeatForAgent(r.slug);
		const lastHeartbeatAt = latest?.lastHeartbeatAt ?? null;
		const ageSeconds = lastHeartbeatAt
			? Math.max(0, Math.floor((now - Date.parse(lastHeartbeatAt)) / 1000))
			: null;
		const stale = ageSeconds !== null && ageSeconds > 300;
		return {
			agentId: r.id,
			slug: r.slug,
			lastHeartbeatAt,
			ageSeconds,
			stale,
			activeRuns: latest?.activeRuns ?? 0,
		};
	});
	return c.json(result);
});

// ─── Agent Templates ──────────────────────────────────────────────────────────

agentsRoute.get("/templates", (c) => {
	const rows = agentsRepo.listTemplates();
	return c.json(rows);
});

agentsRoute.post(
	"/templates",
	zValidator("json", CreateTemplateSchema),
	async (c) => {
		const body = c.req.valid("json");

		const row = agentsRepo.createTemplate({
			name: body.name,
			description: body.description ?? null,
			agent: body.agent,
			model: body.model ?? null,
			systemPrompt: body.systemPrompt ?? null,
			tools: body.tools ? JSON.stringify(body.tools) : null,
			contextInject: body.contextInject
				? JSON.stringify(body.contextInject)
				: null,
			estimatedCostTier: body.estimatedCostTier ?? "medium",
		});

		return c.json(row, 201);
	},
);

// ─── Company Roster ───────────────────────────────────────────────────────────

agentsRoute.get("/roster", (c) => {
	const companyId = getCompanyId(c);
	const rows = agentsRepo.listCompanyRoster(companyId);
	return c.json(rows);
});

agentsRoute.get("/experience/summary", (c) => {
	const cid = getCompanyId(c);
	const agents = agentsRepo.listRosterByCompany(cid);
	let totalRuns = 0;
	let totalSuccess = 0;
	let totalFailed = 0;
	let totalCost = 0;
	let totalCredibility = 0;
	const topSkills: Record<string, number> = {};

	for (const agent of agents) {
		const stats = agentsRepo.getAgentStatsExtended(agent.slug);
		const experience = getAgentExperience(agent.slug, cid);
		const score = getAgentScore(agent.slug);
		totalRuns += stats?.totalRuns ?? 0;
		totalCost += stats?.totalCostUsd ?? 0;
		totalSuccess += experience.successCount;
		totalFailed += experience.failedCount;
		totalCredibility += score.credibility;
		for (const skill of experience.skills) {
			topSkills[skill.name] = (topSkills[skill.name] || 0) + skill.total;
		}
	}

	const completedRuns = totalSuccess + totalFailed;
	return c.json({
		totalAgents: agents.length,
		totalRuns,
		totalSuccess,
		totalFailed,
		overallSuccessRate:
			completedRuns > 0 ? Math.round((totalSuccess / completedRuns) * 100) : 0,
		totalCost,
		topSkills: Object.entries(topSkills)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8),
		avgCredibility: agents.length > 0 ? totalCredibility / agents.length : 0.5,
	});
});

agentsRoute.post("/roster", zValidator("json", HireAgentSchema), async (c) => {
	const companyId = getCompanyId(c);
	const body = c.req.valid("json");

	// Look up the template for system prompt / adapter info
	const template = agentsRepo.getTemplate(body.templateId);
	if (!template) return c.json({ error: "template not found" }, 404);

	// Generate a unique slug from display name
	const baseSlug = body.displayName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
	const existingCount = agentsRepo.countAgentsWithSlugPrefix(baseSlug);
	const slug =
		existingCount > 0 ? `${baseSlug}-${existingCount + 1}` : baseSlug;

	// Resolve adapter='auto' / model='auto' against actually-configured providers.
	// If no keys are configured, adapter will be null → agent enters 'awaiting_key'
	// (status persistence deferred to Phase 2; for now returned in the response).
	const resolved = resolveAutoAdapter(
		body.adapterType ?? "auto",
		body.modelId ?? template.model ?? null,
		companyId,
	);
	const initialStatus = resolved.adapter === null ? "awaiting_key" : "idle";

	// Insert into agent_roster (canonical roster table; company_roster is deprecated)
	const row = agentsRepo.insertAgentRoster({
		slug,
		displayName: body.displayName.trim(),
		modelId: resolved.model,
		systemPrompt: template.system_prompt ?? null,
		adapterType: resolved.adapter ?? "auto",
		skills: template.tools ?? null,
		status: initialStatus,
		companyId,
		templateId: body.templateId,
		parentAgentId: body.reportsTo ?? null,
		runMode: body.runMode ?? "on_demand",
		continuousIntervalMs: body.continuousIntervalMs ?? 60_000,
		idlePrompt: body.idlePrompt ?? null,
	});

	await logActivity(c, "agent.hired", "agent_roster", String(row["id"]), {
		displayName: body.displayName.trim(),
		templateId: body.templateId,
	});

	return c.json(
		{
			id: row["id"],
			slug: row["slug"],
			displayName: row["display_name"],
			adapterType: row["adapter_type"],
			model: row["model_id"] ?? null,
			isActive: row["is_active"],
			status: row["status"] ?? initialStatus,
			runMode: row["run_mode"] ?? "on_demand",
			continuousIntervalMs: row["continuous_interval_ms"] ?? 60_000,
			idlePrompt: row["idle_prompt"] ?? null,
			lastRunEndedAt: row["last_run_ended_at"] ?? null,
			resolveReason: resolved.reason,
		},
		201,
	);
});

agentsRoute.get("/roster/:id/experience", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	let agent = await agentsRepo.getFullAgentRosterById(id, cid);
	if (!agent) agent = await agentsRepo.getFullAgentRosterBySlug(id, cid);
	if (!agent) return c.json({ error: "not found" }, 404);

	const experience = getAgentExperience(agent.slug, cid);
	const score = getAgentScore(agent.slug);
	return c.json({
		...experience,
		credibility: score.credibility,
		successes: score.successes,
		failures: score.failures,
	});
});

agentsRoute.patch(
	"/roster/:id",
	zValidator("json", UpdateRosterSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = agentsRepo.getCompanyRosterById(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);

		if (
			body.displayName === undefined &&
			body.reportsTo === undefined &&
			body.isActive === undefined &&
			body.runMode === undefined &&
			body.continuousIntervalMs === undefined &&
			body.idlePrompt === undefined
		) {
			return c.json({ error: "no fields to update" }, 400);
		}

		// Build a partial without `undefined`-valued keys so the call site
		// doesn't run afoul of `exactOptionalPropertyTypes`.
		const updates: {
			displayName?: string;
			reportsTo?: string | null;
			isActive?: boolean;
			runMode?: string;
			continuousIntervalMs?: number;
			idlePrompt?: string | null;
		} = {};
		if (body.displayName !== undefined) updates.displayName = body.displayName;
		if (body.reportsTo !== undefined) updates.reportsTo = body.reportsTo;
		if (body.isActive !== undefined) updates.isActive = body.isActive;
		if (body.runMode !== undefined) updates.runMode = body.runMode;
		if (body.continuousIntervalMs !== undefined)
			updates.continuousIntervalMs = body.continuousIntervalMs;
		if (body.idlePrompt !== undefined) updates.idlePrompt = body.idlePrompt;

		agentsRepo.updateCompanyRoster(id, cid, updates);
		const row = agentsRepo.getCompanyRosterWithTemplate(id, cid);

		await logActivity(c, "agent.updated", "company_roster", id, updates);
		return c.json(row);
	},
);

agentsRoute.patch("/roster/mode/all", async (c) => {
	const cid = getCompanyId(c);
	const body = (await c.req.json()) as {
		run_mode?: string;
		continuous_interval_ms?: number;
	};

	getRawDb()
		.prepare(
			"UPDATE agent_roster SET run_mode = ?, continuous_interval_ms = ? WHERE company_id = ?",
		)
		.run(
			body.run_mode || "continuous",
			body.continuous_interval_ms || 300000,
			cid,
		);

	return c.json({ ok: true });
});

agentsRoute.patch(
	"/roster/:id/mode",
	zValidator("json", UpdateRosterModeSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = agentsRepo.getCompanyRosterById(id, cid);
		if (!existing) return c.json({ error: "not found" }, 404);

		agentsRepo.updateCompanyRoster(id, cid, {
			runMode: body.runMode,
			...(body.continuousIntervalMs !== undefined
				? { continuousIntervalMs: body.continuousIntervalMs }
				: {}),
			...(body.idlePrompt !== undefined ? { idlePrompt: body.idlePrompt } : {}),
		});
		const row = agentsRepo.getCompanyRosterWithTemplate(id, cid);
		await logActivity(c, "agent.mode_updated", "company_roster", id, body);
		return c.json(row);
	},
);

agentsRoute.delete("/roster/:id", (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const existing = agentsRepo.getCompanyRosterById(id, cid);
	if (!existing) return c.json({ error: "not found" }, 404);
	agentsRepo.deleteCompanyRoster(id, cid);
	void logActivity(c, "agent.fired", "company_roster", id);
	return c.json({ ok: true });
});

// ─── PATCH /runs/:runId/heartbeat — Proof-of-life heartbeat ─────────────────
// Called by the Electron runner (or any runner) to signal a run is still alive.
// Updates `updated_at` so the stale-run detector doesn't prematurely mark it done.

// PATCH /runs/:runId/heartbeat — proof-of-life heartbeat. No body — clients
// call with method-only; skipping zValidator.
agentsRoute.patch("/runs/:runId/heartbeat", async (c) => {
	const scope = requireTenantScope(getCompanyId(c));
	const runId = c.req.param("runId");
	const result = await runsService.heartbeat(scope, runId);
	if (!result) return c.json({ error: "run not found" }, 404);
	return c.json({ ok: true, updatedAt: result.updatedAt });
});

// ─── PATCH /runs/:runId/status — Update run status ───────────────────────────
// Allows external runners (Electron or future server-side runner) to report
// status changes: pending → running → completed | failed | cancelled.

agentsRoute.patch(
	"/runs/:runId/status",
	zValidator("json", UpdateRunStatusSchema),
	async (c) => {
		const scope = requireTenantScope(getCompanyId(c));
		const runId = c.req.param("runId");
		const body = c.req.valid("json");
		const statusInput = {
			status: body.status,
			...(body.exitCode !== undefined ? { exitCode: body.exitCode } : {}),
			...(body.errorMessage !== undefined
				? { errorMessage: body.errorMessage }
				: {}),
			...(body.costUsd !== undefined ? { costUsd: body.costUsd } : {}),
			...(body.promptTokens !== undefined
				? { promptTokens: body.promptTokens }
				: {}),
			...(body.completionTokens !== undefined
				? { completionTokens: body.completionTokens }
				: {}),
			...(body.cacheReadTokens !== undefined
				? { cacheReadTokens: body.cacheReadTokens }
				: {}),
		};
		let updated;
		try {
			updated = await runsService.updateStatus(scope, runId, statusInput);
		} catch (err) {
			return c.json(
				{ error: err instanceof Error ? err.message : "transition failed" },
				422,
			);
		}
		if (!updated) return c.json({ error: "run not found" }, 404);

		// ── Channel lifecycle hook ───────────────────────────────────────────────
		// Drop a status row into team_messages for the company's general channel
		// so Collaboration page reflects activity in real time.
		if (body.status === "running" || body.status === "completed") {
			try {
				const lookup = agentsRepo.getChannelHookLookup(
					runId,
					updated.run.agentId,
				);
				if (lookup?.companyId) {
					postChannelMessage(
						lookup.companyId,
						"general",
						lookup.slug,
						lookup.displayName,
						body.status === "running" ? "started" : "completed",
						{ runId, issueId: lookup.issueId },
					);
				}
			} catch (err) {
				console.warn(`[agents] channel-hook for run ${runId} failed:`, err);
			}
		}

		return c.json({ ok: true });
	},
);

// ─── POST /:id/runs — Board-triggered run ──────────────────────────────────────
// Creates a run record in the shared SQLite DB so the board (or Electron app)
// can track it. Checks per-agent and global budget limits before inserting.
//
// NOTE: This endpoint only creates the DB record (status = 'pending').
// Actual process spawning is handled by the Electron desktop app, which polls
// for pending runs and calls terminal:spawn over IPC. If no Electron app is
// connected, the run will remain 'pending' until one connects.

agentsRoute.post(
	"/:id/runs",
	zValidator("json", CreateAgentRunSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const scope = requireTenantScope(cid);
		const agentId = c.req.param("id");
		const body = c.req.valid("json");

		// Resolve the agent slug from roster or treat id as slug directly
		const { agent, agentSlug } = await agentsService.resolveScopedAgent(
			scope,
			agentId,
		);

		if (agent && !agent.isActive) {
			return c.json({ error: `Agent "${agentSlug}" is inactive` }, 422);
		}
		if (agent?.status === "awaiting_key") {
			return c.json(
				{
					error: `Agent "${agentSlug}" is awaiting an API key. Save one in Settings to activate.`,
					status: "awaiting_key",
				},
				422,
			);
		}
		if (agent?.status === "paused") {
			return c.json(
				{
					error: `Agent "${agentSlug}" is paused: ${agent.pausedReason ?? "unknown"}`,
					status: "paused",
				},
				422,
			);
		}
		if (agent && isOfflineForCompany(cid)) {
			const adapter = normalizeAdapterId(agent.adapterType);
			if (isCloudAdapter(adapter)) {
				return c.json(
					{
						error: `Company is offline-only. Agent "${agentSlug}" uses cloud adapter "${adapter}". Switch to a local adapter (ollama/lmstudio).`,
					},
					422,
				);
			}
		}

		// ── Budget guard ───────────────────────────────────────────────────────────
		const budget = await checkBudgetAllowed(agentSlug, cid);
		if (!budget.allowed) {
			return c.json(
				{ error: budget.reason ?? "Budget limit reached", budget },
				422,
			);
		}

		// ── Smart-tier model selection ─────────────────────────────────────────────
		// If the caller passed `complexity` (trivial/standard/complex), pick the
		// matching tier on whichever adapter the agent is bound to. This is how
		// the runtime gets cheap-when-fine, expensive-when-needed routing without
		// hardcoded models. Falls back to the agent's stored modelId, then nothing.
		let runModel: string | null = body.model ?? null;
		if (!runModel && body.complexity && agent?.adapterType) {
			try {
				runModel = pickTierModel(
					agent.adapterType as AdapterId,
					body.complexity,
				);
			} catch {
				/* unknown adapter, fall through */
			}
		}
		if (!runModel) runModel = agent?.modelId ?? null;

		// ── Resolve project workspace sandbox (if any) ─────────────────────────────
		// When the dispatch is tied to an issue whose project has a workspace_path
		// configured, we want the resulting plot's worktreePath to be that absolute
		// directory so the agent's PTY cwd is sandboxed there. Validate the path
		// before trusting it; if validation fails, log a warning and fall back to
		// the legacy (no worktree) behavior.
		let plotWorktreePath: string | null = null;
		let projectScopeKey = "";
		if (body.issueId) {
			try {
				const row = await runsService.getScopedIssueWorkspace(
					scope,
					body.issueId,
				);
				if (!row?.workspacePath) {
					return c.json(
						{
							error:
								"Project workspace is missing. Set a workspace path in Projects before starting agent runs for this issue.",
						},
						422,
					);
				}
				if (row.workspacePath) {
					const wp = row.workspacePath;
					if (
						path.isAbsolute(wp) &&
						existsSync(wp) &&
						statSync(wp).isDirectory()
					) {
						plotWorktreePath = wp;
						projectScopeKey = row.projectId.replace(/-/g, "").slice(0, 8);
					} else {
						console.warn(
							`[agents] workspace_path for project ${row.projectId} failed validation (not absolute / not an existing directory): ${wp}`,
						);
					}
				}
			} catch (err) {
				console.warn(
					`[agents] failed to look up workspace_path for issue ${body.issueId}:`,
					err,
				);
			}
		}

		const baseBoardPlotId = agent
			? `bp${agent.id.replace(/-/g, "")}`
			: `board-${agentSlug}`;
		const { run } = await runsService.createPendingRun(scope, {
			agentSlug,
			plotSeed: projectScopeKey
				? `${baseBoardPlotId}-${projectScopeKey}`.slice(0, 32)
				: agent
					? baseBoardPlotId.slice(0, 32)
					: baseBoardPlotId.slice(0, 32).padEnd(32, "0"),
			model: runModel,
			agentArgs: body.agentArgs ?? null,
			...(body.issueId !== undefined ? { issueId: body.issueId } : {}),
			...(body.task !== undefined ? { task: body.task } : {}),
			worktreePath: plotWorktreePath,
			projectScopeKey: "",
		});
		return c.json(run, 201);
	},
);

// ─── GET /:id — Agent detail ──────────────────────────────────────────────────

function getAgentExperienceSnapshot(
	agentSlug: string,
	companyId: string | null,
) {
	const score = getAgentScore(agentSlug);
	const completedRuns = score.successes + score.failures;
	const experience = companyId
		? getAgentExperience(agentSlug, companyId)
		: null;
	return {
		credibility: score.credibility,
		successRate:
			completedRuns > 0
				? Math.round((score.successes / completedRuns) * 100)
				: null,
		experienceLevel: experience?.level ?? "Novice",
		topSkills: experience?.skills.slice(0, 3).map((skill) => skill.name) ?? [],
	};
}

// Helper to enrich a roster row with stats + parsed JSON fields
function enrichRosterRow(row: typeof agentRoster.$inferSelect) {
	const stats = agentsRepo.getAgentStatsExtended(row.slug);
	const runtimeStatus = typeof row.status === "string" ? row.status : "idle";
	const experience = getAgentExperienceSnapshot(
		row.slug,
		row.companyId ?? null,
	);

	return {
		id: row.id,
		slug: row.slug,
		displayName: row.displayName,
		role: row.slug,
		model: row.modelId ?? null,
		modelId: row.modelId ?? null,
		adapterType: row.adapterType,
		isActive: row.isActive,
		status: row.isActive ? runtimeStatus : "inactive",
		systemPrompt: row.systemPrompt ?? null,
		command: row.command ?? null,
		commandArgs: row.commandArgs ?? null,
		httpUrl: row.httpUrl ?? null,
		envVars: row.envVars
			? (() => {
					try {
						return JSON.parse(row.envVars!);
					} catch {
						return {};
					}
				})()
			: {},
		allowedPermissions: row.allowedPermissions
			? (() => {
					try {
						return JSON.parse(row.allowedPermissions!);
					} catch {
						return [];
					}
				})()
			: [],
		skills: row.skills
			? (() => {
					try {
						return JSON.parse(row.skills!);
					} catch {
						return [];
					}
				})()
			: [],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		totalCostUsd: stats?.totalCostUsd ?? 0,
		totalInputTokens: stats?.totalInputTokens ?? 0,
		totalOutputTokens: stats?.totalOutputTokens ?? 0,
		totalCacheReadTokens: stats?.totalCacheReadTokens ?? 0,
		lastActiveAt: stats?.lastActiveAt ?? null,
		totalRuns: stats?.totalRuns ?? 0,
		avgDurationMs: stats?.avgDurationMs ?? null,
		currentIssueId: null,
		mode: (row as typeof row & { mode?: string }).mode ?? "write",
		autonomyLevel:
			(row as typeof row & { autonomyLevel?: string }).autonomyLevel ?? "semi",
		runMode: (row as typeof row & { runMode?: string }).runMode ?? "on_demand",
		continuousIntervalMs:
			(row as typeof row & { continuousIntervalMs?: number | null })
				.continuousIntervalMs ?? 60_000,
		idlePrompt:
			(row as typeof row & { idlePrompt?: string | null }).idlePrompt ?? null,
		lastRunEndedAt:
			(row as typeof row & { lastRunEndedAt?: string | null }).lastRunEndedAt ??
			null,
		credibility: experience.credibility,
		successRate: experience.successRate,
		experienceLevel: experience.experienceLevel,
		topSkills: experience.topSkills,
	};
}

agentsRoute.get("/:id", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");

	// Look up in roster first (agent_roster.id)
	const rosterRow = await agentsRepo.getFullAgentRosterById(id, cid);
	if (rosterRow) return c.json(enrichRosterRow(rosterRow));

	// Try by slug
	const bySlug = await agentsRepo.getFullAgentRosterBySlug(id, cid);
	if (bySlug) return c.json(enrichRosterRow(bySlug));

	// (The legacy company_roster.id → display_name → agent_roster bridge has
	// been removed: agent_roster is canonical, so id and agent_id share the
	// same id-space after the roster merge migration.)

	// Fall back to runs aggregate (slug = id in fallback mode)
	const rows = await agentsRepo.getRunsAggregateByAgent(id, cid);

	const row = rows[0];
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

// ─── PATCH /:id — Update roster entry ─────────────────────────────────────────

agentsRoute.patch("/:id", zValidator("json", UpdateAgentSchema), async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const body = c.req.valid("json");

	const exists = await agentsRepo.agentRosterExists(id, cid);
	if (!exists) return c.json({ error: "not found" }, 404);

	const updates: Partial<typeof agentRoster.$inferInsert> = {
		updatedAt: new Date().toISOString(),
	};
	if (body.displayName !== undefined) updates.displayName = body.displayName;
	if (body.model !== undefined) updates.modelId = body.model;
	if (body.modelId !== undefined) updates.modelId = body.modelId;
	if (body.status !== undefined) updates.status = body.status;
	if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt;
	if (body.adapterType !== undefined) updates.adapterType = body.adapterType;
	if (body.command !== undefined) updates.command = body.command;
	if (body.commandArgs !== undefined) updates.commandArgs = body.commandArgs;
	if (body.httpUrl !== undefined) updates.httpUrl = body.httpUrl;
	if (body.envVars !== undefined) {
		updates.envVars =
			typeof body.envVars === "string"
				? body.envVars
				: JSON.stringify(body.envVars);
	}
	if (body.allowedPermissions !== undefined) {
		updates.allowedPermissions =
			typeof body.allowedPermissions === "string"
				? body.allowedPermissions
				: JSON.stringify(body.allowedPermissions);
	}
	if (body.skills !== undefined) {
		updates.skills =
			typeof body.skills === "string"
				? body.skills
				: JSON.stringify(body.skills);
	}
	if (body.isActive !== undefined) updates.isActive = body.isActive;
	if (body.mode !== undefined) {
		if (!["write", "read_only", "plan", "conversation"].includes(body.mode)) {
			return c.json({ error: "invalid mode" }, 400);
		}
		(
			updates as Partial<typeof agentRoster.$inferInsert> & { mode?: string }
		).mode = body.mode;
	}
	if (body.autonomyLevel !== undefined) {
		if (
			!["none", "basic", "plus", "semi", "full"].includes(body.autonomyLevel)
		) {
			return c.json({ error: "invalid autonomy level" }, 400);
		}
		(
			updates as Partial<typeof agentRoster.$inferInsert> & {
				autonomyLevel?: string;
			}
		).autonomyLevel = body.autonomyLevel;
	}
	if (body.runMode !== undefined) {
		if (!["on_demand", "continuous", "scheduled"].includes(body.runMode)) {
			return c.json({ error: "invalid run mode" }, 400);
		}
		(
			updates as Partial<typeof agentRoster.$inferInsert> & { runMode?: string }
		).runMode = body.runMode;
	}
	if (body.continuousIntervalMs !== undefined) {
		(
			updates as Partial<typeof agentRoster.$inferInsert> & {
				continuousIntervalMs?: number | null;
			}
		).continuousIntervalMs = body.continuousIntervalMs;
	}
	if (body.idlePrompt !== undefined) {
		(
			updates as Partial<typeof agentRoster.$inferInsert> & {
				idlePrompt?: string | null;
			}
		).idlePrompt = body.idlePrompt;
	}

	const updated = await agentsRepo.updateAgentRoster(id, cid, updates);
	return c.json(updated);
});

// ─── GET /:id/runs — Agent run history ────────────────────────────────────────

agentsRoute.get("/:id/runs", async (c) => {
	const cid = getCompanyId(c);
	const agentId = c.req.param("id");
	const limitStr = c.req.query("limit") ?? "20";
	const limit = Math.min(Number.parseInt(limitStr, 10) || 20, 100);

	// Resolve roster slug if id is a UUID
	let slug = agentId;
	const rosterRow = await agentsRepo.getAgentSlugByIdScoped(agentId, cid);
	if (rosterRow) slug = rosterRow.slug;
	else {
		const bySlug = await agentsRepo.agentSlugExistsInCompany(agentId, cid);
		if (!bySlug) return c.json({ error: "not found" }, 404);
	}

	const rows = agentsRepo.listAgentRuns(slug, cid, limit);
	return c.json(rows);
});

// ─── GET /:id/runs/:runId/log — Run chunk log ─────────────────────────────────

agentsRoute.get("/:id/runs/:runId/log", async (c) => {
	const cid = getCompanyId(c);
	const agentId = c.req.param("id");
	const runId = c.req.param("runId");
	const afterStr = c.req.query("after") ?? "0";
	const after = Number.parseInt(afterStr, 10) || 0;

	let slug = agentId;
	const rosterRow = await agentsRepo.getAgentSlugByIdScoped(agentId, cid);
	if (rosterRow) slug = rosterRow.slug;
	else {
		const bySlug = await agentsRepo.agentSlugExistsInCompany(agentId, cid);
		if (!bySlug) return c.json({ error: "not found" }, 404);
	}

	const rows = agentsRepo.listRunChunksScoped(runId, slug, cid);
	const filtered = rows.filter((r) => r.sequence > after);
	return c.json(filtered);
});

// ─── GET /:id/budget — Agent budget ───────────────────────────────────────────

agentsRoute.get("/:id/budget", async (c) => {
	const cid = getCompanyId(c);
	const agentId = c.req.param("id");

	// Resolve roster slug from id
	let slug = agentId;
	const rosterRow = await agentsRepo.getAgentSlugByIdScoped(agentId, cid);
	if (rosterRow) slug = rosterRow.slug;
	else {
		const bySlug = await agentsRepo.agentSlugExistsInCompany(agentId, cid);
		if (!bySlug) return c.json({ error: "not found" }, 404);
	}

	const row = await agentsRepo.getBudgetLimitByAgentSlugScoped(slug, cid);
	const periodDays = row?.periodDays ?? 30;
	const period =
		periodDays <= 1 ? "daily" : periodDays <= 7 ? "weekly" : "monthly";

	// Compute spentUsd over the period
	const periodStart = new Date();
	periodStart.setDate(periodStart.getDate() - periodDays);
	const spentUsd = agentsRepo.getSpentInPeriodScoped(
		slug,
		cid,
		periodStart.toISOString(),
	);

	if (!row) {
		return c.json({
			agentId: slug,
			agentSlug: slug,
			scope: "agent",
			limitUsd: null,
			periodDays: 30,
			period: "monthly",
			alertPercent: 80,
			spentUsd,
		});
	}
	return c.json({
		...row,
		agentId: slug,
		scope: "agent",
		period,
		spentUsd,
	});
});

// ─── PUT /:id/budget — Upsert agent budget ────────────────────────────────────

agentsRoute.put(
	"/:id/budget",
	zValidator("json", UpsertAgentBudgetSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const agentId = c.req.param("id");
		const body = c.req.valid("json");

		let slug = agentId;
		const rosterRow = await agentsRepo.getAgentSlugByIdScoped(agentId, cid);
		if (rosterRow) slug = rosterRow.slug;
		else {
			const bySlug = await agentsRepo.agentSlugExistsInCompany(agentId, cid);
			if (!bySlug) return c.json({ error: "not found" }, 404);
		}

		const existing = await agentsRepo.getBudgetLimitByAgentSlugScoped(
			slug,
			cid,
		);

		if (existing) {
			const updated = await agentsRepo.updateBudgetLimit(slug, {
				...(body.limitUsd !== undefined
					? { limitUsd: body.limitUsd ?? 0 }
					: {}),
				...(body.periodDays !== undefined
					? { periodDays: body.periodDays }
					: {}),
				...(body.alertPercent !== undefined
					? { alertPercent: body.alertPercent }
					: {}),
				updatedAt: new Date().toISOString(),
			});
			return c.json(updated);
		}

		const created = await agentsRepo.insertBudgetLimit({
			id: crypto.randomUUID(),
			agentSlug: slug,
			limitUsd: body.limitUsd ?? 10,
			periodDays: body.periodDays ?? 30,
			alertPercent: body.alertPercent ?? 80,
		});
		return c.json(created, 201);
	},
);

// ─── POST /:id/claude-login — Removed ─────────────────────────────────────────
//
// Claude OAuth login was a stub that returned ok without doing anything,
// which lied to the UI. Real auth flows go through Settings → API keys.
// If/when we add OAuth, do it as its own route under /auth/, not per-agent.

// POST /:id/claude-login — no body. Skipping zValidator because clients
// invoke this method-only (and the route always responds 410 anyway).
agentsRoute.post("/:id/claude-login", (c) => {
	return c.json(
		{
			ok: false,
			error: "claude-login is not implemented",
			hint: "Add your Anthropic API key in Settings instead.",
		},
		410,
	);
});

// ─── POST /generate-instructions — Draft system prompt for a role ─────────────
//
// Body: { role: string; companyGoal?: string; companyName?: string }
// Calls /api/ai/chat internally with a directed prompt and returns the reply
// as `{ instructions: string }`.

agentsRoute.post(
	"/generate-instructions",
	zValidator("json", GenerateInstructionsSchema),
	async (c) => {
		const body = c.req.valid("json");
		const role = (body.role ?? "").trim();
		if (!role) return c.json({ error: "role is required" }, 400);

		const companyName =
			(body.companyName ?? "this company").trim() || "this company";
		const goalLine = body.companyGoal?.trim()
			? ` Company goal: ${body.companyGoal.trim()}.`
			: "";

		const userPrompt =
			`Draft system instructions for the ${role} agent at ${companyName}.${goalLine} ` +
			`Return only the instructions text — no preface, no markdown headers, no closing remarks. ` +
			`Cover: scope of responsibility, decision boundaries, collaboration norms, and tone.`;

		const cid = getCompanyId(c);
		const port = process.env["SETRA_PORT"] ?? "3141";
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (cid) headers["x-company-id"] = cid;
		const instanceToken = process.env["SETRA_INSTANCE_TOKEN"]?.trim();
		if (instanceToken) headers["x-instance-token"] = instanceToken;

		let resp: Response;
		try {
			resp = await fetch(`http://localhost:${port}/api/ai/chat`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					companyName,
					...(body.companyGoal ? { companyGoal: body.companyGoal } : {}),
					messages: [{ role: "user", content: userPrompt }],
				}),
			});
		} catch (err) {
			return c.json(
				{ error: `ai/chat unreachable: ${(err as Error).message}` },
				502,
			);
		}

		if (!resp.ok) {
			const text = (await resp.text()).slice(0, 300);
			return c.json({ error: `ai/chat ${resp.status}: ${text}` }, 502);
		}
		const data = (await resp.json()) as { reply?: string };
		const instructions = (data.reply ?? "").trim();
		if (!instructions)
			return c.json({ error: "Empty response from AI provider" }, 502);
		return c.json({ instructions });
	},
);
