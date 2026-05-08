import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type ConversationMessage,
	MemoryCompressor,
} from "@setra/agent-runner";
import { getRawDb } from "@setra/db";
import { MemoryStore } from "@setra/memory";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	ensureProjectAgentsInfrastructure,
	getScopedAgentOrThrow,
	getScopedProjectOrThrow,
	listProjectAgentIds,
	listProjectAgents,
} from "../lib/project-agents.js";

export const agentContextRoute = new Hono();

function getMemoryDbPath(companyId: string): string {
	const dataDir = process.env.SETRA_DATA_DIR ?? join(homedir(), ".setra");
	return join(dataDir, "memory", `${companyId}.db`);
}

function openMemoryDb(companyId: string): Database.Database | null {
	const dbPath = getMemoryDbPath(companyId);
	if (!existsSync(dbPath)) return null;
	return new Database(dbPath);
}

function excerpt(text: string, max = 180): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildSummary(
	messages: ConversationMessage[],
	doneIssues: Array<{ slug: string; title: string }>,
): string {
	const highlights = messages
		.slice(0, 6)
		.map((message) => `- ${excerpt(message.content)}`)
		.join("\n");
	const issueLine =
		doneIssues.length > 0
			? doneIssues
					.slice(0, 5)
					.map((issue) => issue.slug)
					.join(", ")
			: "older completed work";
	return [
		`Compacted context for ${messages.length} older entries related to ${issueLine}.`,
		"Key context:",
		highlights || "- No additional details retained.",
	].join("\n");
}

function matchesDoneIssue(
	content: string,
	doneIssues: Array<{ slug: string; title: string }>,
): boolean {
	const lowered = content.toLowerCase();
	return doneIssues.some(
		(issue) =>
			lowered.includes(issue.slug.toLowerCase()) ||
			lowered.includes(issue.title.toLowerCase()),
	);
}

