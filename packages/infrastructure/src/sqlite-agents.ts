import type { AgentServiceRepository } from "@setra/application";
import { getRawDb } from "@setra/db";
import type { AgentRecord, TenantScope } from "@setra/domain";

function mapRow(row: Record<string, unknown> | undefined): AgentRecord | null {
	if (!row) return null;
	return {
		id: String(row["id"]),
		slug: String(row["slug"]),
		companyId: (row["companyId"] as string | null | undefined) ?? null,
		modelId: (row["modelId"] as string | null | undefined) ?? null,
		adapterType: (row["adapterType"] as string | null | undefined) ?? null,
		isActive: Boolean(row["isActive"]),
		status: row["status"] as AgentRecord["status"],
		pausedReason: (row["pausedReason"] as string | null | undefined) ?? null,
	};
}

export class SqliteAgentsRepository implements AgentServiceRepository {
	async findById(
		scope: TenantScope,
		agentId: string,
	): Promise<AgentRecord | null> {
		const row = getRawDb()
			.prepare(`
      SELECT id, slug, company_id AS companyId, model_id AS modelId,
             adapter_type AS adapterType, is_active AS isActive,
             status, paused_reason AS pausedReason
        FROM agent_roster
       WHERE id = ? AND company_id = ?
       LIMIT 1
    `)
			.get(agentId, scope.companyId) as Record<string, unknown> | undefined;
		return mapRow(row);
	}

	async findBySlug(
		scope: TenantScope,
		slug: string,
	): Promise<AgentRecord | null> {
		const row = getRawDb()
			.prepare(`
      SELECT id, slug, company_id AS companyId, model_id AS modelId,
             adapter_type AS adapterType, is_active AS isActive,
             status, paused_reason AS pausedReason
        FROM agent_roster
       WHERE slug = ? AND company_id = ?
       LIMIT 1
    `)
			.get(slug, scope.companyId) as Record<string, unknown> | undefined;
		return mapRow(row);
	}
}
