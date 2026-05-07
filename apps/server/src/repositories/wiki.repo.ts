/**
 * Wiki repository — Drizzle queries for wiki_entries table.
 */
import { rawSqlite } from "../db/client.js";

export async function listWikiEntries(
	companyId: string | null,
	category?: string,
) {
	const where: string[] = [];
	const params: unknown[] = [];
	if (companyId) {
		where.push("company_id = ?");
		params.push(companyId);
	}
	if (category) {
		where.push("category = ?");
		params.push(category);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
	return rawSqlite
		.prepare(`
      SELECT
        id,
        company_id AS companyId,
        title,
        slug,
        category,
        tags_json AS tags,
        author_slug AS authorSlug,
        content,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM wiki_entries
      ${whereSql}
      ORDER BY created_at ASC
    `)
		.all(...params);
}

export async function getWikiEntryById(id: string, companyId: string) {
	return (
		rawSqlite
			.prepare(`
        SELECT
          id,
          company_id AS companyId,
          title,
          slug,
          category,
          tags_json AS tags,
          author_slug AS authorSlug,
          content,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM wiki_entries
        WHERE id = ? AND company_id = ?
      `)
			.get(id, companyId) ?? null
	);
}

export interface CreateWikiEntryParams {
	companyId: string | null;
	title: string;
	slug: string;
	category: string | null;
	tags: string | null;
	authorSlug: string | null;
	content: string;
}

export async function createWikiEntry(params: CreateWikiEntryParams) {
	return rawSqlite
		.prepare(`
      INSERT INTO wiki_entries (id, company_id, title, slug, category, tags_json, author_slug, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      RETURNING
        id,
        company_id AS companyId,
        title,
        slug,
        category,
        tags_json AS tags,
        author_slug AS authorSlug,
        content,
        created_at AS createdAt,
        updated_at AS updatedAt
    `)
		.get(
			crypto.randomUUID(),
			params.companyId,
			params.title,
			params.slug,
			params.category ?? "General",
			params.tags ?? "[]",
			params.authorSlug ?? "user",
			params.content,
		);
}

export async function updateWikiEntry(
	id: string,
	companyId: string,
	updates: Partial<{
		title: string;
		slug: string;
		category: string;
		tags: string;
		authorSlug: string;
		content: string;
		updatedAt: string;
	}>,
) {
	const sets: string[] = ["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
	const params: unknown[] = [];
	if (updates.title !== undefined) {
		sets.push("title = ?");
		params.push(updates.title);
	}
	if (updates.slug !== undefined) {
		sets.push("slug = ?");
		params.push(updates.slug);
	}
	if (updates.category !== undefined) {
		sets.push("category = ?");
		params.push(updates.category);
	}
	if (updates.tags !== undefined) {
		sets.push("tags_json = ?");
		params.push(updates.tags);
	}
	if (updates.authorSlug !== undefined) {
		sets.push("author_slug = ?");
		params.push(updates.authorSlug);
	}
	if (updates.content !== undefined) {
		sets.push("content = ?");
		params.push(updates.content);
	}
	params.push(id, companyId);
	return (
		rawSqlite
			.prepare(`
        UPDATE wiki_entries
        SET ${sets.join(", ")}
        WHERE id = ? AND company_id = ?
        RETURNING
          id,
          company_id AS companyId,
          title,
          slug,
          category,
          tags_json AS tags,
          author_slug AS authorSlug,
          content,
          created_at AS createdAt,
          updated_at AS updatedAt
      `)
			.get(...params) ?? null
	);
}

export async function deleteWikiEntry(id: string, companyId: string) {
	return (
		rawSqlite
			.prepare(
				`DELETE FROM wiki_entries WHERE id = ? AND company_id = ? RETURNING id`,
			)
			.get(id, companyId) ?? null
	);
}
