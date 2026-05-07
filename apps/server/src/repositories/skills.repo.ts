import { and, desc, eq, sql } from "drizzle-orm";
/**
 * Skills repository — Drizzle queries for skills table.
 */
import { db } from "../db/client.js";
import { skills } from "../db/schema.js";

export async function listSkills(companyId: string | null) {
	return db
		.select()
		.from(skills)
		.where(companyId ? and(eq(skills.companyId, companyId)) : undefined)
		.orderBy(skills.createdAt);
}

export async function listSkillsPaginated(
	companyId: string | null,
	params: {
		page: number;
		pageSize: number;
		search?: string;
		category?: string;
	},
) {
	const whereParts: any[] = [];
	if (companyId) whereParts.push(eq(skills.companyId, companyId));
	if (params.category && params.category !== "all") {
		whereParts.push(eq(skills.category, params.category));
	}
	const search = params.search?.trim().toLowerCase();
	if (search) {
		const q = `%${search}%`;
		whereParts.push(
			sql`(
				lower(${skills.name}) LIKE ${q}
				OR lower(coalesce(${skills.description}, '')) LIKE ${q}
				OR lower(coalesce(${skills.slug}, '')) LIKE ${q}
			)`,
		);
	}
	const where = whereParts.length > 0 ? and(...whereParts) : undefined;
	const page = Math.max(1, params.page);
	const pageSize = Math.max(1, params.pageSize);
	const offset = (page - 1) * pageSize;

	const [countRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(skills)
		.where(where);

	const items = await db
		.select()
		.from(skills)
		.where(where)
		.orderBy(desc(skills.createdAt))
		.limit(pageSize)
		.offset(offset);

	return {
		items,
		total: countRow?.count ?? 0,
	};
}

export async function listSkillsWithGlobal(companyId: string) {
	return db
		.select()
		.from(skills)
		.where(
			sql`(${skills.companyId} = ${companyId} OR ${skills.companyId} IS NULL)`,
		)
		.orderBy(skills.createdAt);
}

export async function listRecommendedSkills(
	companyId: string,
	role: string,
	limit: number,
) {
	const rows = await listSkillsWithGlobal(companyId);
	const normalizedRole = role.trim().toLowerCase();
	const isDeveloperRole =
		normalizedRole.length === 0 ||
		[
			"dev",
			"developer",
			"engineer",
			"engineering",
			"frontend",
			"backend",
			"fullstack",
			"coder",
		].some((k) => normalizedRole.includes(k));

	const byDeveloperSignal = (row: typeof skills.$inferSelect) => {
		const cat = (row.category ?? "").toLowerCase();
		const text =
			`${row.name ?? ""} ${row.slug ?? ""} ${row.trigger ?? ""} ${row.description ?? ""}`.toLowerCase();
		if (!isDeveloperRole) return true;
		if (cat === "code" || cat === "security" || cat === "data") return true;
		return (
			text.includes("code") ||
			text.includes("debug") ||
			text.includes("test") ||
			text.includes("api") ||
			text.includes("security") ||
			text.includes("database")
		);
	};

	const categoryRank = (category: string | null) => {
		const cat = (category ?? "").toLowerCase();
		if (cat === "code") return 0;
		if (cat === "security") return 1;
		if (cat === "data") return 2;
		if (cat === "web") return 3;
		return 4;
	};

	return rows
		.filter((r) => r.isActive)
		.filter(byDeveloperSignal)
		.sort((a, b) => {
			const usage = (b.usageCount ?? 0) - (a.usageCount ?? 0);
			if (usage !== 0) return usage;
			const cat = categoryRank(a.category) - categoryRank(b.category);
			if (cat !== 0) return cat;
			return a.name.localeCompare(b.name);
		})
		.slice(0, Math.max(1, Math.min(100, limit)));
}

export interface CreateSkillParams {
	companyId: string | null;
	name: string;
	slug: string;
	description: string | null;
	category: string | null;
	trigger: string | null;
	prompt: string | null;
	isActive: boolean;
}

export async function createSkill(params: CreateSkillParams) {
	const [row] = await db
		.insert(skills)
		.values({
			companyId: params.companyId,
			name: params.name,
			slug: params.slug,
			description: params.description,
			category: params.category,
			trigger: params.trigger,
			prompt: params.prompt,
			isActive: params.isActive,
		})
		.returning();
	return row;
}

export async function getSkillById(id: string, companyId: string) {
	const [row] = await db
		.select({ id: skills.id, companyId: skills.companyId })
		.from(skills)
		.where(and(eq(skills.id, id), eq(skills.companyId, companyId)));
	return row ?? null;
}

export async function updateSkill(
	id: string,
	companyId: string,
	updates: Partial<typeof skills.$inferInsert>,
) {
	const [updated] = await db
		.update(skills)
		.set(updates)
		.where(and(eq(skills.id, id), eq(skills.companyId, companyId)))
		.returning();
	return updated;
}

export async function deleteSkill(id: string, companyId: string) {
	const [row] = await db
		.delete(skills)
		.where(and(eq(skills.id, id), eq(skills.companyId, companyId)))
		.returning();
	return row ?? null;
}
