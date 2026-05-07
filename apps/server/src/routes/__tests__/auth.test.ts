import crypto from "node:crypto";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const JWT_SECRET = "test-jwt-secret";
const savedJwtSecret = process.env["JWT_SECRET"];

let db: Database.Database;
let mockCreateCompany = vi.fn();
let mockListCompanies = vi.fn();

function createDb(): Database.Database {
	const nextDb = new Database(":memory:");
	nextDb.exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			name TEXT,
			company_id TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at TEXT,
			updated_at TEXT
		);
	`);
	return nextDb;
}

function signToken(payload: Record<string, unknown>): string {
	const body = JSON.stringify(payload);
	const encoded = Buffer.from(body, "utf8").toString("base64url");
	const signature = crypto
		.createHmac("sha256", JWT_SECRET)
		.update(body)
		.digest("base64url");
	return `${encoded}.${signature}`;
}

async function buildApp() {
	process.env["JWT_SECRET"] = JWT_SECRET;
	vi.resetModules();
	vi.doMock("@setra/db", () => ({
		getRawDb: () => db,
	}));
	vi.doMock("../../repositories/companies.repo.js", () => ({
		createCompany: mockCreateCompany,
		listCompanies: mockListCompanies,
		ensureAssistantForCompany: vi.fn(),
	}));
	const [{ authRoute }, authLib] = await Promise.all([
		import("../auth.js"),
		import("../../lib/auth.js"),
	]);
	const app = new Hono();
	app.route("/auth", authRoute);
	return { app, authLib };
}

beforeEach(() => {
	db = createDb();
	process.env["JWT_SECRET"] = JWT_SECRET;
	mockCreateCompany = vi.fn(async ({ name }: { name: string }) => ({
		id: "company-1",
		name,
		slug: "company-1",
	}));
	mockListCompanies = vi.fn(async () => [
		{
			id: "company-1",
			name: "Acme",
			slug: "company-1",
		},
	]);
});

afterEach(() => {
	db.close();
	vi.restoreAllMocks();
	if (savedJwtSecret === undefined) delete process.env["JWT_SECRET"];
	else process.env["JWT_SECRET"] = savedJwtSecret;
});

describe("auth routes", () => {
	it("register creates a user and returns a token", async () => {
		const { app } = await buildApp();
		const res = await app.request("/auth/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "owner@example.com",
				password: "supersafe123",
				companyName: "Acme",
				name: "Owner",
			}),
		});
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(201);
		expect(typeof body.token).toBe("string");
		expect((body.user as Record<string, unknown>).email).toBe(
			"owner@example.com",
		);
		const user = db
			.prepare(
				"SELECT email, password_hash, company_id FROM users WHERE email = ?",
			)
			.get("owner@example.com") as {
			email: string;
			password_hash: string;
			company_id: string;
		};
		expect(user.email).toBe("owner@example.com");
		expect(user.password_hash).not.toBe("supersafe123");
		expect(user.company_id).toBe("company-1");
	});

	it("register joins the first company after the first user exists", async () => {
		const { app, authLib } = await buildApp();
		const passwordHash = await authLib.hashPassword("supersafe123");
		db.prepare(
			`INSERT INTO users (id, email, password_hash, name, company_id, role, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, '', '')`,
		).run(
			"owner-1",
			"owner@example.com",
			passwordHash,
			"Owner",
			"company-1",
			"owner",
		);

		const res = await app.request("/auth/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "member@example.com",
				password: "supersafe123",
				name: "Member",
			}),
		});
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(201);
		expect(mockCreateCompany).not.toHaveBeenCalled();
		expect(mockListCompanies).toHaveBeenCalledTimes(1);
		expect((body.user as Record<string, unknown>).role).toBe("member");
		const user = db
			.prepare("SELECT company_id, role FROM users WHERE email = ?")
			.get("member@example.com") as { company_id: string; role: string };
		expect(user.company_id).toBe("company-1");
		expect(user.role).toBe("member");
	});

	it("login with the correct password returns a token", async () => {
		const { app, authLib } = await buildApp();
		const passwordHash = await authLib.hashPassword("supersafe123");
		db.prepare(
			`INSERT INTO users (id, email, password_hash, name, company_id, role, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, '', '')`,
		).run(
			"user-1",
			"user@example.com",
			passwordHash,
			"User",
			"company-1",
			"member",
		);

		const res = await app.request("/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "user@example.com",
				password: "supersafe123",
			}),
		});
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(typeof body.token).toBe("string");
		expect((body.user as Record<string, unknown>).email).toBe(
			"user@example.com",
		);
	});

	it("login with the wrong password returns 401", async () => {
		const { app, authLib } = await buildApp();
		const passwordHash = await authLib.hashPassword("supersafe123");
		db.prepare(
			`INSERT INTO users (id, email, password_hash, name, company_id, role, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, '', '')`,
		).run(
			"user-1",
			"user@example.com",
			passwordHash,
			"User",
			"company-1",
			"member",
		);

		const res = await app.request("/auth/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				email: "user@example.com",
				password: "wrongpass",
			}),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Invalid credentials" });
	});

	it("protected routes require a valid token", async () => {
		const { app, authLib } = await buildApp();
		const missingTokenRes = await app.request("/auth/me");
		expect(missingTokenRes.status).toBe(401);

		const passwordHash = await authLib.hashPassword("supersafe123");
		db.prepare(
			`INSERT INTO users (id, email, password_hash, name, company_id, role, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, '', '')`,
		).run(
			"user-1",
			"user@example.com",
			passwordHash,
			"User",
			"company-1",
			"member",
		);
		const token = signToken({
			userId: "user-1",
			email: "user@example.com",
			companyId: "company-1",
			role: "member",
			exp: Date.now() + 60_000,
		});

		const meRes = await app.request("/auth/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const body = (await meRes.json()) as Record<string, unknown>;
		expect(meRes.status).toBe(200);
		expect((body.user as Record<string, unknown>).id).toBe("user-1");
	});

	it("rejects expired tokens", async () => {
		const { app } = await buildApp();
		const token = signToken({
			userId: "user-1",
			email: "user@example.com",
			companyId: "company-1",
			role: "member",
			exp: Date.now() - 1_000,
		});

		const res = await app.request("/auth/me", {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Token expired" });
	});
});
