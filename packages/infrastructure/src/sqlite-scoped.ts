import type { TenantScope } from "@setra/domain";
import { createTenantScope } from "@setra/domain";

export function requireTenantScope(companyId: string): TenantScope {
	return createTenantScope(companyId);
}
