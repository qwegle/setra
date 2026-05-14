/**
 * Lightweight Supabase REST helper for the internet company directory.
 *
 * Why not @supabase/supabase-js? The directory only needs anonymous reads
 * (and, behind RLS, a server-mediated insert when a company opts in). A
 * single fetch call keeps the bundle slim and avoids a runtime dep we
 * would otherwise carry only for two endpoints.
 *
 * The `companies_directory` table is expected to have the shape:
 *   id          uuid  PK  (matches local Setra company id)
 *   name        text
 *   slug        text  unique
 *   region      text  nullable
 *   owner_email text
 *   public      bool  default true
 *   created_at  timestamptz default now()
 * with RLS allowing `select` for anon on rows where public = true.
 */

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_KEY = (
	import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""
).trim();

export function supabaseEnabled(): boolean {
	return SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;
}

export interface CloudCompany {
	id: string;
	name: string;
	region: string | null;
	owner_email?: string;
}

export async function searchCloudCompanies(
	query: string,
): Promise<CloudCompany[]> {
	if (!supabaseEnabled()) return [];
	const url = new URL(`${SUPABASE_URL}/rest/v1/companies_directory`);
	url.searchParams.set("select", "id,name,region,owner_email");
	url.searchParams.set("public", "eq.true");
	if (query.length > 0) {
		// Postgres ilike — `%foo%`
		url.searchParams.set("name", `ilike.*${query}*`);
	}
	url.searchParams.set("limit", "20");
	const res = await fetch(url.toString(), {
		headers: {
			apikey: SUPABASE_KEY,
			Authorization: `Bearer ${SUPABASE_KEY}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`Supabase directory search failed: ${res.status} ${body}`);
	}
	return (await res.json()) as CloudCompany[];
}

export async function publishCloudCompany(input: {
	id: string;
	name: string;
	region?: string | null;
	owner_email: string;
}): Promise<void> {
	if (!supabaseEnabled()) {
		throw new Error("Supabase is not configured");
	}
	const url = `${SUPABASE_URL}/rest/v1/companies_directory`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			apikey: SUPABASE_KEY,
			Authorization: `Bearer ${SUPABASE_KEY}`,
			"Content-Type": "application/json",
			Prefer: "resolution=merge-duplicates",
		},
		body: JSON.stringify({ ...input, public: true }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`Supabase directory publish failed: ${res.status} ${body}`);
	}
}
