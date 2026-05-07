export const AGENT_STATUSES = [
	"awaiting_key",
	"idle",
	"running",
	"paused",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type CompanyId = string & { readonly __brand: "CompanyId" };

export interface TenantScope {
	readonly companyId: CompanyId;
}

export interface ScopedRepository<TEntity, TId = string> {
	getById(
		scope: TenantScope,
		id: TId,
	): Promise<TEntity | null> | TEntity | null;
}

export interface AgentRecord {
	id: string;
	slug: string;
	companyId: string | null;
	modelId: string | null;
	adapterType: string | null;
	isActive: boolean;
	status: AgentStatus;
	pausedReason: string | null;
}

export function asCompanyId(value: string): CompanyId {
	if (!value.trim()) {
		throw new Error("companyId is required");
	}
	return value as CompanyId;
}

export function createTenantScope(companyId: string): TenantScope {
	return { companyId: asCompanyId(companyId) };
}
