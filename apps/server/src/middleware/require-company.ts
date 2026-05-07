/**
 * require-company.ts — multi-tenant scope guard.
 *
 * Enforces that every "scoped" API request carries a valid x-company-id
 * header. The id is validated against the companies table and stuffed into
 * the request context as `companyId`, so route handlers can call
 * `getCompanyId(c)` as a typed accessor — no fallbacks, no implicit
 * defaults, no opportunity for a forgotten header to silently leak data.
 *
 * Mounted via `app.use("/api/<scoped>/*", requireCompany)`. Public routes
 * (companies CRUD, llm catalog, runtime/available-models, global settings,
 * onboarding) stay outside this middleware.
 */

import { getRawDb } from "@setra/db";
import type { MiddlewareHandler } from "hono";

const companyExistsCache = new Map<string, number>(); // id → expiry timestamp
const CACHE_TTL_MS = 5_000;

/** Lightweight cached existence check — companies are tiny and rarely change. */
function companyExists(id: string): boolean {
	const expiry = companyExistsCache.get(id);
	if (expiry !== undefined && expiry > Date.now()) {
		return true;
	}
	const row = getRawDb()
		.prepare(`SELECT 1 FROM companies WHERE id = ? LIMIT 1`)
		.get(id) as { 1: number } | undefined;
	if (row) {
		companyExistsCache.set(id, Date.now() + CACHE_TTL_MS);
		return true;
	}
	return false;
}

export const requireCompany: MiddlewareHandler = async (c, next) => {
	const cid =
		(c.get("companyId") as string | undefined) ??
		c.req.header("x-company-id") ??
		c.req.query("companyId");

	if (!cid) {
		return c.json(
			{ error: "company_required", message: "Missing x-company-id header" },
			400,
		);
	}

	if (!companyExists(cid)) {
		return c.json(
			{ error: "company_not_found", message: `Unknown company: ${cid}` },
			404,
		);
	}

	c.set("companyId", cid);
	await next();
	return;
};
