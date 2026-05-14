/**
 * S0 security: JWT_SECRET must not silently fall back to a random,
 * per-process secret in production. That fallback would invalidate every
 * issued token on each restart and silently disable token validation
 * across replicas.
 *
 * Asserts the fail-fast contract on production NODE_ENV and the
 * length floor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
	"JWT_SECRET",
	"SETRA_INSTANCE_TOKEN",
	"INSTANCE_TOKEN",
	"NODE_ENV",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const k of ENV_KEYS) saved[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	vi.resetModules();
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	vi.resetModules();
});

describe("auth: JWT_SECRET fail-fast", () => {
	it("throws in production when no secret is set", async () => {
		process.env.NODE_ENV = "production";
		await expect(import("../lib/auth.js")).rejects.toThrow(/JWT_SECRET/);
	});

	it("throws in production when the secret is too short", async () => {
		process.env.NODE_ENV = "production";
		process.env.JWT_SECRET = "short";
		await expect(import("../lib/auth.js")).rejects.toThrow(/16 characters/);
	});

	it("accepts a sufficiently long secret in production", async () => {
		process.env.NODE_ENV = "production";
		process.env.JWT_SECRET = "a".repeat(32);
		const mod = await import("../lib/auth.js");
		const token = mod.generateToken({
			userId: "u1",
			email: "u@example.com",
			companyId: "co-1",
			role: "owner",
		});
		const decoded = mod.verifyToken(token);
		expect(decoded.userId).toBe("u1");
	});

	it("falls back to a random ephemeral secret outside production", async () => {
		process.env.NODE_ENV = "test";
		const mod = await import("../lib/auth.js");
		const token = mod.generateToken({
			userId: "u1",
			email: "u@example.com",
			companyId: "co-1",
			role: "owner",
		});
		expect(token).toContain(".");
	});
});
