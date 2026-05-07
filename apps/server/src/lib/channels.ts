/**
 * channels.ts — server-side helpers for managing per-project team channels.
 *
 * Channels live in `team_channels` (one row per channel) and are referenced
 * by slug in `team_messages.channel`. The general channel for a company has
 * kind='general' and slug='general'; project channels have kind='project' and
 * slug=`proj-${projectSlug}`. DM channels are managed elsewhere.
 */

import { getRawDb } from "@setra/db";
import { kebab } from "@setra/git";

export interface ChannelRow {
	id: string;
	companyId: string | null;
	projectId: string | null;
	slug: string;
	name: string;
	kind: string;
	createdAt: string;
}

export function projectChannelSlug(projectName: string): string {
	return `proj-${kebab(projectName)}`;
}

export function getGeneralChannel(companyId: string): ChannelRow | null {
	const raw = getRawDb();
	return (
		(raw
			.prepare(
				`SELECT id, company_id AS companyId, project_id AS projectId,
              slug, name, kind, created_at AS createdAt
         FROM team_channels
        WHERE company_id = ? AND slug = 'general'
        LIMIT 1`,
			)
			.get(companyId) as ChannelRow | undefined) ?? null
	);
}

export function ensureGeneralChannel(companyId: string): ChannelRow {
	const existing = getGeneralChannel(companyId);
	if (existing) return existing;
	const id = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT OR IGNORE INTO team_channels (id, company_id, project_id, slug, name, kind)
     VALUES (?, ?, NULL, 'general', 'general', 'general')`,
		)
		.run(id, companyId);
	return getGeneralChannel(companyId)!;
}

export function getProjectChannel(projectId: string): ChannelRow | null {
	const raw = getRawDb();
	return (
		(raw
			.prepare(
				`SELECT id, company_id AS companyId, project_id AS projectId,
              slug, name, kind, created_at AS createdAt
         FROM team_channels
        WHERE project_id = ?
        LIMIT 1`,
			)
			.get(projectId) as ChannelRow | undefined) ?? null
	);
}

export function ensureProjectChannel(
	companyId: string,
	projectId: string,
	projectName: string,
): ChannelRow {
	const existing = getProjectChannel(projectId);
	if (existing) return existing;
	const slug = projectChannelSlug(projectName);
	const id = crypto.randomUUID();
	try {
		getRawDb()
			.prepare(
				`INSERT INTO team_channels (id, company_id, project_id, slug, name, kind)
       VALUES (?, ?, ?, ?, ?, 'project')`,
			)
			.run(id, companyId, projectId, slug, projectName);
	} catch {
		// Slug collision (e.g., two projects with similar names). Suffix with id.
		const altSlug = `${slug}-${projectId.slice(0, 6)}`;
		getRawDb()
			.prepare(
				`INSERT INTO team_channels (id, company_id, project_id, slug, name, kind)
       VALUES (?, ?, ?, ?, ?, 'project')`,
			)
			.run(id, companyId, projectId, altSlug, projectName);
	}
	return getProjectChannel(projectId)!;
}

export function renameProjectChannel(
	projectId: string,
	newProjectName: string,
): void {
	const ch = getProjectChannel(projectId);
	if (!ch) return;
	const newSlug = projectChannelSlug(newProjectName);
	// Move existing messages to the new slug too — we key on slug in
	// team_messages so the rename has to follow.
	const raw = getRawDb();
	const oldSlug = ch.slug;
	try {
		raw
			.prepare(`UPDATE team_channels SET slug = ?, name = ? WHERE id = ?`)
			.run(newSlug, newProjectName, ch.id);
		raw
			.prepare(
				`UPDATE team_messages SET channel = ? WHERE channel = ? AND company_id = ?`,
			)
			.run(newSlug, oldSlug, ch.companyId);
	} catch {
		// unique-index collision — keep the old slug, just rename display name
		raw
			.prepare(`UPDATE team_channels SET name = ? WHERE id = ?`)
			.run(newProjectName, ch.id);
	}
}
