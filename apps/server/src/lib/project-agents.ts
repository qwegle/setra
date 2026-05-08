import { getRawDb } from "@setra/db";
import { rawSqlite } from "../db/client.js";
import * as projectsRepo from "../repositories/projects.repo.js";

export interface ProjectAgentAssignmentRow {
	id: string;
	projectId: string;
	agentRosterId: string;
	role: string;
	assignedBy: string | null;
	assignedAt: string;
	agentId: string;
	slug: string;
	displayName: string;
	agentRole: string;
	status: string;
	adapterType: string | null;
	modelId: string | null;
	isActive: number;
	lastRefreshedAt: string | null;
}

export interface LeadershipAgentRow {
	id: string;
	slug: string;
	displayName: string;
}

let infrastructureReady = false;

export function ensureProjectAgentsInfrastructure(): void {
	if (infrastructureReady) return;
	rawSqlite.exec(`
		CREATE TABLE IF NOT EXISTS project_agents (
			id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
			project_id TEXT NOT NULL REFERENCES board_projects(id) ON DELETE CASCADE,
			agent_roster_id TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'member',
			assigned_by TEXT DEFAULT 'system',
			assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_project_agents_unique
			ON project_agents(project_id, agent_roster_id);
		CREATE INDEX IF NOT EXISTS idx_project_agents_project
			ON project_agents(project_id);
		CREATE INDEX IF NOT EXISTS idx_project_agents_agent
			ON project_agents(agent_roster_id);
	`);
	try {
		rawSqlite.exec(
			`ALTER TABLE agent_roster ADD COLUMN last_refreshed_at TEXT`,
		);
	} catch {
		/* already migrated */
	}
	infrastructureReady = true;
}

export function getScopedProjectOrThrow(projectId: string, companyId: string) {
	ensureProjectAgentsInfrastructure();
	const project = projectsRepo.getProjectFull(projectId);
	if (!project || (project.companyId && project.companyId !== companyId)) {
		throw new Error("project not found");
	}
	return project;
}

export function getScopedAgentOrThrow(
	agentRosterId: string,
	companyId: string,
) {
	ensureProjectAgentsInfrastructure();
	const agent = getRawDb()
		.prepare(
			`SELECT id, slug, display_name AS displayName, status
			   FROM agent_roster
			  WHERE id = ?
			    AND (company_id = ? OR company_id IS NULL)
			  LIMIT 1`,
		)
		.get(agentRosterId, companyId) as
		| {
				id: string;
				slug: string;
				displayName: string;
				status: string;
		  }
		| undefined;
	if (!agent) throw new Error("agent not found");
	return agent;
}

export function listProjectAgents(
	projectId: string,
	companyId: string,
): ProjectAgentAssignmentRow[] {
	ensureProjectAgentsInfrastructure();
	getScopedProjectOrThrow(projectId, companyId);
	return getRawDb()
		.prepare(
			`SELECT
				pa.id,
				pa.project_id AS projectId,
				pa.agent_roster_id AS agentRosterId,
				pa.role,
				pa.assigned_by AS assignedBy,
				pa.assigned_at AS assignedAt,
				ar.id AS agentId,
				ar.slug,
				ar.display_name AS displayName,
				COALESCE(t.agent, ar.slug) AS agentRole,
				ar.status,
				ar.adapter_type AS adapterType,
				ar.model_id AS modelId,
				ar.is_active AS isActive,
				ar.last_refreshed_at AS lastRefreshedAt
			 FROM project_agents pa
			 JOIN agent_roster ar ON ar.id = pa.agent_roster_id
			 LEFT JOIN agent_templates t ON t.id = ar.template_id
			WHERE pa.project_id = ?
			  AND (ar.company_id = ? OR ar.company_id IS NULL)
			ORDER BY CASE pa.role WHEN 'lead' THEN 0 WHEN 'owner' THEN 1 ELSE 2 END,
			         ar.display_name COLLATE NOCASE ASC`,
		)
		.all(projectId, companyId) as ProjectAgentAssignmentRow[];
}

