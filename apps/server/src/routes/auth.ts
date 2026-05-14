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
	const firstName =
		typeof body?.firstName === "string" ? body.firstName.trim() : "";
	const lastName =
		typeof body?.lastName === "string" ? body.lastName.trim() : "";
	const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
	const securityQuestion =
		typeof body?.securityQuestion === "string"
			? body.securityQuestion.trim()
			: "";
	const securityAnswer =
		typeof body?.securityAnswer === "string"
			? body.securityAnswer.trim()
			: "";
	const acceptedTerms = body?.acceptedTerms === true;

	// Back-compat: "name" is the legacy single-field form. New clients send
	// firstName + lastName.
	const legacyName =
		typeof body?.name === "string" && body.name.trim().length > 0
			? body.name.trim()
			: null;
	const composedName =
		[firstName, lastName].filter(Boolean).join(" ").trim() || legacyName;

	if (!email || !password) {
		return c.json({ error: "email and password are required" }, 400);
	}
	if (password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters" }, 400);
	}
	// New shape: require firstName + acceptedTerms + securityQuestion/answer.
	// Legacy shape (name + companyName) is still accepted but discouraged.
	const isNewShape = firstName.length > 0 || lastName.length > 0;
	if (isNewShape) {
		if (!firstName || !lastName) {
			return c.json(
				{ error: "firstName and lastName are required" },
				400,
			);
		}
		if (!acceptedTerms) {
			return c.json(
				{ error: "You must accept the terms and conditions" },
				400,
			);
		}
		if (!securityQuestion || !securityAnswer) {
			return c.json(
				{
					error:
						"securityQuestion and securityAnswer are required (used for password recovery)",
				},
				400,
			);
		}
		if (securityAnswer.length < 3) {
			return c.json(
				{ error: "Security answer must be at least 3 characters" },
				400,
			);
		}
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

	// Check for pending invite for this email — invites trump everything else
	// because they encode an explicit "join this company" decision by an existing
	// admin.
	const invite = db
		.prepare(
			`SELECT id, company_id, role FROM company_invites
			 WHERE email = ? AND status = 'pending' AND expires_at > datetime('now')
			 ORDER BY sent_at DESC LIMIT 1`,
		)
		.get(email) as { id: string; company_id: string; role: string } | undefined;

	// New flow: a user may register with no company at all. They will be
	// directed to /onboarding/company to either create one or join one (LAN,
	// Internet, or code). users.company_id stays empty until that flow runs.
	const skipCompanyCreation = isNewShape && !companyName && !invite;

	let targetCompany: { id: string } | null = null;
	if (invite) {
		targetCompany = { id: invite.company_id };
	} else if (companyName) {
		const created = await companiesRepo.createCompany({ name: companyName });
		if (!created) {
			return c.json({ error: "Failed to create company" }, 500);
		}
		targetCompany = { id: created.id };
	} else if (!skipCompanyCreation) {
		// Legacy shape without invite or companyName — preserve the old error
		// so existing tests + clients see the same response.
		return c.json(
			{
				error:
					"companyName is required to create a new workspace. Ask an existing admin for an invite to join an existing company.",
			},
			400,
		);
	}

	const role = isFirstUser
		? "owner"
		: invite
			? ((invite.role as "admin" | "member") ?? "member")
			: "owner";

	const passwordHash = await hashPassword(password);
	const securityAnswerHash = securityAnswer
		? await hashPassword(securityAnswer.toLowerCase())
		: null;
	const user = db
		.prepare(
			`INSERT INTO users (id, email, password_hash, name, first_name, last_name, phone, security_question, security_answer_hash, accepted_terms_at, company_id, role, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
			 RETURNING id, email, name, company_id, role`,
		)
		.get(
			crypto.randomUUID(),
			email,
			passwordHash,
			composedName,
			firstName || null,
			lastName || null,
			phone || null,
			securityQuestion || null,
			securityAnswerHash,
			acceptedTerms ? new Date().toISOString() : null,
			targetCompany?.id ?? "",
			role,
		) as {
		id: string;
		email: string;
		name: string | null;
		company_id: string;
		role: "owner" | "admin" | "member";
	};

	// Wire up the new join table whenever the user has a company at register
	// time (invite or legacy path).
	if (targetCompany) {
		db.prepare(
			`INSERT OR IGNORE INTO user_companies (user_id, company_id, role)
			 VALUES (?, ?, ?)`,
		).run(user.id, targetCompany.id, role);

		// Create company_members row so user appears in the team
		db.prepare(
			`INSERT OR IGNORE INTO company_members (id, company_id, name, email, role, joined_at)
			 VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
		).run(
			user.id,
			targetCompany.id,
			composedName ?? email,
			email,
			role,
		);
	}

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
		{
			token,
			user: sanitizeUser(user),
			company: targetCompany,
			needsCompany: skipCompanyCreation,
		},
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

// ── Forgot password (security-question flow) ────────────────────────────
//
// Step 1: client POSTs { email } → server returns { securityQuestion }
// (or 404 if no user / no question set).
// Step 2: client POSTs { email, answer, newPassword } → server verifies
// the answer (case-insensitive bcrypt compare) and updates the password.
//
// Deliberately no rate-limit middleware here yet — this lives behind the
// public auth surface and we'll add the limiter in the hardening pass.

authRoute.post("/forgot-password/start", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email =
		typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	if (!email) return c.json({ error: "email is required" }, 400);
	const row = getRawDb()
		.prepare(
			`SELECT security_question FROM users WHERE email = ? LIMIT 1`,
		)
		.get(email) as { security_question: string | null } | undefined;
	if (!row || !row.security_question) {
		// Generic response — do not leak which step failed.
		return c.json({ error: "No recovery available for this account" }, 404);
	}
	return c.json({ securityQuestion: row.security_question });
});

authRoute.post("/forgot-password/verify", async (c) => {
	const body = await c.req.json().catch(() => null);
	const email =
		typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
	const newPassword =
		typeof body?.newPassword === "string" ? body.newPassword : "";
	if (!email || !answer || !newPassword) {
		return c.json(
			{ error: "email, answer, and newPassword are required" },
			400,
		);
	}
	if (newPassword.length < 8) {
		return c.json(
			{ error: "New password must be at least 8 characters" },
			400,
		);
	}
	const db = getRawDb();
	const row = db
		.prepare(
			`SELECT id, security_answer_hash FROM users WHERE email = ? LIMIT 1`,
		)
		.get(email) as
		| { id: string; security_answer_hash: string | null }
		| undefined;
	if (!row || !row.security_answer_hash) {
		return c.json({ error: "Recovery failed" }, 401);
	}
	const valid = await comparePassword(
		answer.toLowerCase(),
		row.security_answer_hash,
	);
	if (!valid) return c.json({ error: "Recovery failed" }, 401);
	const hash = await hashPassword(newPassword);
	db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
		hash,
		row.id,
	);
	return c.json({ ok: true });
});

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
