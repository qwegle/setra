/**
 * companies.repo.ts — Repository for companies table + cascade delete + export
 */

import { eq } from "drizzle-orm";
import { db, rawSqlite } from "../db/client.js";
import { companies } from "../db/schema.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Company = typeof companies.$inferSelect;
export type CompanyInsert = Partial<
	Omit<typeof companies.$inferInsert, "id" | "createdAt" | "updatedAt">
> & { name: string };

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function listCompanies(): Promise<Company[]> {
	return db.select().from(companies).orderBy(companies.createdAt);
}

export async function getCompanyById(id: string): Promise<Company | undefined> {
	const [row] = await db.select().from(companies).where(eq(companies.id, id));
	return row;
}

export async function createCompany(
	data: CompanyInsert,
): Promise<Company | undefined> {
	// Dedup: if a company with the same name already exists, return it
	if (data.name) {
		const [existing] = await db
			.select()
			.from(companies)
			.where(eq(companies.name, data.name));
		if (existing) return existing;
	}

	const issuePrefix =
		(data.name ?? "")
			.replace(/[^a-zA-Z]/g, "")
			.slice(0, 4)
			.toUpperCase() || "PROJ";
	const [row] = await db
		.insert(companies)
		.values({
			name: data.name,
			issuePrefix,
			goal: data.goal ?? null,
			type: data.type ?? null,
			size: data.size ?? null,
			isOfflineOnly: data.isOfflineOnly ?? false,
			brandColor: data.brandColor ?? null,
			logoUrl: data.logoUrl ?? null,
		})
		.returning();
	return row;
}

export async function updateCompany(
	id: string,
	updates: Partial<CompanyInsert>,
): Promise<Company | undefined> {
	const patchedUpdates: Record<string, unknown> = {
		updatedAt: new Date().toISOString(),
	};
	if (updates.name !== undefined) patchedUpdates.name = updates.name;
	if (updates.goal !== undefined) patchedUpdates.goal = updates.goal;
	if (updates.type !== undefined) patchedUpdates.type = updates.type;
	if (updates.size !== undefined) patchedUpdates.size = updates.size;
	if (updates.brandColor !== undefined)
		patchedUpdates.brandColor = updates.brandColor;
	if (updates.logoUrl !== undefined) patchedUpdates.logoUrl = updates.logoUrl;
	if (updates.isOfflineOnly !== undefined)
		patchedUpdates.isOfflineOnly = updates.isOfflineOnly;

	const [updated] = await db
		.update(companies)
		.set(patchedUpdates)
		.where(eq(companies.id, id))
		.returning();
	return updated;
}

export async function companyExists(id: string): Promise<boolean> {
	const [row] = await db
		.select({ id: companies.id })
		.from(companies)
		.where(eq(companies.id, id));
	return !!row;
}

export function cascadeDeleteCompany(companyId: string): void {
	const tx = rawSqlite.transaction((cid: string) => {
		for (const table of [
			"goals",
			"company_roster",
			"approvals",
			"routines",
			"inbox_alerts",
			"company_members",
			"company_invites",
			"workspaces",
			"adapter_configs",
			"plugins",
			"skills",
			"artifacts",
			"wiki_entries",
			"review_items",
			"agent_roster",
			"integrations",
			"team_messages",
			"board_projects",
			"board_issues",
		]) {
			try {
				rawSqlite.prepare(`DELETE FROM ${table} WHERE company_id = ?`).run(cid);
			} catch {
				/* table may not exist on older installs */
			}
		}
		rawSqlite.prepare("DELETE FROM companies WHERE id = ?").run(cid);
	});
	tx(companyId);
}

// ─── Assistant (per-company) ──────────────────────────────────────────────────

export function assistantSlugFor(_companyId: string): string {
	return "assistant";
}

