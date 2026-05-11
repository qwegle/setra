/**
 * LAN/Network routes — discoverability toggle, peer browser, join-request
 * handshake (cross-instance) that reuses `company_invites` for owner approval.
 *
 * Authentication:
 *   GET  /api/lan/status                 — auth
 *   GET  /api/lan/peers                  — auth
 *   POST /api/lan/discoverable           — auth (owner-only)
 *   POST /api/lan/join-request           — PUBLIC (rate-limited above) so peers
 *                                          on the same Wi-Fi can request to join
 *   GET  /api/lan/join-request/:id       — PUBLIC, polling endpoint for the
 *                                          requester to see approval status
 *   POST /api/lan/join-request/:id/approve — auth (owner/admin)
 */
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { z } from "zod";
import { tryGetCompanyId } from "../lib/company-scope.js";
import {
	getInstanceId,
	getLanAddresses,
	isBroadcasting,
	listPeers,
	startBroadcast,
	stopBroadcast,
} from "../lib/lan-discovery.js";

export const lanRoute = new Hono();

function getActorRole(c: import("hono").Context): string | null {
	const role = c.get("userRole") as string | undefined;
	return role ?? null;
}

function getCompanyRow(companyId: string) {
	return getRawDb()
		.prepare(
			`SELECT id, name, COALESCE(lan_discoverable, 0) AS lan_discoverable
			 FROM companies WHERE id = ?`,
		)
		.get(companyId) as
		| { id: string; name: string; lan_discoverable: number }
		| undefined;
}

function getOwnerEmail(companyId: string): string {
	const row = getRawDb()
		.prepare(
			`SELECT email FROM users WHERE company_id = ? AND role = 'owner'
			 ORDER BY created_at ASC LIMIT 1`,
		)
		.get(companyId) as { email: string } | undefined;
	return row?.email ?? "";
}

lanRoute.get("/status", (c) => {
	const companyId = tryGetCompanyId(c);
	if (!companyId) return c.json({ error: "company required" }, 400);
	const row = getCompanyRow(companyId);
	return c.json({
		instanceId: getInstanceId(),
		discoverable: row?.lan_discoverable === 1,
		broadcasting: isBroadcasting(),
		addresses: getLanAddresses(),
		port: Number(process.env.SETRA_PORT ?? 3141),
		companyName: row?.name ?? "",
	});
});

lanRoute.get("/peers", (c) => {
	return c.json({ peers: listPeers() });
});

const DiscoverableSchema = z.object({ enabled: z.boolean() });

lanRoute.post("/discoverable", async (c) => {
	const companyId = tryGetCompanyId(c);
	if (!companyId) return c.json({ error: "company required" }, 400);
	const role = getActorRole(c);
	if (role !== "owner" && role !== "admin") {
		return c.json({ error: "owner or admin required" }, 403);
	}
	const body = DiscoverableSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!body.success) return c.json({ error: "invalid body" }, 400);
	const db = getRawDb();
	db.prepare(
		`UPDATE companies SET lan_discoverable = ? WHERE id = ?`,
	).run(body.data.enabled ? 1 : 0, companyId);
	const row = getCompanyRow(companyId);
	const port = Number(process.env.SETRA_PORT ?? 3141);
	if (body.data.enabled && row) {
		startBroadcast({
			companyId,
			companyName: row.name,
			ownerEmail: getOwnerEmail(companyId),
			port,
		});
	} else {
		stopBroadcast();
	}
	return c.json({ discoverable: body.data.enabled, broadcasting: isBroadcasting() });
});

// ── Cross-instance join handshake ────────────────────────────────────────────

const JoinRequestSchema = z.object({
	companyId: z.string().min(1),
	email: z.string().email(),
	name: z.string().optional(),
	message: z.string().max(500).optional(),
});

