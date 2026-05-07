import type { AgentRecord, TenantScope } from "@setra/domain";

export interface AgentServiceRepository {
	findById(scope: TenantScope, agentId: string): Promise<AgentRecord | null>;
	findBySlug(scope: TenantScope, slug: string): Promise<AgentRecord | null>;
}

export class AgentsService {
	constructor(private readonly repository: AgentServiceRepository) {}

	async resolveScopedAgent(
		scope: TenantScope,
		agentRef: string,
	): Promise<{ agent: AgentRecord | null; agentSlug: string }> {
		const byId = await this.repository.findById(scope, agentRef);
		if (byId) return { agent: byId, agentSlug: byId.slug };

		const bySlug = await this.repository.findBySlug(scope, agentRef);
		if (bySlug) return { agent: bySlug, agentSlug: bySlug.slug };

		return { agent: null, agentSlug: agentRef };
	}
}