export function ensureAssistantForCompany(companyId: string): void {
	const slug = assistantSlugFor(companyId);
	try {
		const existing = rawSqlite
			.prepare(`SELECT id FROM agent_roster WHERE company_id = ? AND slug = ?`)
			.get(companyId, slug) as { id: string } | undefined;
		if (existing) return;
		rawSqlite
			.prepare(
				`INSERT INTO agent_roster (id, company_id, slug, display_name, model_id, adapter_type, status, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
			)
			.run(
				crypto.randomUUID(),
				companyId,
				slug,
				"Assistant",
				"auto",
				"auto",
				"idle",
			);
	} catch {
		// Older installs may not yet have the company_id column, or a concurrent
		// insert may have raced us. Either way, leaving the roster as-is is safe.
	}
}

export function ensureAssistantsForAllCompanies(): void {
	try {
		const rows = rawSqlite.prepare(`SELECT id FROM companies`).all() as Array<{
			id: string;
		}>;
		for (const r of rows) ensureAssistantForCompany(r.id);
	} catch {
		// companies table may not exist yet on a brand-new install.
	}
}

function safeSlug(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "") || "ceo"
	);
}

export function ensureCeoForCompany(params: {
	companyId: string;
	companyName: string;
	companyGoal?: string | null;
	projectName?: string | null;
	projectDescription?: string | null;
	workspacePath?: string | null;
}): void {
	const {
		companyId,
		companyName,
		companyGoal,
		projectName,
		projectDescription,
		workspacePath,
	} = params;
	try {
		const existing = rawSqlite
			.prepare(
				`SELECT id FROM agent_roster WHERE company_id = ? AND (slug = 'ceo' OR lower(display_name) = 'ceo') LIMIT 1`,
			)
			.get(companyId) as { id: string } | undefined;
		if (existing) return;

		const baseSlug = "ceo";
		const collision = rawSqlite
			.prepare(
				`SELECT COUNT(*) AS n FROM agent_roster WHERE company_id = ? AND slug LIKE 'ceo%'`,
			)
			.get(companyId) as { n: number } | undefined;
		const n = collision?.n ?? 0;
		const slug = n === 0 ? baseSlug : `${baseSlug}-${n + 1}`;

		const systemPrompt = [
			`You are the CEO of ${companyName}.`,
			companyGoal ? `Company goal: ${companyGoal}` : null,
			projectName ? `Current project: ${projectName}.` : null,
			projectDescription ? `Project brief: ${projectDescription}` : null,
			workspacePath ? `Project workspace: ${workspacePath}` : null,
			"You are the FIRST and ONLY employee at this company. There is no engineering team yet — you build the team on demand.",
			"Own planning, convert the brief into executable stories/tasks, and keep delivery moving.",
			"For broad issues, first write a concise plan that can be posted as an issue comment, then decompose the work into sub-issues using the create_sub_issues tool.",
			"Each sub-issue must include a title, description, priority, and estimated complexity.",
			"HIRING — When an issue needs a role you don't have on the team (e.g. a developer, QA, designer, security engineer), invoke the `hire_agent` tool BEFORE assigning the work. Pick the templateId from the catalog that best matches the role; if nothing fits, pick the closest and customize via systemPrompt. After hiring, assign the sub-issue to the new agent. Do NOT try to do specialist work yourself — your job is leadership and delegation.",
			"Only hire when there's concrete work for the role right now. Do not pre-staff roles speculatively.",
		]
			.filter(Boolean)
			.join("\n");

		rawSqlite
			.prepare(
				`INSERT INTO agent_roster
          (id, company_id, slug, display_name, model_id, adapter_type, system_prompt, status, is_active, run_mode, continuous_interval_ms)
         VALUES (?, ?, ?, 'CEO', 'auto', 'auto', ?, 'idle', 1, 'continuous', 300000)`,
			)
			.run(crypto.randomUUID(), companyId, safeSlug(slug), systemPrompt);
	} catch (err) {
		// Best effort only — signup / project creation should not fail if CEO provisioning fails.
		// eslint-disable-next-line no-console
		console.warn("[ensureCeoForCompany] failed", err);
	}
}

// ─── Export helpers ───────────────────────────────────────────────────────────

export function safeAll(sql: string, ...params: unknown[]): unknown[] {
	try {
		return rawSqlite.prepare(sql).all(...params) as unknown[];
	} catch {
		return [];
	}
}

export function exportCompanyProjects(companyId: string): unknown[] {
	return safeAll(
		`SELECT * FROM board_projects WHERE company_id = ?`,
		companyId,
	);
}

export function exportCompanyIssues(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM board_issues WHERE company_id = ?`, companyId);
}

export function exportCompanyGoals(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM goals WHERE company_id = ?`, companyId);
}

export function exportCompanyRoutines(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM routines WHERE company_id = ?`, companyId);
}

export function exportCompanyWiki(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM wiki_entries WHERE company_id = ?`, companyId);
}

export function exportCompanySkills(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM skills WHERE company_id = ?`, companyId);
}

export function exportCompanyIntegrations(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM integrations WHERE company_id = ?`, companyId);
}

export function exportCompanyApprovals(companyId: string): unknown[] {
	return safeAll(`SELECT * FROM approvals WHERE company_id = ?`, companyId);
}

export function exportCompanyActivityLog(companyId: string): unknown[] {
	return safeAll(
		`SELECT * FROM activity_log
       WHERE company_id = ?
         AND replace(created_at,'T',' ') >= datetime('now','-30 day')
       ORDER BY created_at DESC`,
		companyId,
	);
}

export function exportCompanyRuns(companyId: string): unknown[] {
	return safeAll(
		`SELECT r.* FROM runs r
       LEFT JOIN board_issues i ON i.linked_plot_id = r.plot_id
      WHERE i.company_id = ?
        AND replace(r.updated_at,'T',' ') >= datetime('now','-30 day')`,
		companyId,
	);
}
