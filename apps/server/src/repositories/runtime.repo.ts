/**
 * Runtime repository — raw SQL queries for runtime info.
 */
import { rawSqlite } from "../db/client.js";

export interface CompanyOfflineRow {
	is_offline_only: number;
}

export function isOfflineForCompany(companyId: string | null): boolean {
	if (!companyId) return false;
	try {
		const row = rawSqlite
			.prepare("SELECT is_offline_only FROM companies WHERE id = ?")
			.get(companyId) as CompanyOfflineRow | undefined;
		return row?.is_offline_only === 1;
	} catch {
		return false;
	}
}
