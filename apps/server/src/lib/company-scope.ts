/**
 * company-scope.ts — typed accessor for the active company id.
 *
 * The actual enforcement lives in `middleware/require-company.ts`, which
 * validates the `x-company-id` header and stuffs the id into the Hono
 * context. Route handlers reach for it via `getCompanyId(c)` and treat the
 * absence of a value as a bug — it is impossible to land here without the
 * middleware having already run.
 */

import type { Context } from "hono";

export function getCompanyId(c: Context): string {
	const cid = c.get("companyId") as string | undefined;
	if (!cid) {
		throw new Error(
			"getCompanyId() called outside a company-scoped route. " +
				"Mount the route under requireCompany middleware.",
		);
	}
	return cid;
}

/**
 * Soft variant for the few places that need to *optionally* read the
 * company id (e.g. SSE handlers, onboarding endpoints). Returns null when
 * the middleware did not run; never falls back to "first company".
 */
export function tryGetCompanyId(c: Context): string | null {
	return (c.get("companyId") as string | undefined) ?? null;
}
