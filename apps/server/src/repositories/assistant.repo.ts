/**
 * assistant.repo.ts — Repository for Assistant tools (raw SQL queries)
 */

import { getRawDb } from "@setra/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentRosterRow {
	id: string;
	slug: string;
	display_name: string;
	adapter_type: string;
	model_id: string | null;
	status: string;
	paused_reason: string | null;
	is_active: number;
	company_id: string | null;
}

export interface AgentTemplateRow {
	id: string;
	agent: string;
	model?: string;
	system_prompt?: string;
	tools?: string;
}

// ─── Agent roster queries ─────────────────────────────────────────────────────

export function listAgents(
	companyId: string | null | undefined,
): AgentRosterRow[] {
	return companyId
		? (getRawDb()
				.prepare(
					`SELECT id, slug, display_name, adapter_type, model_id, status, paused_reason, is_active, company_id
           FROM agent_roster WHERE company_id = ? ORDER BY created_at DESC`,
				)
				.all(companyId) as AgentRosterRow[])
		: (getRawDb()
				.prepare(
					`SELECT id, slug, display_name, adapter_type, model_id, status, paused_reason, is_active, company_id
           FROM agent_roster ORDER BY created_at DESC`,
				)
				.all() as AgentRosterRow[]);
}

export function getAgentTemplate(
	templateId: string,
): AgentTemplateRow | undefined {
	return getRawDb()
		.prepare(`SELECT * FROM agent_templates WHERE id = ?`)
		.get(templateId) as AgentTemplateRow | undefined;
}

export function countAgentsBySlugPrefix(baseSlug: string): number {
	const row = getRawDb()
		.prepare(`SELECT count(*) as n FROM agent_roster WHERE slug LIKE ?`)
		.get(`${baseSlug}%`) as { n: number };
	return row.n;
}

