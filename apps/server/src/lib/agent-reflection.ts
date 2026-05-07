import { randomUUID } from "node:crypto";
import { getRawDb } from "@setra/db";
import { publishInsight } from "./gossip.js";

export interface RunOutcome {
	runId: string;
	agentSlug: string;
	companyId: string;
	outcome: "success" | "partial" | "failed";
	issueTitle?: string | undefined;
	costUsd: number;
	durationMs: number;
	errorMessage?: string | undefined;
}

export interface AgentReflectionRecord {
	id: string;
	runId: string;
	outcome: "success" | "partial" | "failed";
	reflection: string;
	lessonsLearned: string;
	skillTags: string[];
	createdAt: string;
}

export interface AgentExperienceSkill {
	name: string;
	total: number;
	success: number;
	failed: number;
	successRate: number;
}

let tableReady = false;

function ensureReflectionsTable() {
	if (tableReady) return;
	getRawDb().exec(`
		CREATE TABLE IF NOT EXISTS agent_reflections (
			id TEXT PRIMARY KEY,
			agent_slug TEXT NOT NULL,
			company_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			outcome TEXT NOT NULL,
			reflection TEXT NOT NULL,
			lessons_learned TEXT DEFAULT '',
			skill_tags TEXT DEFAULT '[]',
			created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
		);
		CREATE INDEX IF NOT EXISTS idx_reflections_agent
			ON agent_reflections(agent_slug, company_id);
	`);
	tableReady = true;
}

function detectSkillTags(issueTitle?: string): string[] {
	const skillTags: string[] = [];
	const title = (issueTitle ?? "").toLowerCase();
	if (title.match(/test|spec|jest|playwright/)) skillTags.push("testing");
	if (title.match(/api|endpoint|route|rest/)) skillTags.push("backend");
	if (title.match(/ui|component|page|css|style|layout/))
		skillTags.push("frontend");
	if (title.match(/bug|fix|error|crash/)) skillTags.push("debugging");
	if (title.match(/deploy|ci|cd|pipeline/)) skillTags.push("devops");
	if (title.match(/refactor|clean|optimize/)) skillTags.push("refactoring");
	if (title.match(/docs|readme|document/)) skillTags.push("documentation");
	if (title.match(/security|auth|permission/)) skillTags.push("security");
	if (title.match(/database|sql|migration|schema/)) skillTags.push("database");
	return skillTags.length > 0 ? skillTags : ["general"];
}

function parseSkillTags(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((tag): tag is string => typeof tag === "string")
			: [];
	} catch {
		return [];
	}
}

export function createRunReflection(outcome: RunOutcome): void {
	try {
		ensureReflectionsTable();
		const id = randomUUID();
		const skillTags = detectSkillTags(outcome.issueTitle);
		const durationSeconds = Math.max(0, Math.round(outcome.durationMs / 1000));

		let reflection = "";
		let lessonsLearned = "";
		if (outcome.outcome === "success") {
			reflection = `Successfully completed "${outcome.issueTitle || "task"}". Cost: $${outcome.costUsd.toFixed(4)}, Duration: ${durationSeconds}s.`;
			lessonsLearned = "Completed task efficiently.";
		} else if (outcome.outcome === "failed") {
			reflection = `Failed on "${outcome.issueTitle || "task"}". Error: ${outcome.errorMessage || "unknown"}.`;
			lessonsLearned = `Encountered failure: ${outcome.errorMessage || "unknown error"}. Should handle this pattern differently next time.`;
		} else {
			reflection = `Partially completed "${outcome.issueTitle || "task"}".`;
			lessonsLearned =
				"Task was partially completed — may need human review or retry.";
		}

		getRawDb()
			.prepare(
				`INSERT INTO agent_reflections (
					id,
					agent_slug,
					company_id,
					run_id,
					outcome,
					reflection,
					lessons_learned,
					skill_tags,
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
			)
			.run(
				id,
				outcome.agentSlug,
				outcome.companyId,
				outcome.runId,
				outcome.outcome,
				reflection,
				lessonsLearned,
				JSON.stringify(skillTags),
			);

		if (outcome.outcome === "failed" && outcome.errorMessage) {
			publishInsight(
				outcome.agentSlug,
				outcome.companyId,
				`Learned from failure: ${outcome.errorMessage}`,
				`While working on: ${outcome.issueTitle || "unknown task"}`,
				skillTags,
			);
		}
	} catch (error) {
		console.warn("[agent-reflection] failed:", error);
	}
}

export function getAgentExperience(agentSlug: string, companyId: string) {
	ensureReflectionsTable();
	const totalReflections =
		(
			getRawDb()
				.prepare(
					"SELECT COUNT(*) as c FROM agent_reflections WHERE agent_slug = ? AND company_id = ?",
				)
				.get(agentSlug, companyId) as { c: number } | undefined
		)?.c ?? 0;

	const reflections = getRawDb()
		.prepare(
			`SELECT id, run_id, outcome, reflection, lessons_learned, skill_tags, created_at
			 FROM agent_reflections
			 WHERE agent_slug = ? AND company_id = ?
			 ORDER BY created_at DESC`,
		)
		.all(agentSlug, companyId) as Array<{
		id: string;
		run_id: string;
		outcome: "success" | "partial" | "failed";
		reflection: string;
		lessons_learned: string;
		skill_tags: string;
		created_at: string;
	}>;

	const skillMap: Record<
		string,
		{ total: number; success: number; failed: number }
	> = {};
	let successCount = 0;
	let failedCount = 0;
	let partialCount = 0;

	for (const reflection of reflections) {
		if (reflection.outcome === "success") successCount += 1;
		else if (reflection.outcome === "failed") failedCount += 1;
		else partialCount += 1;

		for (const tag of parseSkillTags(reflection.skill_tags)) {
			if (!skillMap[tag]) skillMap[tag] = { total: 0, success: 0, failed: 0 };
			skillMap[tag].total += 1;
			if (reflection.outcome === "success") skillMap[tag].success += 1;
			if (reflection.outcome === "failed") skillMap[tag].failed += 1;
		}
	}

	const skills: AgentExperienceSkill[] = Object.entries(skillMap)
		.map(([name, data]) => ({
			name,
			total: data.total,
			success: data.success,
			failed: data.failed,
			successRate:
				data.total > 0 ? Math.round((data.success / data.total) * 100) : 0,
		}))
		.sort((a, b) => b.total - a.total);

	const recentOutcomes = reflections
		.slice(0, 20)
		.map((reflection) => reflection.outcome);
	const trend: number[] = [];
	for (let index = 0; index < recentOutcomes.length; index += 5) {
		const chunk = recentOutcomes.slice(index, index + 5);
		const rate =
			chunk.filter((outcomeValue) => outcomeValue === "success").length /
			chunk.length;
		trend.push(Math.round(rate * 100));
	}

	const recent: AgentReflectionRecord[] = reflections
		.slice(0, 10)
		.map((reflection) => ({
			id: reflection.id,
			runId: reflection.run_id,
			outcome: reflection.outcome,
			reflection: reflection.reflection,
			lessonsLearned: reflection.lessons_learned ?? "",
			skillTags: parseSkillTags(reflection.skill_tags),
			createdAt: reflection.created_at,
		}));

	let level = "Novice";
	if (totalReflections >= 100) level = "Expert";
	else if (totalReflections >= 50) level = "Advanced";
	else if (totalReflections >= 20) level = "Proficient";
	else if (totalReflections >= 5) level = "Intermediate";

	return {
		totalReflections,
		successCount,
		failedCount,
		partialCount,
		skills,
		trend,
		recent,
		level,
	};
}
