import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Hono } from "hono";
/**
 * Verifies offline-mode hides cloud providers from the runtime catalog.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /api/runtime/available-models — offline filter", () => {
	beforeEach(() => {
		vi.resetModules();
		process.env["HOME"] = mkdtempSync(join(tmpdir(), "setra-runtime-"));
	});

	function setupDb() {
		const db = new Database(":memory:");
		db.exec(`
      CREATE TABLE companies (
        id TEXT PRIMARY KEY,
        is_offline_only INTEGER NOT NULL DEFAULT 0
      );
    `);
		db.prepare("INSERT INTO companies (id, is_offline_only) VALUES (?, ?)").run(
			"co-online",
			0,
		);
		db.prepare("INSERT INTO companies (id, is_offline_only) VALUES (?, ?)").run(
			"co-offline",
			1,
		);
		return db;
	}

	async function buildApp(db: Database.Database) {
		vi.doMock("../db/client.js", () => ({
			rawSqlite: db,
			db: {} as unknown,
		}));
		vi.doMock("../lib/company-settings.js", () => ({
			getCompanySettings: () => ({
				anthropic_api_key: "sk-test",
				openai_api_key: "sk-test",
				ollama_host: "http://localhost:11434",
			}),
		}));
		vi.doMock("../lib/company-scope.js", () => ({
			getCompanyId: (c: {
				req: { header: (k: string) => string | undefined };
			}) => c.req.header("x-company-id") ?? null,
			tryGetCompanyId: () => null,
		}));
		const { runtimeRoute } = await import("../routes/runtime.js");
		const app = new Hono();
		app.route("/api/runtime", runtimeRoute);
		return app;
	}

	it("includes cloud providers for an online company", async () => {
		const app = await buildApp(setupDb());
		const res = await app.request("/api/runtime/available-models", {
			headers: { "x-company-id": "co-online" },
		});
		const body = (await res.json()) as Array<{ provider: string }>;
		const providers = new Set(body.map((m) => m.provider));
		expect(providers.has("anthropic")).toBe(true);
		expect(providers.has("openai")).toBe(true);
		expect(providers.has("ollama")).toBe(true);
	});

	it("hides every cloud provider for an offline company", async () => {
		const app = await buildApp(setupDb());
		const res = await app.request("/api/runtime/available-models", {
			headers: { "x-company-id": "co-offline" },
		});
		const body = (await res.json()) as Array<{ provider: string }>;
		const providers = new Set(body.map((m) => m.provider));
		expect(providers.has("anthropic")).toBe(false);
		expect(providers.has("openai")).toBe(false);
		expect(providers.has("openrouter")).toBe(false);
		expect(providers.has("groq")).toBe(false);
		expect(providers.has("gemini")).toBe(false);
		// Local providers must remain.
		expect(providers.has("ollama")).toBe(true);
	});
});