export function insertAgent(params: {
	slug: string;
	displayName: string;
	modelId: string | null;
	systemPrompt: string | null;
	adapterType: string;
	skills: string | null;
	status: string;
	companyId: string | null | undefined;
}): unknown {
	return getRawDb()
		.prepare(`
    INSERT INTO agent_roster (slug, display_name, model_id, system_prompt, adapter_type, skills, status, company_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, slug, display_name, adapter_type, model_id, status, company_id
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
		);
}

export function updateAgentStatus(
	slug: string,
	status: string,
	reason: string | null,
	companyId: string | null | undefined,
): number {
	const info = getRawDb()
		.prepare(
			`UPDATE agent_roster
        SET status = ?, paused_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE slug = ? AND (company_id = ? OR company_id IS NULL)`,
		)
		.run(status, reason, slug, companyId ?? "");
	return info.changes;
}

export function updateAgentMode(
	slug: string,
	mode: string,
	companyId: string | null | undefined,
): number {
	const info = getRawDb()
		.prepare(
			`UPDATE agent_roster SET mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE slug = ? AND (company_id = ? OR company_id IS NULL)`,
		)
		.run(mode, slug, companyId ?? "");
	return info.changes;
}

export function updateAgentAdapter(
	slug: string,
	adapter: string,
	companyId: string | null | undefined,
): number {
	const info = getRawDb()
		.prepare(
			`UPDATE agent_roster SET adapter_type = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE slug = ? AND (company_id = ? OR company_id IS NULL)`,
		)
		.run(adapter, slug, companyId ?? "");
	return info.changes;
}

export function updateAgentModel(
	slug: string,
	model: string,
	companyId: string | null | undefined,
): number {
	const info = getRawDb()
		.prepare(
			`UPDATE agent_roster SET model_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE slug = ? AND (company_id = ? OR company_id IS NULL)`,
		)
		.run(model, slug, companyId ?? "");
	return info.changes;
}

export function getAgentBySlug(
	slug: string,
):
	| { id: string; slug: string; status: string; model_id: string | null }
	| undefined {
	return getRawDb()
		.prepare(
			`SELECT id, slug, status, model_id FROM agent_roster WHERE slug = ?`,
		)
		.get(slug) as
		| { id: string; slug: string; status: string; model_id: string | null }
		| undefined;
}

export function getAgentBySlugScoped(
	slug: string,
	companyId: string | null | undefined,
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
		.get(slug, companyId ?? "") as
		| { id: string; slug: string; status: string; model_id: string | null }
		| undefined;
}

// ─── Run queries ──────────────────────────────────────────────────────────────

export function ensureBoardProject(projectId: string, now: string): void {
	getRawDb()
		.prepare(`INSERT OR IGNORE INTO projects (id, name, repo_path, created_at, updated_at)
               VALUES (?, 'Board Dispatch', '__board__', ?, ?)`)
		.run(projectId, now, now);
}

export function ensureBoardPlot(
	plotId: string,
	projectId: string,
	slug: string,
	now: string,
): void {
	getRawDb()
		.prepare(`INSERT OR IGNORE INTO plots (id, project_id, name, branch, base_branch, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'main', ?, ?)`)
		.run(plotId, projectId, `Board — ${slug}`, `board/${slug}`, now, now);
}

export function insertRun(
	runId: string,
	plotId: string,
	slug: string,
	modelId: string | null,
	now: string,
): void {
	getRawDb()
		.prepare(`INSERT INTO runs (id, plot_id, agent, agent_version, status, started_at, updated_at)
               VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
		.run(runId, plotId, slug, modelId, now, now);
}

export function insertChunk(runId: string, task: string, now: string): void {
	getRawDb()
		.prepare(`INSERT INTO chunks (run_id, sequence, content, chunk_type, recorded_at)
               VALUES (?, 0, ?, 'input', ?)`)
		.run(runId, task, now);
}

// ─── Company queries ──────────────────────────────────────────────────────────

export function listCompaniesBasic(): Array<{
	id: string;
	name: string;
	issue_prefix: string;
	goal: string | null;
	type: string | null;
	size: string | null;
}> {
	return getRawDb()
		.prepare(
			`SELECT id, name, issue_prefix, goal, type, size FROM companies ORDER BY created_at`,
		)
		.all() as Array<{
		id: string;
		name: string;
		issue_prefix: string;
		goal: string | null;
		type: string | null;
		size: string | null;
	}>;
}

// ─── Budget queries ───────────────────────────────────────────────────────────

export function getBudgetPeriodSpend(): number {
	const row = getRawDb()
		.prepare(
			`SELECT coalesce(sum(coalesce(cost_usd, 0)), 0) as periodSpend
       FROM runs
       WHERE started_at >= datetime('now', '-30 days')`,
		)
		.get() as { periodSpend: number };
	return row.periodSpend;
}

export function getGlobalBudgetLimit():
	| { limit_usd: number; period_days: number; alert_percent: number }
	| undefined {
	return getRawDb()
		.prepare(
			`SELECT limit_usd, period_days, alert_percent
       FROM board_budget_limits
       WHERE project_id IS NULL AND agent_slug IS NULL LIMIT 1`,
		)
		.get() as
		| { limit_usd: number; period_days: number; alert_percent: number }
		| undefined;
}

export function upsertGlobalBudget(
	limitUsd: number,
	periodDays: number,
	alertPercent: number,
): void {
	const existing = getRawDb()
		.prepare(
			`SELECT id FROM board_budget_limits WHERE project_id IS NULL AND agent_slug IS NULL LIMIT 1`,
		)
		.get() as { id: string } | undefined;
	if (existing) {
		getRawDb()
			.prepare(
				`UPDATE board_budget_limits SET limit_usd = ?, period_days = ?, alert_percent = ?, updated_at = ? WHERE id = ?`,
			)
			.run(
				limitUsd,
				periodDays,
				alertPercent,
				new Date().toISOString(),
				existing.id,
			);
	} else {
		getRawDb()
			.prepare(
				`INSERT INTO board_budget_limits (id, limit_usd, period_days, alert_percent) VALUES (?, ?, ?, ?)`,
			)
			.run(crypto.randomUUID(), limitUsd, periodDays, alertPercent);
	}
}
