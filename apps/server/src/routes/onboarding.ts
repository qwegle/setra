/**
 * /api/onboarding — multi-company join flow.
 *
 * A registered user with zero (or many) memberships uses this surface to:
 *   - GET  /me               → list every company the current user belongs to
 *   - POST /create           → create a brand-new company, become its owner
 *   - POST /join             → join an existing company via { mode: "code" | "lan" | "cloud" }
 *   - POST /switch           → re-issue token with a different active companyId
 *   - POST /invite-codes     → (owner/admin) mint a reusable join code for the active company
 *   - GET  /invite-codes     → (owner/admin) list active invite codes for the active company
 */

import crypto from "node:crypto";
import { Hono } from "hono";
import { rawSqlite } from "../db/client.js";
const getRawDb = () => rawSqlite;
import { generateToken } from "../lib/auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import * as companiesRepo from "../repositories/companies.repo.js";

export const onboardingRoute = new Hono();
onboardingRoute.use("*", requireAuth());

type MembershipRow = {
	company_id: string;
	role: "owner" | "admin" | "member";
	designation: string | null;
	name: string;
};

function listMemberships(userId: string): MembershipRow[] {
	return getRawDb()
		.prepare(
			`SELECT uc.company_id, uc.role, uc.designation, c.name
			   FROM user_companies uc
			   JOIN companies c ON c.id = uc.company_id
			  WHERE uc.user_id = ?
			  ORDER BY uc.joined_at ASC`,
		)
		.all(userId) as MembershipRow[];
}

onboardingRoute.get("/me", (c) => {
	const userId = c.get("userId") as string | undefined;
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const companies = listMemberships(userId);
	const activeCompanyId = (c.get("companyId") as string | undefined) ?? "";
	return c.json({ companies, activeCompanyId });
});

onboardingRoute.post("/create", async (c) => {
	const userId = c.get("userId") as string | undefined;
	const email = c.get("userEmail") as string | undefined;
	if (!userId || !email) return c.json({ error: "Unauthorized" }, 401);
	const body = await c.req.json().catch(() => null);
	const name = typeof body?.name === "string" ? body.name.trim() : "";
	const designation =
		typeof body?.designation === "string" ? body.designation.trim() : "";
	if (!name) return c.json({ error: "Company name is required" }, 400);

	const existing = await companiesRepo.listCompanies();
	if (existing.some((co) => co.name.toLowerCase() === name.toLowerCase())) {
		return c.json({ error: `Company "${name}" already exists` }, 409);
	}
	const created = await companiesRepo.createCompany({ name });
	if (!created) return c.json({ error: "Failed to create company" }, 500);

	const db = getRawDb();
	db.prepare(
		`INSERT INTO user_companies (user_id, company_id, role, designation)
		 VALUES (?, ?, 'owner', ?)`,
	).run(userId, created.id, designation || null);
	db.prepare(
		`INSERT OR IGNORE INTO company_members (id, company_id, name, email, role, joined_at)
		 VALUES (?, ?, ?, ?, 'owner', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
	).run(userId, created.id, designation || email, email, "owner");

	// New users may have empty users.company_id (registered without a workspace).
	// Set their "primary" pointer to whatever company they just landed in.
	db.prepare(
		`UPDATE users SET company_id = ? WHERE id = ? AND (company_id IS NULL OR company_id = '')`,
	).run(created.id, userId);

	const token = generateToken({
		userId,
		email,
		companyId: created.id,
		role: "owner",
	});
	return c.json({ token, company: created, role: "owner" }, 201);
});

onboardingRoute.post("/join", async (c) => {
	const userId = c.get("userId") as string | undefined;
	const email = c.get("userEmail") as string | undefined;
	if (!userId || !email) return c.json({ error: "Unauthorized" }, 401);
	const body = await c.req.json().catch(() => null);
	const mode = typeof body?.mode === "string" ? body.mode : "";
	const designation =
		typeof body?.designation === "string" ? body.designation.trim() : "";
	const db = getRawDb();

	let companyId = "";
	let role: "owner" | "admin" | "member" = "member";

	if (mode === "code") {
		const code = typeof body?.code === "string" ? body.code.trim() : "";
		if (!code) return c.json({ error: "Invite code is required" }, 400);
		const row = db
			.prepare(
				`SELECT code, company_id, default_role, max_uses, uses, expires_at
				   FROM company_invite_codes WHERE code = ? LIMIT 1`,
			)
			.get(code) as
			| {
					code: string;
					company_id: string;
					default_role: string;
					max_uses: number | null;
					uses: number;
					expires_at: string | null;
				}
			| undefined;
		if (!row) return c.json({ error: "Invalid invite code" }, 404);
		if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
			return c.json({ error: "Invite code has expired" }, 410);
		}
		if (row.max_uses > 0 && row.uses >= row.max_uses) {
			return c.json({ error: "Invite code is exhausted" }, 410);
		}
		companyId = row.company_id;
		role = (row.default_role as typeof role) ?? "member";
		db.prepare(
			`UPDATE company_invite_codes SET uses = uses + 1 WHERE code = ?`,
		).run(code);
	} else if (mode === "cloud") {
		// Cloud join: client has already resolved a companyId via Supabase
		// directory lookup. We trust the id and gate access by the directory
		// row's "open" flag (validated client-side; server only checks that
		// the company exists locally OR will be created from cloud metadata).
		const cloudCompanyId =
			typeof body?.companyId === "string" ? body.companyId.trim() : "";
		const cloudName =
			typeof body?.companyName === "string" ? body.companyName.trim() : "";
		if (!cloudCompanyId) {
			return c.json({ error: "companyId is required for cloud join" }, 400);
		}
		const local = db
			.prepare(`SELECT id FROM companies WHERE id = ? LIMIT 1`)
			.get(cloudCompanyId) as { id: string } | undefined;
		if (!local) {
			if (!cloudName) {
				return c.json(
					{ error: "Company not present locally; companyName required" },
					400,
				);
			}
			db.prepare(
				`INSERT INTO companies (id, name, created_at, updated_at)
				 VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
			).run(cloudCompanyId, cloudName);
		}
		companyId = cloudCompanyId;
	} else if (mode === "lan") {
		// LAN join: client has already handshaken with a peer instance and
		// captured its companyId + name from the broadcast. Same trust model
		// as cloud, just discovered via mDNS.
		const lanCompanyId =
			typeof body?.companyId === "string" ? body.companyId.trim() : "";
		const lanName =
			typeof body?.companyName === "string" ? body.companyName.trim() : "";
		if (!lanCompanyId) {
			return c.json({ error: "companyId is required for LAN join" }, 400);
		}
		const local = db
			.prepare(`SELECT id FROM companies WHERE id = ? LIMIT 1`)
			.get(lanCompanyId) as { id: string } | undefined;
		if (!local) {
			if (!lanName) {
				return c.json(
					{ error: "Company not present locally; companyName required" },
					400,
				);
			}
			db.prepare(
				`INSERT INTO companies (id, name, created_at, updated_at)
				 VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
			).run(lanCompanyId, lanName);
		}
		companyId = lanCompanyId;
	} else {
		return c.json({ error: "Unknown join mode" }, 400);
	}

	db.prepare(
		`INSERT OR IGNORE INTO user_companies (user_id, company_id, role, designation)
		 VALUES (?, ?, ?, ?)`,
	).run(userId, companyId, role, designation || null);
	db.prepare(
		`INSERT OR IGNORE INTO company_members (id, company_id, name, email, role, joined_at)
		 VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
	).run(userId, companyId, designation || email, email, role);
	db.prepare(
		`UPDATE users SET company_id = ? WHERE id = ? AND (company_id IS NULL OR company_id = '')`,
	).run(companyId, userId);

	const company = db
		.prepare(`SELECT id, name FROM companies WHERE id = ?`)
		.get(companyId) as { id: string; name: string };
	const token = generateToken({ userId, email, companyId, role });
	return c.json({ token, company, role }, 201);
});

