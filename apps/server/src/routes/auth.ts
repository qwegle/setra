import crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import {
	comparePassword,
	generateToken,
	hashPassword,
	verifyToken,
} from "../lib/auth.js";
import { getCompanyId } from "../lib/company-scope.js";
import { requireAuth } from "../middleware/require-auth.js";
import * as companiesRepo from "../repositories/companies.repo.js";

export const authRoute = new Hono();

function sanitizeUser(row: {
	id: string;
	email: string;
	name: string | null;
	company_id: string;
	role: "owner" | "admin" | "member";
}) {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		companyId: row.company_id,
		role: row.role,
	};
}

function readBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader?.startsWith("Bearer ")) return null;
	const token = authHeader.slice(7).trim();
	return token.length > 0 ? token : null;
}

authRoute.post("/register", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email =
		typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body?.password === "string" ? body.password : "";
	const companyName =
		typeof body?.companyName === "string" ? body.companyName.trim() : "";
	const name = typeof body?.name === "string" ? body.name.trim() : null;
	if (!email || !password) {
		return c.json({ error: "email and password are required" }, 400);
	}
	if (password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
	}
	const db = getRawDb();
	const existing = db
		.prepare(`SELECT id FROM users WHERE email = ? LIMIT 1`)
		.get(email) as { id: string } | undefined;
	if (existing) {
		return c.json({ error: "Email already registered" }, 409);
	}

	const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as {
		count: number;
	};
	const isFirstUser = Number(userCount.count ?? 0) === 0;
	if (isFirstUser && !companyName) {
		return c.json(
			{ error: "companyName is required for the first account" },
			400,
		);
	}

	const company = isFirstUser
		? await companiesRepo.createCompany({ name: companyName })
		: (await companiesRepo.listCompanies())[0];
	if (!company) {
		return c.json({ error: "Failed to resolve company" }, 500);
	}

	// Check for pending invite for this email
	const invite = db
		.prepare(
			`SELECT id, company_id, role FROM company_invites
			 WHERE email = ? AND status = 'pending' AND expires_at > datetime('now')
			 ORDER BY sent_at DESC LIMIT 1`,
		)
		.get(email) as { id: string; company_id: string; role: string } | undefined;

	const targetCompany = invite ? { id: invite.company_id } : company;
	const role = isFirstUser
		? "owner"
		: ((invite?.role as "admin" | "member") ?? "member");

	const passwordHash = await hashPassword(password);
	const user = db
		.prepare(
			`INSERT INTO users (id, email, password_hash, name, company_id, role, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
			 RETURNING id, email, name, company_id, role`,
		)
		.get(
			crypto.randomUUID(),
			email,
			passwordHash,
			name,
			targetCompany.id,
			role,
		) as {
		id: string;
		email: string;
		name: string | null;
		company_id: string;
		role: "owner" | "admin" | "member";
	};

	// Create company_members row so user appears in the team
	db.prepare(
		`INSERT OR IGNORE INTO company_members (id, company_id, name, email, role, joined_at)
		 VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
	).run(user.id, targetCompany.id, name ?? email, email, role);

	// Mark invite as accepted
	if (invite) {
		db.prepare(
			`UPDATE company_invites SET status = 'accepted' WHERE id = ?`,
		).run(invite.id);
	}
	const token = generateToken({
		userId: user.id,
		email: user.email,
		companyId: user.company_id,
		role: user.role,
	});
	return c.json(
		{ token, user: sanitizeUser(user), company: targetCompany },
		201,
	);
});

authRoute.post("/login", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email =
		typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const password = typeof body?.password === "string" ? body.password : "";
	if (!email || !password) {
		return c.json({ error: "email and password are required" }, 400);
	}
	const db = getRawDb();
	const user = db
		.prepare(
			`SELECT id, email, password_hash, name, company_id, role
			 FROM users WHERE email = ? LIMIT 1`,
		)
		.get(email) as
		| {
				id: string;
				email: string;
				password_hash: string;
				name: string | null;
				company_id: string;
				role: "owner" | "admin" | "member";
		  }
		| undefined;
	if (!user) return c.json({ error: "Invalid credentials" }, 401);
	const valid = await comparePassword(password, user.password_hash);
	if (!valid) return c.json({ error: "Invalid credentials" }, 401);
	const token = generateToken({
		userId: user.id,
		email: user.email,
		companyId: user.company_id,
		role: user.role,
	});
	return c.json({ token, user: sanitizeUser(user) });
});

authRoute.post("/refresh", async (c) => {
	const token = readBearerToken(c.req.header("Authorization"));
	if (!token) return c.json({ error: "Unauthorized" }, 401);
	try {
		const payload = verifyToken(token);
		if ((payload.exp ?? 0) < Date.now()) {
			return c.json({ error: "Token expired" }, 401);
		}
		const nextToken = generateToken({
			userId: payload.userId,
			email: payload.email,
			companyId: payload.companyId,
			role: payload.role,
		});
		return c.json({ token: nextToken });
	} catch {
		return c.json({ error: "Invalid token" }, 401);
	}
});

authRoute.use("/me", requireAuth());
authRoute.get("/me", async (c) => {
	const companyId = getCompanyId(c);
	const userId = c.get("userId") as string | undefined;
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const row = getRawDb()
		.prepare(
			`SELECT id, email, name, company_id, role FROM users WHERE id = ? AND company_id = ? LIMIT 1`,
		)
		.get(userId, companyId) as
		| {
				id: string;
				email: string;
				name: string | null;
				company_id: string;
				role: "owner" | "admin" | "member";
		  }
		| undefined;
	if (!row) return c.json({ error: "User not found" }, 404);
	return c.json({ user: sanitizeUser(row) });
});

authRoute.use("/logout", requireAuth());
authRoute.post("/logout", (c) => c.json({ ok: true }));

// ── Profile update ──────────────────────────────────────────────────────
authRoute.use("/profile", requireAuth());
authRoute.put("/profile", async (c) => {
	const userId = c.get("userId") as string | undefined;
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = await c.req.json().catch(() => null);
	const name = typeof body?.name === "string" ? body.name.trim() : undefined;
	const avatarUrl =
		typeof body?.avatarUrl === "string" ? body.avatarUrl : undefined;

	const db = getRawDb();
	if (name !== undefined) {
		db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, userId);
	}
	if (avatarUrl !== undefined) {
		// Store avatar as a user setting (avatar_url column may not exist yet)
		try {
			db.prepare("ALTER TABLE users ADD COLUMN avatar_url TEXT").run();
		} catch {
			// column already exists
		}
		db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(
			avatarUrl,
			userId,
		);
	}
	return c.json({ ok: true });
});

// ── Change password ─────────────────────────────────────────────────────
authRoute.use("/change-password", requireAuth());
authRoute.post("/change-password", async (c) => {
	const userId = c.get("userId") as string | undefined;
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = await c.req.json().catch(() => null);
	const currentPassword =
		typeof body?.currentPassword === "string" ? body.currentPassword : "";
	const newPassword =
		typeof body?.newPassword === "string" ? body.newPassword : "";

	if (!currentPassword || !newPassword) {
		return c.json(
			{ error: "currentPassword and newPassword are required" },
			400,
		);
	}
	if (newPassword.length < 8) {
		return c.json({ error: "New password must be at least 8 characters" }, 400);
	}

	const db = getRawDb();
	const user = db
		.prepare("SELECT password_hash FROM users WHERE id = ? LIMIT 1")
		.get(userId) as { password_hash: string } | undefined;
	if (!user) return c.json({ error: "User not found" }, 404);

	const valid = await comparePassword(currentPassword, user.password_hash);
	if (!valid) return c.json({ error: "Current password is incorrect" }, 401);

	const hash = await hashPassword(newPassword);
	db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
		hash,
		userId,
	);
	return c.json({ ok: true });
});
