/**
 * agents.repo.ts — Repository for agents, roster, runs, and templates
 */

import { getRawDb } from "@setra/db";
import { boardBudgetLimits as budgetLimits, runs } from "@setra/db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db, rawSqlite } from "../db/client.js";
import { agentRoster } from "../db/schema.js";

/** Match company_id = :companyId OR company_id IS NULL (pre-migration agents). */
function companyScope(companyId: string) {
	return or(
		eq(agentRoster.companyId, companyId),
		isNull(agentRoster.companyId),
	);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentRosterRow {
	id: string;
	slug: string;
	display_name: string;
	model_id: string | null;
	adapter_type: string | null;
	system_prompt: string | null;
	is_active: number;
	created_at: string;
}

export interface AgentStats {
	totalCostUsd: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	lastActiveAt: string | null;
	totalRuns: number;
}

export interface AgentStatsExtended extends AgentStats {
	avgDurationMs: number | null;
}

export interface ActiveRunInfo {
	issue_id: string | null;
}

// ─── Stale status expression (reusable) ───────────────────────────────────────

export const STALE_STATUS_EXPR = sql<string>`
  case
    when status in ('running','pending')
         and replace(updated_at,'T',' ') < datetime('now','-1 hour')
    then 'completed'
    else status
  end`;

// ─── Agent Roster Queries ─────────────────────────────────────────────────────

export function listRosterByCompany(companyId: string): AgentRosterRow[] {
	return getRawDb()
		.prepare(
			`SELECT * FROM agent_roster WHERE company_id = ? OR company_id IS NULL ORDER BY created_at ASC`,
		)
		.all(companyId) as AgentRosterRow[];
}

export function listRosterGlobal(): AgentRosterRow[] {
	return getRawDb()
		.prepare(`SELECT * FROM agent_roster ORDER BY created_at ASC`)
		.all() as AgentRosterRow[];
}

export function getAgentStats(slug: string): AgentStats | null {
	return getRawDb()
		.prepare(`
    SELECT
      coalesce(sum(cost_usd), 0)            as totalCostUsd,
      coalesce(sum(prompt_tokens), 0)       as totalInputTokens,
      coalesce(sum(completion_tokens), 0)   as totalOutputTokens,
      coalesce(sum(cache_read_tokens), 0)   as totalCacheReadTokens,
      max(started_at)                       as lastActiveAt,
      count(*)                              as totalRuns
    FROM runs WHERE agent = ?
  `)
		.get(slug) as AgentStats | null;
}

export function getAgentStatsExtended(slug: string): AgentStatsExtended | null {
	return getRawDb()
		.prepare(`
    SELECT
      coalesce(sum(cost_usd), 0)                                as totalCostUsd,
      coalesce(sum(prompt_tokens), 0)                           as totalInputTokens,
      coalesce(sum(completion_tokens), 0)                       as totalOutputTokens,
      coalesce(sum(cache_read_tokens), 0)                       as totalCacheReadTokens,
      max(started_at)                                           as lastActiveAt,
      count(*)                                                  as totalRuns,
      avg(
        case when ended_at is not null
          then (julianday(ended_at) - julianday(started_at)) * 86400000
        end
      )                                                         as avgDurationMs
    FROM runs WHERE agent = ?
  `)
		.get(slug) as AgentStatsExtended | null;
}

export function getActiveRun(slug: string): ActiveRunInfo | null {
	return getRawDb()
		.prepare(`
    SELECT i.id as issue_id
    FROM runs r
    LEFT JOIN board_issues i ON i.linked_plot_id = r.plot_id
    WHERE r.agent = ? AND r.status = 'running'
    ORDER BY r.started_at DESC LIMIT 1
  `)
		.get(slug) as ActiveRunInfo | null;
}

export function getLatestHeartbeatForAgent(
	slug: string,
): { lastHeartbeatAt: string | null; activeRuns: number } | null {
	return getRawDb()
		.prepare(`
    SELECT
      max(case when status in ('running','pending') then updated_at end) as lastHeartbeatAt,
      sum(case when status in ('running','pending') then 1 else 0 end) as activeRuns
    FROM runs
    WHERE agent = ?
  `)
		.get(slug) as { lastHeartbeatAt: string | null; activeRuns: number } | null;
}

export async function listRunsAggregate() {
	return db
		.select({
			id: runs.agent,
			slug: runs.agent,
			role: runs.agent,
			model: runs.agentVersion,
			status: STALE_STATUS_EXPR,
			currentIssueId: sql<null>`null`,
			totalCostUsd: sql<number>`sum(coalesce(cost_usd, 0))`,
			totalInputTokens: sql<number>`sum(coalesce(prompt_tokens, 0))`,
			totalOutputTokens: sql<number>`sum(coalesce(completion_tokens, 0))`,
			totalCacheReadTokens: sql<number>`sum(coalesce(cache_read_tokens, 0))`,
			lastActiveAt: sql<string>`max(started_at)`,
		})
		.from(runs)
		.groupBy(runs.agent, runs.agentVersion, runs.status)
		.orderBy(desc(sql`max(started_at)`))
		.limit(50);
}

// ─── Agent Templates ──────────────────────────────────────────────────────────

export function listTemplates(): unknown[] {
	return getRawDb()
		.prepare(`
    SELECT id, name, description, agent, model, system_prompt, tools,
           context_inject, estimated_cost_tier, is_builtin, created_at, updated_at
    FROM agent_templates
    ORDER BY is_builtin DESC, name ASC
  `)
		.all();
}

export function createTemplate(params: {
	name: string;
	description: string | null;
	agent: string;
	model: string | null;
	systemPrompt: string | null;
	tools: string | null;
	contextInject: string | null;
	estimatedCostTier: string;
}): unknown {
	return getRawDb()
		.prepare(`
    INSERT INTO agent_templates (name, description, agent, model, system_prompt, tools, context_inject, estimated_cost_tier, is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    RETURNING *
  `)
		.get(
			params.name,
			params.description,
			params.agent,
			params.model,
			params.systemPrompt,
			params.tools,
			params.contextInject,
			params.estimatedCostTier,
		);
}

// ─── Roster (canonical: agent_roster JOIN agent_templates) ───────────────────
// company_roster is deprecated; agent_roster.template_id and
// agent_roster.parent_agent_id are the canonical fields. We still SELECT
// from company_roster for legacy back-compat reads only when an
// agent_roster row is missing template_id (indicates pre-migration data).

export function listCompanyRoster(companyId: string): unknown[] {
	return getRawDb()
		.prepare(`
    SELECT
      ar.id                                  as id,
      ar.company_id                          as company_id,
      ar.display_name                        as display_name,
      ar.parent_agent_id                     as reports_to,
      ar.is_active                           as is_active,
      ar.created_at                          as hired_at,
      ar.updated_at                          as updated_at,
      coalesce(ar.template_id, t.id)         as template_id,
      t.name                                 as template_name,
      t.description                          as description,
      coalesce(t.agent, ar.adapter_type)     as agent,
      coalesce(t.model, ar.model_id)         as model,
      t.estimated_cost_tier                  as estimated_cost_tier,
      t.is_builtin                           as is_builtin,
      ar.id                                  as agent_id,
      ar.status                              as runtime_status,
      ar.paused_reason                       as paused_reason,
      ar.adapter_type                        as adapter_type,
      ar.model_id                            as model_id,
      ar.run_mode                            as run_mode,
      ar.continuous_interval_ms              as continuous_interval_ms,
      ar.idle_prompt                         as idle_prompt,
      ar.last_run_ended_at                   as last_run_ended_at
    FROM agent_roster ar
    LEFT JOIN agent_templates t ON t.id = ar.template_id
    WHERE ar.company_id = ? OR ar.company_id IS NULL
    ORDER BY ar.created_at ASC
  `)
		.all(companyId);
}

export function getAgentBySlugScoped(
	slug: string,
	companyId: string,
):
	| { id: string; slug: string; status: string; model_id: string | null }
	| undefined {
	return getRawDb()
		.prepare(
			`SELECT id, slug, status, model_id
			   FROM agent_roster
			  WHERE slug = ? AND (company_id = ? OR company_id IS NULL)
			  ORDER BY (company_id IS NULL) ASC
			  LIMIT 1`,
		)
		.get(slug, companyId) as
		| { id: string; slug: string; status: string; model_id: string | null }
		| undefined;
}

export function getTemplate(templateId: string) {
	return getRawDb()
		.prepare(`SELECT * FROM agent_templates WHERE id = ?`)
		.get(templateId) as
		| {
				id: string;
				name: string;
				agent: string;
				model?: string;
				system_prompt?: string;
				tools?: string;
		  }
		| undefined;
}

export function countAgentsWithSlugPrefix(prefix: string): number {
	const result = getRawDb()
		.prepare(`SELECT count(*) as n FROM agent_roster WHERE slug LIKE ?`)
		.get(`${prefix}%`) as { n: number };
	return result.n;
}

export function insertAgentRoster(params: {
	slug: string;
	displayName: string;
	modelId: string | null;
	systemPrompt: string | null;
	adapterType: string | null;
	skills: string | null;
	status: string;
	companyId: string | null;
	templateId?: string | null;
	parentAgentId?: string | null;
	runMode?: string;
	continuousIntervalMs?: number | null;
	idlePrompt?: string | null;
}): Record<string, unknown> {
	return getRawDb()
		.prepare(`
    INSERT INTO agent_roster (
      slug,
      display_name,
      model_id,
      system_prompt,
      adapter_type,
      skills,
      status,
      company_id,
      template_id,
      parent_agent_id,
      run_mode,
      continuous_interval_ms,
      idle_prompt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `)
		.get(
			params.slug,
			params.displayName,
			params.modelId,
			params.systemPrompt,
			params.adapterType,
			params.skills,
			params.status,
			params.companyId,
			params.templateId ?? null,
			params.parentAgentId ?? null,
			params.runMode ?? "on_demand",
			params.continuousIntervalMs ?? 60_000,
			params.idlePrompt ?? null,
		) as Record<string, unknown>;
}

/**
 * @deprecated company_roster is no longer the canonical roster table.
 * Kept as a no-op for any leftover callers; new code should use
 * insertAgentRoster with templateId/parentAgentId instead.
 */
export function insertCompanyRoster(_params: {
	companyId: string | null;
	templateId: string;
	displayName: string;
	reportsTo: string | null;
}): void {
	/* no-op: writes to company_roster have been removed. */
}

export function getCompanyRosterById(id: string, companyId: string) {
	// agent_roster is canonical. Look up by agent_roster.id with company_id check.
	return getRawDb()
		.prepare(`SELECT id FROM agent_roster WHERE id = ? AND (company_id = ? OR company_id IS NULL)`)
		.get(id, companyId);
}

export function updateCompanyRoster(
	id: string,
	companyId: string,
	updates: Record<string, unknown>,
): void {
	const sets: string[] = [];
	const params: unknown[] = [];
	if (updates.displayName !== undefined) {
		sets.push("display_name = ?");
		params.push(updates.displayName);
	}
	if (updates.reportsTo !== undefined) {
		sets.push("parent_agent_id = ?");
		params.push(updates.reportsTo);
	}
	if (updates.isActive !== undefined) {
		sets.push("is_active = ?");
		params.push(updates.isActive ? 1 : 0);
	}
	if (updates.runMode !== undefined) {
		sets.push("run_mode = ?");
		params.push(updates.runMode);
	}
	if (updates.continuousIntervalMs !== undefined) {
		sets.push("continuous_interval_ms = ?");
		params.push(updates.continuousIntervalMs);
	}
	if (updates.idlePrompt !== undefined) {
		sets.push("idle_prompt = ?");
		params.push(updates.idlePrompt);
	}
	if (sets.length === 0) return;
	sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
	params.push(id, companyId);
	getRawDb()
		.prepare(
			`UPDATE agent_roster SET ${sets.join(", ")} WHERE id = ? AND (company_id = ? OR company_id IS NULL)`,
		)
		.run(...params);
}

export function getCompanyRosterWithTemplate(
	id: string,
	companyId: string,
): unknown {
	return getRawDb()
		.prepare(`
    SELECT
      ar.id                              as id,
      ar.display_name                    as display_name,
      ar.parent_agent_id                 as reports_to,
      ar.is_active                       as is_active,
      ar.created_at                      as hired_at,
      ar.updated_at                      as updated_at,
      coalesce(ar.template_id, t.id)     as template_id,
      t.name                             as template_name,
      t.description                      as description,
      coalesce(t.agent, ar.adapter_type) as agent,
      coalesce(t.model, ar.model_id)     as model,
      t.estimated_cost_tier              as estimated_cost_tier,
      t.is_builtin                       as is_builtin,
      ar.run_mode                        as run_mode,
      ar.continuous_interval_ms          as continuous_interval_ms,
      ar.idle_prompt                     as idle_prompt,
      ar.last_run_ended_at               as last_run_ended_at
    FROM agent_roster ar
    LEFT JOIN agent_templates t ON t.id = ar.template_id
    WHERE ar.id = ? AND (ar.company_id = ? OR ar.company_id IS NULL)
  `)
		.get(id, companyId);
}

export function deleteCompanyRoster(id: string, companyId: string): void {
	// Roster delete now removes the agent_roster row (canonical) with company_id check.
	getRawDb()
		.prepare(`DELETE FROM agent_roster WHERE id = ? AND (company_id = ? OR company_id IS NULL)`)
		.run(id, companyId);
}

// ─── Run Management ───────────────────────────────────────────────────────────

export function getRunById(
	runId: string,
): { id: string; agent: string } | undefined {
	return getRawDb()
		.prepare(`SELECT id, agent FROM runs WHERE id = ?`)
		.get(runId) as { id: string; agent: string } | undefined;
}

export function getRunWithStatus(
	runId: string,
): { id: string; agent: string; status: string } | undefined {
	return getRawDb()
		.prepare(`SELECT id, agent, status FROM runs WHERE id = ?`)
		.get(runId) as { id: string; agent: string; status: string } | undefined;
}

export function updateRunHeartbeat(runId: string, now: string): void {
	getRawDb()
		.prepare(`UPDATE runs SET updated_at = ? WHERE id = ?`)
		.run(now, runId);
}

export function updateRunStatus(
	runId: string,
	updates: Record<string, unknown>,
): void {
	const sets: string[] = [];
	const params: unknown[] = [];
	for (const [key, value] of Object.entries(updates)) {
		sets.push(`${key} = ?`);
		params.push(value);
	}
	if (sets.length === 0) return;
	params.push(runId);
	getRawDb()
		.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`)
		.run(...params);
}

export function getChannelHookLookup(runId: string, agentSlug: string) {
	return getRawDb()
		.prepare(
			`SELECT a.company_id AS companyId, a.slug AS slug, a.display_name AS displayName,
            bi.id AS issueId
       FROM agent_roster a
       LEFT JOIN board_issues bi ON bi.linked_plot_id = (SELECT plot_id FROM runs WHERE id = ?)
      WHERE a.slug = ?
      LIMIT 1`,
		)
		.get(runId, agentSlug) as
		| {
				companyId: string | null;
				slug: string;
				displayName: string;
				issueId: string | null;
		  }
		| undefined;
}

// ─── Agent Roster Drizzle Queries ─────────────────────────────────────────────

export async function getAgentRosterById(id: string, companyId: string) {
	const [row] = await db
		.select({
			id: agentRoster.id,
			slug: agentRoster.slug,
			modelId: agentRoster.modelId,
			isActive: agentRoster.isActive,
			adapterType: agentRoster.adapterType,
			status: agentRoster.status,
			pausedReason: agentRoster.pausedReason,
			companyId: agentRoster.companyId,
		})
		.from(agentRoster)
		.where(and(eq(agentRoster.id, id), companyScope(companyId)));
	return row;
}

export async function getAgentRosterBySlug(slug: string, companyId: string) {
	const [row] = await db
		.select({
			id: agentRoster.id,
			slug: agentRoster.slug,
			modelId: agentRoster.modelId,
			isActive: agentRoster.isActive,
			adapterType: agentRoster.adapterType,
			status: agentRoster.status,
			pausedReason: agentRoster.pausedReason,
			companyId: agentRoster.companyId,
		})
		.from(agentRoster)
		.where(and(eq(agentRoster.slug, slug), companyScope(companyId)));
	return row;
}

export async function getFullAgentRosterById(id: string, companyId: string) {
	const [row] = await db
		.select()
		.from(agentRoster)
		.where(and(eq(agentRoster.id, id), companyScope(companyId)));
	return row;
}

export async function getFullAgentRosterBySlug(
	slug: string,
	companyId: string,
) {
	const [row] = await db
		.select()
		.from(agentRoster)
		.where(and(eq(agentRoster.slug, slug), companyScope(companyId)));
	return row;
}

export async function getAgentRosterByDisplayNameAndCompany(
	displayName: string,
	companyId: string,
) {
	const [row] = await db
		.select()
		.from(agentRoster)
		.where(
			and(eq(agentRoster.displayName, displayName), companyScope(companyId)),
		);
	return row;
}

export async function getAgentSlugById(agentId: string) {
	const [row] = await db
		.select({ slug: agentRoster.slug })
		.from(agentRoster)
		.where(eq(agentRoster.id, agentId));
	return row;
}

export async function getAgentSlugByIdScoped(
	agentId: string,
	companyId: string,
) {
	const [row] = await db
		.select({ slug: agentRoster.slug })
		.from(agentRoster)
		.where(and(eq(agentRoster.id, agentId), companyScope(companyId)));
	return row;
}

export async function agentSlugExistsInCompany(
	slug: string,
	companyId: string,
) {
	const [row] = await db
		.select({ slug: agentRoster.slug })
		.from(agentRoster)
		.where(and(eq(agentRoster.slug, slug), companyScope(companyId)));
	return row;
}

// ─── Project workspace lookup ─────────────────────────────────────────────────

export function getIssueWorkspacePath(
	issueId: string,
): { projectId: string; workspacePath: string | null } | undefined {
	return getRawDb()
		.prepare(`
    SELECT bp.id AS projectId, bp.workspace_path AS workspacePath
    FROM board_issues bi
    JOIN board_projects bp ON bp.id = bi.project_id
    WHERE bi.id = ?
  `)
		.get(issueId) as
		| { projectId: string; workspacePath: string | null }
		| undefined;
}

// ─── Board dispatch setup ─────────────────────────────────────────────────────

export function ensureBoardProject(projectId: string, now: string): void {
	getRawDb()
		.prepare(`
    INSERT OR IGNORE INTO projects (id, name, repo_path, created_at, updated_at)
    VALUES (?, 'Board Dispatch', '__board__', ?, ?)
  `)
		.run(projectId, now, now);
}

export function ensureBoardPlot(params: {
	plotId: string;
	projectId: string;
	agentSlug: string;
	worktreePath: string | null;
	now: string;
}): void {
	getRawDb()
		.prepare(`
    INSERT OR IGNORE INTO plots
      (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'main', ?, ?, ?)
  `)
		.run(
			params.plotId,
			params.projectId,
			`Board — ${params.agentSlug}`,
			`board/${params.agentSlug}`,
			params.worktreePath,
			params.now,
			params.now,
		);
}

export function updatePlotWorktree(
	plotId: string,
	worktreePath: string,
	now: string,
): void {
	getRawDb()
		.prepare(
			`UPDATE plots SET worktree_path = ?, updated_at = ?
       WHERE id = ? AND (worktree_path IS NULL OR worktree_path != ?)`,
		)
		.run(worktreePath, now, plotId, worktreePath);
}

export function createRun(params: {
	runId: string;
	plotId: string;
	agentSlug: string;
	model: string | null;
	agentArgs: string | null;
	now: string;
}): void {
	getRawDb()
		.prepare(`
    INSERT INTO runs
      (id, plot_id, agent, agent_version, agent_args, status, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `)
		.run(
			params.runId,
			params.plotId,
			params.agentSlug,
			params.model,
			params.agentArgs,
			params.now,
			params.now,
		);
}

export function createTaskChunk(
	runId: string,
	task: string,
	now: string,
): void {
	getRawDb()
		.prepare(`
    INSERT INTO chunks (run_id, sequence, content, chunk_type, recorded_at)
    VALUES (?, 0, ?, 'input', ?)
  `)
		.run(runId, task, now);
}

export function getRunFull(runId: string): unknown {
	return getRawDb().prepare(`SELECT * FROM runs WHERE id = ?`).get(runId);
}

// ─── Agent detail lookup ──────────────────────────────────────────────────────

export function getCompanyRosterDisplayName(
	id: string,
): { display_name: string; company_id: string } | undefined {
	return getRawDb()
		.prepare(`SELECT display_name, company_id FROM company_roster WHERE id = ?`)
		.get(id) as { display_name: string; company_id: string } | undefined;
}

export function getRunsAggregateByAgent(
	agentId: string,
	companyId: string,
): unknown[] {
	return getRawDb()
		.prepare(`
      SELECT
        r.agent AS id,
        r.agent AS slug,
        r.agent_version AS model,
        CASE
          WHEN r.status IN ('running','pending')
               AND replace(r.updated_at,'T',' ') < datetime('now','-1 hour')
          THEN 'completed'
          ELSE r.status
        END AS status,
        sum(coalesce(r.cost_usd, 0)) AS totalCostUsd,
        sum(coalesce(r.prompt_tokens, 0)) AS totalInputTokens,
        sum(coalesce(r.completion_tokens, 0)) AS totalOutputTokens,
        sum(coalesce(r.cache_read_tokens, 0)) AS totalCacheReadTokens,
        max(r.started_at) AS lastActiveAt
      FROM runs r
      JOIN board_issues i ON i.linked_plot_id = r.plot_id
      WHERE r.agent = ?
        AND i.company_id = ?
      GROUP BY r.agent, r.agent_version, r.status
      ORDER BY max(r.started_at) DESC
      LIMIT 1
    `)
		.all(agentId, companyId);
}

// ─── Agent PATCH update ───────────────────────────────────────────────────────

export async function agentRosterExists(
	id: string,
	companyId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: agentRoster.id })
		.from(agentRoster)
		.where(and(eq(agentRoster.id, id), companyScope(companyId)));
	return !!row;
}

export async function updateAgentRoster(
	id: string,
	companyId: string,
	updates: Partial<typeof agentRoster.$inferInsert>,
) {
	const [updated] = await db
		.update(agentRoster)
		.set(updates)
		.where(and(eq(agentRoster.id, id), companyScope(companyId)))
		.returning();
	return updated;
}

// ─── Agent runs history ───────────────────────────────────────────────────────

export function listAgentRuns(
	slug: string,
	companyId: string,
	limit: number,
): unknown[] {
	return getRawDb()
		.prepare(`
    SELECT
      r.id                                                                  as id,
      r.agent                                                               as agent,
      r.agent                                                               as agentId,
      r.agent_version                                                       as agentVersion,
      r.agent_version                                                       as modelId,
      r.status                                                              as status,
      r.started_at                                                          as startedAt,
      r.ended_at                                                            as completedAt,
      i.id                                                                  as issueId,
      i.title                                                               as issueTitle,
      coalesce(r.prompt_tokens, 0)                                          as inputTokens,
      coalesce(r.completion_tokens, 0)                                      as outputTokens,
      coalesce(r.cache_read_tokens, 0)                                      as cacheReadTokens,
      coalesce(r.cost_usd, 0)                                               as costUsd,
      case when r.ended_at is not null
        then cast((julianday(r.ended_at) - julianday(r.started_at)) * 86400000 as integer)
        else null
      end                                                                   as durationMs
    FROM runs r
    JOIN agent_roster ar ON ar.slug = r.agent
    LEFT JOIN board_issues i ON i.linked_plot_id = r.plot_id
    WHERE r.agent = ?
      AND (ar.company_id = ? OR ar.company_id IS NULL)
    ORDER BY r.started_at DESC
    LIMIT ?
  `)
		.all(slug, companyId, limit);
}

export function listRunChunksScoped(
	runId: string,
	agentSlug: string,
	companyId: string,
): Array<{
	id: string;
	sequence: number;
	content: string;
	chunkType: string;
	recordedAt: string;
}> {
	return getRawDb()
		.prepare(
			`SELECT c.id, c.sequence, c.content, c.chunk_type as chunkType, c.recorded_at as recordedAt
         FROM chunks c
         JOIN runs r ON r.id = c.run_id
         JOIN agent_roster ar ON ar.slug = r.agent
        WHERE c.run_id = ?
          AND r.agent = ?
          AND (ar.company_id = ? OR ar.company_id IS NULL)
        ORDER BY c.sequence
        LIMIT 500`,
		)
		.all(runId, agentSlug, companyId) as Array<{
		id: string;
		sequence: number;
		content: string;
		chunkType: string;
		recordedAt: string;
	}>;
}

// ─── Budget queries ───────────────────────────────────────────────────────────

export async function getBudgetLimitByAgentSlug(slug: string) {
	const rows = await db
		.select()
		.from(budgetLimits)
		.where(eq(budgetLimits.agentSlug, slug))
		.limit(1);
	return rows[0];
}

export async function getBudgetLimitByAgentSlugScoped(
	slug: string,
	companyId: string,
) {
	const rows = await db
		.select({ b: budgetLimits })
		.from(budgetLimits)
		.innerJoin(
			agentRoster,
			and(
				eq(agentRoster.slug, budgetLimits.agentSlug),
				companyScope(companyId),
			),
		)
		.where(eq(budgetLimits.agentSlug, slug))
		.limit(1);
	return rows[0]?.b;
}

export function getSpentInPeriod(slug: string, periodStart: string): number {
	const spent = getRawDb()
		.prepare(`
    SELECT coalesce(sum(cost_usd), 0) as total FROM runs WHERE agent = ? AND started_at >= ?
  `)
		.get(slug, periodStart) as { total: number } | null;
	return spent?.total ?? 0;
}

export function getSpentInPeriodScoped(
	slug: string,
	companyId: string,
	periodStart: string,
): number {
	const spent = getRawDb()
		.prepare(
			`SELECT coalesce(sum(r.cost_usd), 0) as total
         FROM runs r
         JOIN agent_roster ar ON ar.slug = r.agent
        WHERE r.agent = ?
          AND (ar.company_id = ? OR ar.company_id IS NULL)
          AND r.started_at >= ?`,
		)
		.get(slug, companyId, periodStart) as { total: number } | null;
	return spent?.total ?? 0;
}

export async function updateBudgetLimit(
	agentSlug: string,
	updates: Record<string, unknown>,
) {
	const [updated] = await db
		.update(budgetLimits)
		.set(updates)
		.where(eq(budgetLimits.agentSlug, agentSlug))
		.returning();
	return updated;
}

export async function insertBudgetLimit(params: {
	id: string;
	agentSlug: string;
	limitUsd: number;
	periodDays: number;
	alertPercent: number;
}) {
	const [created] = await db.insert(budgetLimits).values(params).returning();
	return created;
}
