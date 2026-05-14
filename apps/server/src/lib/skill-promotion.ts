/**
 * Skill promotion — closes the agent learning loop.
 *
 * Successful agent runs produce reflections. Reflections that meet quality
 * thresholds (success outcome, non-trivial cost, real duration) are promoted
 * into reusable `skills` rows scoped to the company. The prompt-builder
 * surfaces the top promoted skills under "## Learned skills" so future runs
 * benefit from prior wins.
 *
 * Idempotent: re-promoting the same (companyId, tag) tuple increments
 * usage_count instead of inserting a duplicate row.
 */
import { randomUUID } from "node:crypto";
import { rawSqlite } from "../db/client.js";
import { createLogger } from "./logger.js";

const log = createLogger("skill-promotion");

export interface PromotionInput {
	runId: string;
	agentSlug: string;
	companyId: string;
	outcome: "success" | "partial" | "failed";
	issueTitle?: string | undefined;
	skillTags: string[];
	lessonsLearned: string;
	costUsd: number;
	durationMs: number;
}

export interface PromotedSkillRow {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	prompt: string | null;
	usage_count: number;
	source_agent_slug: string | null;
	lessons_learned: string | null;
}

/**
 * Thresholds for promoting a reflection into a reusable skill. Tuned to avoid
 * promoting trivial/no-op runs while still allowing fast learning on real work.
 */
const MIN_DURATION_MS = 5_000;
const MIN_COST_USD = 0.0005;

function slugifyTag(tag: string): string {
	return tag
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "")
		.slice(0, 40);
}

function buildLearnedSkillSlug(tag: string): string {
	return `learned-${slugifyTag(tag) || "general"}`;
}

function buildLearnedSkillName(tag: string): string {
	const cleaned = tag.replace(/[-_]+/g, " ").trim();
	const titled = cleaned ? cleaned[0]!.toUpperCase() + cleaned.slice(1) : "General";
	return `Learned: ${titled}`;
}

function meetsPromotionThreshold(input: PromotionInput): boolean {
	if (input.outcome !== "success") return false;
	if (input.durationMs < MIN_DURATION_MS) return false;
	if (input.costUsd < MIN_COST_USD) return false;
	if (input.skillTags.length === 0) return false;
	return true;
}

/**
 * Promote a successful reflection to one or more learned skill rows (one per
 * skill tag). Best-effort: failures are logged but do not throw, because this
 * runs in the post-run hot path.
 *
 * Returns the slugs of the skills that were inserted or incremented, for
 * observability and tests.
 */
export function promoteReflectionToSkill(input: PromotionInput): string[] {
	if (!meetsPromotionThreshold(input)) return [];

	const issueTitle = (input.issueTitle ?? "").trim();
	const description = issueTitle
		? `Learned from run on "${issueTitle}".`
		: "Learned from a successful run.";
	const prompt = input.lessonsLearned?.trim().length
		? input.lessonsLearned.trim()
		: "Apply the proven approach from prior runs in this skill area.";

	const touched: string[] = [];
	const tx = rawSqlite.transaction((tags: string[]) => {
		for (const tag of tags) {
			const slug = buildLearnedSkillSlug(tag);
			const name = buildLearnedSkillName(tag);
			try {
				const existing = rawSqlite
					.prepare(
						`SELECT id FROM skills WHERE company_id = ? AND slug = ? LIMIT 1`,
					)
					.get(input.companyId, slug) as { id: string } | undefined;

				if (existing) {
					rawSqlite
						.prepare(
							`UPDATE skills
							 SET usage_count = usage_count + 1,
							     last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
							     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
							     source_run_id = ?,
							     source_agent_slug = ?,
							     lessons_learned = ?
							 WHERE id = ?`,
						)
						.run(input.runId, input.agentSlug, prompt, existing.id);
				} else {
					rawSqlite
						.prepare(
							`INSERT INTO skills
								(id, company_id, name, slug, description, category, trigger,
								 prompt, is_active, usage_count, last_used_at, is_learned,
								 source_run_id, source_agent_slug, lessons_learned,
								 created_at, updated_at)
							 VALUES (?, ?, ?, ?, ?, 'custom', '', ?, 1, 1,
								strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1,
								?, ?, ?,
								strftime('%Y-%m-%dT%H:%M:%fZ','now'),
								strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
						)
						.run(
							randomUUID(),
							input.companyId,
							name,
							slug,
							description,
							prompt,
							input.runId,
							input.agentSlug,
							prompt,
						);
				}
				touched.push(slug);
			} catch (error) {
				log.warn("promote skill tag failed", {
					tag,
					slug,
					companyId: input.companyId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	});

	try {
		tx(input.skillTags);
	} catch (error) {
		log.warn("promotion transaction failed", {
			runId: input.runId,
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
	if (touched.length > 0) {
		log.info("promoted reflection to learned skills", {
			runId: input.runId,
			agentSlug: input.agentSlug,
			companyId: input.companyId,
			slugs: touched,
		});
	}
	return touched;
}

/**
 * Return the top-K learned skills for a company, ordered by usage_count then
 * recency. Used by prompt-builder to render the "## Learned skills" section.
 */
export function listTopLearnedSkills(
	companyId: string,
	limit = 5,
): PromotedSkillRow[] {
	try {
		return rawSqlite
			.prepare(
				`SELECT id, name, slug, description, prompt, usage_count,
				        source_agent_slug, lessons_learned
				 FROM skills
				 WHERE company_id = ? AND is_learned = 1 AND is_active = 1
				 ORDER BY usage_count DESC, last_used_at DESC
				 LIMIT ?`,
			)
			.all(companyId, limit) as PromotedSkillRow[];
	} catch (error) {
		log.warn("listTopLearnedSkills failed", {
			companyId,
			error: error instanceof Error ? error.message : String(error),
		});
		return [];
	}
}