export function getLeadershipAgents(companyId: string): LeadershipAgentRow[] {
	ensureProjectAgentsInfrastructure();
	return getRawDb()
		.prepare(
			`SELECT id, slug, display_name AS displayName
			   FROM agent_roster
			  WHERE (company_id = ? OR company_id IS NULL)
			    AND is_active = 1
			    AND (
					lower(slug) IN ('ceo', 'cto')
					OR lower(display_name) IN ('ceo', 'cto')
					OR lower(display_name) LIKE '%chief executive officer%'
					OR lower(display_name) LIKE '%chief technology officer%'
				)
			  ORDER BY CASE
				WHEN lower(slug) = 'ceo' OR lower(display_name) = 'ceo' THEN 0
				WHEN lower(slug) = 'cto' OR lower(display_name) = 'cto' THEN 1
				ELSE 2
			  END,
			  created_at ASC`,
		)
		.all(companyId) as LeadershipAgentRow[];
}

export function isLeadershipAgent(input: {
	slug?: string | null;
	displayName?: string | null;
}): boolean {
	const slug = input.slug?.trim().toLowerCase() ?? "";
	const displayName = input.displayName?.trim().toLowerCase() ?? "";
	return (
		slug === "ceo" ||
		slug === "cto" ||
		displayName === "ceo" ||
		displayName === "cto" ||
		displayName.includes("chief executive officer") ||
		displayName.includes("chief technology officer")
	);
}

export function autoAssignLeadershipAgents(
	projectId: string,
	companyId: string,
): LeadershipAgentRow[] {
	ensureProjectAgentsInfrastructure();
	getScopedProjectOrThrow(projectId, companyId);
	const leaders = getLeadershipAgents(companyId);
	const insert = getRawDb().prepare(
		`INSERT OR IGNORE INTO project_agents (
			id, project_id, agent_roster_id, role, assigned_by
		 ) VALUES (lower(hex(randomblob(16))), ?, ?, 'lead', 'system')`,
	);
	const tx = getRawDb().transaction((rows: LeadershipAgentRow[]) => {
		for (const leader of rows) {
			insert.run(projectId, leader.id);
		}
	});
	tx(leaders);
	return leaders;
}

export function assignAgentToProject(input: {
	projectId: string;
	companyId: string;
	agentRosterId: string;
	role?: string;
	assignedBy?: string;
}): void {
	ensureProjectAgentsInfrastructure();
	getScopedProjectOrThrow(input.projectId, input.companyId);
	getScopedAgentOrThrow(input.agentRosterId, input.companyId);
	getRawDb()
		.prepare(
			`INSERT OR IGNORE INTO project_agents (
				id, project_id, agent_roster_id, role, assigned_by
			 ) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?)`,
		)
		.run(
			input.projectId,
			input.agentRosterId,
			input.role?.trim() || "member",
			input.assignedBy?.trim() || "user",
		);
}

export function unassignAgentFromProject(input: {
	projectId: string;
	companyId: string;
	agentRosterId: string;
}): number {
	ensureProjectAgentsInfrastructure();
	getScopedProjectOrThrow(input.projectId, input.companyId);
	getScopedAgentOrThrow(input.agentRosterId, input.companyId);
	const result = getRawDb()
		.prepare(
			`DELETE FROM project_agents
			  WHERE project_id = ? AND agent_roster_id = ?`,
		)
		.run(input.projectId, input.agentRosterId);
	return result.changes ?? 0;
}

export function listProjectAgentIds(
	projectId: string,
	companyId: string,
): string[] {
	ensureProjectAgentsInfrastructure();
	getScopedProjectOrThrow(projectId, companyId);
	return (
		getRawDb()
			.prepare(
				`SELECT pa.agent_roster_id AS agentRosterId
				   FROM project_agents pa
				   JOIN agent_roster ar ON ar.id = pa.agent_roster_id
				  WHERE pa.project_id = ?
				    AND (ar.company_id = ? OR ar.company_id IS NULL)
				  ORDER BY pa.assigned_at ASC`,
			)
			.all(projectId, companyId) as Array<{ agentRosterId: string }>
	).map((row) => row.agentRosterId);
}