async function refreshAgentProjectContext(input: {
	companyId: string;
	projectId: string;
	agentRosterId: string;
	agentSlug: string;
}): Promise<{ pruned: number; remaining: number; summary: string }> {
	const doneIssues = getRawDb()
		.prepare(
			`SELECT slug, title
			   FROM board_issues
			  WHERE company_id = ?
			    AND project_id = ?
			    AND status IN ('done', 'cancelled')`,
		)
		.all(input.companyId, input.projectId) as Array<{
		slug: string;
		title: string;
	}>;
	const traceRows = getRawDb()
		.prepare(
			`SELECT
				t.id,
				t.content,
				t.created_at AS createdAt,
				COALESCE(i.status, '') AS issueStatus,
				COALESCE(i.slug, '') AS issueSlug,
				COALESCE(i.title, '') AS issueTitle
			 FROM traces t
			 LEFT JOIN runs r ON r.id = t.run_id
			 LEFT JOIN board_issues i ON i.linked_plot_id = r.plot_id
			WHERE t.project_id = ?
			  AND (r.agent = ? OR t.run_id IS NULL)
			ORDER BY t.created_at DESC
			LIMIT 40`,
		)
		.all(input.projectId, input.agentSlug) as Array<{
		id: string;
		content: string;
		createdAt: string;
		issueStatus: string;
		issueSlug: string;
		issueTitle: string;
	}>;
	const prunableTraces = traceRows
		.filter((row, index) => {
			if (index >= 12) return true;
			if (row.issueStatus === "done" || row.issueStatus === "cancelled")
				return true;
			return matchesDoneIssue(row.content, doneIssues);
		})
		.slice(0, 20);

	const memoryDb = openMemoryDb(input.companyId);
	const memoryRows = memoryDb
		? (memoryDb
				.prepare(
					`SELECT id, content, created_at AS createdAt
					   FROM memories
					  WHERE agent_id = ? AND plot_id = ?
					  ORDER BY created_at DESC
					  LIMIT 40`,
				)
				.all(input.agentRosterId, input.projectId) as Array<{
				id: string;
				content: string;
				createdAt: number;
			}>)
		: [];
	const prunableMemories = memoryRows
		.filter(
			(row, index) => index >= 8 || matchesDoneIssue(row.content, doneIssues),
		)
		.slice(0, 20);

	if (prunableTraces.length === 0 && prunableMemories.length === 0) {
		getRawDb()
			.prepare(
				`UPDATE agent_roster
				    SET last_refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
				  WHERE id = ? AND (company_id = ? OR company_id IS NULL)`,
			)
			.run(input.agentRosterId, input.companyId);
		memoryDb?.close();
		return {
			pruned: 0,
			remaining: traceRows.length + memoryRows.length,
			summary: "No stale context was eligible for pruning.",
		};
	}

	const compressor = new MemoryCompressor({
		keepRecentMessages: 0,
		maxTokens: 1,
	});
	for (const row of [...prunableTraces, ...prunableMemories]) {
		compressor.addMessage({
			role: "assistant",
			content: row.content,
			timestamp: new Date().toISOString(),
		});
	}
	const compressed = await compressor.compress(async (messages) =>
		buildSummary(messages, doneIssues),
	);
	const summary = compressed.summary;
	const hash = createHash("sha256").update(summary).digest("hex");
	getRawDb()
		.prepare(
			`INSERT OR IGNORE INTO traces (
				id, run_id, project_id, content, content_hash, source_type, is_synthetic, created_at
			 ) VALUES (?, NULL, ?, ?, ?, 'synthetic', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
		)
		.run(
			crypto.randomUUID(),
			input.projectId,
			`[COMPRESSED CONTEXT]\n${summary}`,
			hash,
		);
	if (prunableTraces.length > 0) {
		const placeholders = prunableTraces.map(() => "?").join(", ");
		getRawDb()
			.prepare(`DELETE FROM traces WHERE id IN (${placeholders})`)
			.run(...prunableTraces.map((row) => row.id));
	}
	if (memoryDb && prunableMemories.length > 0) {
		const deleteStmt = memoryDb.prepare(`DELETE FROM memories WHERE id = ?`);
		const tx = memoryDb.transaction((ids: string[]) => {
			for (const id of ids) deleteStmt.run(id);
		});
		tx(prunableMemories.map((row) => row.id));
		const store = new MemoryStore({ dbPath: getMemoryDbPath(input.companyId) });
		await store.init();
		await store.add(
			summary,
			{
				key: `context-refresh:${input.agentSlug}`,
				tags: [
					"context-refresh",
					input.agentSlug,
					`project:${input.projectId}`,
				],
				source: "agent-context-route",
			},
			{
				plotId: input.projectId,
				agentId: input.agentRosterId,
			},
		);
	}
	getRawDb()
		.prepare(
			`UPDATE agent_roster
			    SET last_refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			  WHERE id = ? AND (company_id = ? OR company_id IS NULL)`,
		)
		.run(input.agentRosterId, input.companyId);
	memoryDb?.close();
	const remainingTraceRow = getRawDb()
		.prepare(`SELECT COUNT(*) AS count FROM traces WHERE project_id = ?`)
		.get(input.projectId) as { count: number };
	const remainingMemoryRow = memoryDb ? { count: 0 } : { count: 0 };
	const reopenedMemoryDb = openMemoryDb(input.companyId);
	const currentMemoryCount = reopenedMemoryDb
		? (
				reopenedMemoryDb
					.prepare(
						`SELECT COUNT(*) AS count FROM memories WHERE agent_id = ? AND plot_id = ?`,
					)
					.get(input.agentRosterId, input.projectId) as { count: number }
			).count
		: remainingMemoryRow.count;
	reopenedMemoryDb?.close();
	return {
		pruned: prunableTraces.length + prunableMemories.length,
		remaining: (remainingTraceRow.count ?? 0) + currentMemoryCount,
		summary,
	};
}

agentContextRoute.post("/agents/roster/:id/refresh-context", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const agentRosterId = c.req.param("id");
		const agent = getScopedAgentOrThrow(agentRosterId, companyId);
		ensureProjectAgentsInfrastructure();
		const projectIds = (
			getRawDb()
				.prepare(
					`SELECT pa.project_id AS projectId
					   FROM project_agents pa
					   JOIN board_projects bp ON bp.id = pa.project_id
					  WHERE pa.agent_roster_id = ?
					    AND (bp.company_id = ? OR bp.company_id IS NULL)
					  ORDER BY pa.assigned_at ASC`,
				)
				.all(agentRosterId, companyId) as Array<{ projectId: string }>
		).map((row) => row.projectId);
		const results = [] as Array<{
			projectId: string;
			pruned: number;
			remaining: number;
			summary: string;
		}>;
		for (const projectId of projectIds) {
			results.push({
				projectId,
				...(await refreshAgentProjectContext({
					companyId,
					projectId,
					agentRosterId,
					agentSlug: agent.slug,
				})),
			});
		}
		const response = {
			pruned: results.reduce((sum, result) => sum + result.pruned, 0),
			remaining: results.reduce((sum, result) => sum + result.remaining, 0),
			summary:
				results.length > 0
					? `Refreshed ${results.length} project context${results.length === 1 ? "" : "s"} for ${agent.displayName}.`
					: `No project assignments found for ${agent.displayName}.`,
			projects: results,
		};
		await logActivity(
			c,
			"agent.context.refreshed",
			"agent_roster",
			agentRosterId,
			response,
		);
		return c.json(response);
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "failed to refresh agent context";
		const status =
			message === "agent not found" || message === "project not found"
				? 404
				: 500;
		return c.json({ error: message }, status);
	}
});

agentContextRoute.post("/projects/:projectId/refresh-context", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		getScopedProjectOrThrow(projectId, companyId);
		const assignedAgentIds = listProjectAgentIds(projectId, companyId);
		const assignedAgents = listProjectAgents(projectId, companyId);
		const results = [] as Array<{
			agentRosterId: string;
			slug: string;
			pruned: number;
			remaining: number;
			summary: string;
		}>;
		for (const agentId of assignedAgentIds) {
			const assignment = assignedAgents.find(
				(entry) => entry.agentRosterId === agentId,
			);
			if (!assignment) continue;
			results.push({
				agentRosterId: agentId,
				slug: assignment.slug,
				...(await refreshAgentProjectContext({
					companyId,
					projectId,
					agentRosterId: agentId,
					agentSlug: assignment.slug,
				})),
			});
		}
		const response = {
			pruned: results.reduce((sum, result) => sum + result.pruned, 0),
			remaining: results.reduce((sum, result) => sum + result.remaining, 0),
			summary: `Refreshed context for ${results.length} assigned agent${results.length === 1 ? "" : "s"}.`,
			agents: results,
		};
		await logActivity(
			c,
			"project.context.refreshed",
			"project",
			projectId,
			response,
		);
		return c.json(response);
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "failed to refresh project context";
		const status =
			message === "agent not found" || message === "project not found"
				? 404
				: 500;
		return c.json({ error: message }, status);
	}
});

export default agentContextRoute;