onboardingRoute.post("/switch", async (c) => {
	const userId = c.get("userId") as string | undefined;
	const email = c.get("userEmail") as string | undefined;
	if (!userId || !email) return c.json({ error: "Unauthorized" }, 401);
	const body = await c.req.json().catch(() => null);
	const companyId =
		typeof body?.companyId === "string" ? body.companyId.trim() : "";
	if (!companyId) return c.json({ error: "companyId is required" }, 400);
	const membership = getRawDb()
		.prepare(
			`SELECT role FROM user_companies WHERE user_id = ? AND company_id = ? LIMIT 1`,
		)
		.get(userId, companyId) as
		| { role: "owner" | "admin" | "member" }
		| undefined;
	if (!membership)
		return c.json({ error: "Not a member of that company" }, 403);
	const token = generateToken({
		userId,
		email,
		companyId,
		role: membership.role,
	});
	return c.json({ token, companyId, role: membership.role });
});

onboardingRoute.post("/invite-codes", async (c) => {
	const userId = c.get("userId") as string | undefined;
	const companyId = c.get("companyId") as string | undefined;
	const role = c.get("userRole") as string | undefined;
	if (!userId || !companyId) return c.json({ error: "Unauthorized" }, 401);
	if (role !== "owner" && role !== "admin")
		return c.json({ error: "Only owners or admins can create invite codes" }, 403);
	const body = await c.req.json().catch(() => null);
	const defaultRole =
		body?.defaultRole === "admin" ? "admin" : "member";
	const maxUses =
		Number.isFinite(body?.maxUses) && body.maxUses > 0
			? Math.floor(body.maxUses)
			: 0; // 0 = unlimited
	const expiresInDays =
		Number.isFinite(body?.expiresInDays) && body.expiresInDays > 0
			? Math.floor(body.expiresInDays)
			: 30;
	const code = crypto.randomBytes(4).toString("hex").toUpperCase();
	const expiresAt = new Date(
		Date.now() + expiresInDays * 86_400_000,
	).toISOString();
	getRawDb()
		.prepare(
			`INSERT INTO company_invite_codes (code, company_id, created_by, default_role, max_uses, uses, expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, 0, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
		)
		.run(code, companyId, userId, defaultRole, maxUses, expiresAt);
	return c.json({ code, defaultRole, maxUses, expiresAt }, 201);
});

onboardingRoute.get("/invite-codes", (c) => {
	const companyId = c.get("companyId") as string | undefined;
	const role = c.get("userRole") as string | undefined;
	if (!companyId) return c.json({ error: "Unauthorized" }, 401);
	if (role !== "owner" && role !== "admin")
		return c.json({ error: "Forbidden" }, 403);
	const rows = getRawDb()
		.prepare(
			`SELECT code, default_role, max_uses, uses, expires_at, created_at
			   FROM company_invite_codes WHERE company_id = ? ORDER BY created_at DESC`,
		)
		.all(companyId);
	return c.json(rows);
});
