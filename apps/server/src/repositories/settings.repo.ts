/**
 * settings.repo.ts — Repository for settings-related data access
 */

import { rawSqlite } from "../db/client.js";

// ─── Queries ──────────────────────────────────────────────────────────────────

export function isCompanyOfflineOnly(
	companyId: string | undefined | null,
): boolean {
	if (!companyId) return false;
	try {
		const row = rawSqlite
			.prepare("SELECT is_offline_only FROM companies WHERE id = ?")
			.get(companyId) as { is_offline_only?: number } | undefined;
		return row?.is_offline_only === 1;
	} catch {
		// table missing in tests
		return false;
	}
}