lanRoute.post("/join-request", async (c) => {
	const parsed = JoinRequestSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) return c.json({ error: "invalid body" }, 400);
	const { companyId, email, name, message } = parsed.data;
	const row = getCompanyRow(companyId);
	if (!row) return c.json({ error: "company not found" }, 404);
	if (row.lan_discoverable !== 1) {
		// Don't leak existence of the company to LAN strangers
		return c.json({ error: "not discoverable" }, 404);
	}
	const db = getRawDb();
	const existing = db
		.prepare(
			`SELECT id, status FROM company_invites
			 WHERE company_id = ? AND email = ? AND status IN ('lan_pending', 'pending')
			 ORDER BY sent_at DESC LIMIT 1`,
		)
		.get(companyId, email) as { id: string; status: string } | undefined;
	if (existing) {
		return c.json({ requestId: existing.id, status: existing.status });
	}
	const id = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	const note = JSON.stringify({ name: name ?? null, message: message ?? null });
	db.prepare(
		`INSERT INTO company_invites (id, email, role, status, company_id, expires_at, note)
		 VALUES (?, ?, 'member', 'lan_pending', ?, ?, ?)`,
	).run(id, email, companyId, expiresAt, note);
	return c.json({ requestId: id, status: "lan_pending" }, 201);
});

lanRoute.get("/join-request/:id", (c) => {
	const id = c.req.param("id");
	const row = getRawDb()
		.prepare(
			`SELECT id, status, company_id FROM company_invites WHERE id = ?`,
		)
		.get(id) as { id: string; status: string; company_id: string } | undefined;
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json({ requestId: row.id, status: row.status });
});

lanRoute.post("/join-request/:id/approve", async (c) => {
	const companyId = tryGetCompanyId(c);
	if (!companyId) return c.json({ error: "company required" }, 400);
	const role = getActorRole(c);
	if (role !== "owner" && role !== "admin") {
		return c.json({ error: "owner or admin required" }, 403);
	}
	const id = c.req.param("id");
	const db = getRawDb();
	const row = db
		.prepare(
			`SELECT id, status, company_id FROM company_invites WHERE id = ?`,
		)
		.get(id) as { id: string; status: string; company_id: string } | undefined;
	if (!row || row.company_id !== companyId) {
		return c.json({ error: "not found" }, 404);
	}
	if (row.status !== "lan_pending") {
		return c.json({ error: "not pending" }, 409);
	}
	db.prepare(`UPDATE company_invites SET status = 'pending' WHERE id = ?`).run(id);
	return c.json({ requestId: id, status: "pending" });
});

lanRoute.post("/join-request/:id/reject", async (c) => {
	const companyId = tryGetCompanyId(c);
	if (!companyId) return c.json({ error: "company required" }, 400);
	const role = getActorRole(c);
	if (role !== "owner" && role !== "admin") {
		return c.json({ error: "owner or admin required" }, 403);
	}
	const id = c.req.param("id");
	const db = getRawDb();
	const row = db
		.prepare(`SELECT id, company_id FROM company_invites WHERE id = ?`)
		.get(id) as { id: string; company_id: string } | undefined;
	if (!row || row.company_id !== companyId) {
		return c.json({ error: "not found" }, 404);
	}
	db.prepare(`UPDATE company_invites SET status = 'rejected' WHERE id = ?`).run(id);
	return c.json({ requestId: id, status: "rejected" });
});

lanRoute.get("/join-requests", (c) => {
	const companyId = tryGetCompanyId(c);
	if (!companyId) return c.json({ error: "company required" }, 400);
	const rows = getRawDb()
		.prepare(
			`SELECT id, email, status, sent_at, note FROM company_invites
			 WHERE company_id = ? AND status = 'lan_pending'
			 ORDER BY sent_at DESC LIMIT 100`,
		)
		.all(companyId) as Array<{
		id: string;
		email: string;
		status: string;
		sent_at: string;
		note: string | null;
	}>;
	const requests = rows.map((r) => {
		let parsed: { name: string | null; message: string | null } = {
			name: null,
			message: null,
		};
		if (r.note) {
			try {
				parsed = JSON.parse(r.note);
			} catch {
				/* legacy notes may not be JSON */
			}
		}
		return {
			id: r.id,
			email: r.email,
			name: parsed.name,
			message: parsed.message,
			status: r.status,
			sentAt: r.sent_at,
		};
	});
	return c.json({ requests });
});
