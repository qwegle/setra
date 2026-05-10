/**
 * Settings persistence round-trip.
 *
 * Phase-1 outcome: keys saved via POST /api/settings come back masked
 * via GET /api/settings, never as plaintext, while non-secret fields
 * round-trip verbatim.
 *
 * The route reads/writes ~/.setra/settings.json. To keep the test
 * hermetic we redirect HOME and import the route with a fresh module.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpDir: string;
let savedHome: string | undefined;

// Build a Hono parent app that injects a company id into the context — this
// stands in for the real `requireCompany` middleware (which validates the
// header against the companies table). The settings route now insists on a
// scoped context to avoid the cross-tenant key disclosure CVE; tests have to
// honour that contract too.
async function makeApp() {
	const { default: settingsRoute } = await import("../routes/settings.js");
	const app = new Hono();
	app.use("*", async (c, next) => {
		(c as unknown as { set: (k: string, v: unknown) => void }).set(
			"companyId",
			"test-company",
		);
		await next();
	});
	app.route("/", settingsRoute);
	return app;
}

beforeEach(() => {
	savedHome = process.env["HOME"];
	tmpDir = mkdtempSync(join(tmpdir(), "setra-settings-"));
	mkdirSync(join(tmpDir, ".setra"), { recursive: true });
	process.env["HOME"] = tmpDir;
});

afterEach(() => {
	if (savedHome === undefined) delete process.env["HOME"];
	else process.env["HOME"] = savedHome;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("settings round-trip", () => {
	it("HOME redirection actually points at the temp dir", () => {
		expect(homedir()).toBe(tmpDir);
	});

	it("masks API keys: GET response never contains the plaintext", async () => {
		const settingsRoute = await makeApp();

		const postReq = new Request("http://x/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				anthropicApiKey: "sk-ant-secretsecretsecret12345",
			}),
		});
		const postRes = await settingsRoute.fetch(postReq);
		expect(postRes.status).toBe(200);

		const getReq = new Request("http://x/");
		const getRes = await settingsRoute.fetch(getReq);
		const body = (await getRes.json()) as Record<string, unknown>;

		// hasAnthropicKey flag flips on
		expect(body["hasAnthropicKey"]).toBe(true);
		// Plaintext never leaks
		expect(JSON.stringify(body)).not.toContain(
			"sk-ant-secretsecretsecret12345",
		);
		// Masked preview retains last 4 chars only
		const keys = body["keys"] as Record<string, string>;
		expect(keys["anthropic"]).toMatch(/•+2345$/);
	});

	it("saves and restores non-secret fields verbatim", async () => {
		const settingsRoute = await makeApp();

		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					defaultModel: "gpt-4o-mini",
					smallModel: "gpt-4o-mini",
					budget: { dailyUsd: 25, perRunUsd: 5, alertAt: 0.9 },
				}),
			}),
		);

		const res = await settingsRoute.fetch(new Request("http://x/"));
		const body = (await res.json()) as {
			defaultModel: string;
			smallModel: string;
			budget: Record<string, number>;
		};
		expect(body.defaultModel).toBe("gpt-4o-mini");
		expect(body.smallModel).toBe("gpt-4o-mini");
		expect(body.budget["dailyUsd"]).toBe(25);
		expect(body.budget["alertAt"]).toBe(0.9);
	});

	it("GET /models honors a saved default_model even when an API key is present", async () => {
		const settingsRoute = await makeApp();

		// Save a custom default + a Claude key. Prior bug: the Claude key would
		// silently overwrite the saved default with claude-sonnet-4-5, making the
		// picker un-changeable.
		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					anthropicApiKey: "sk-ant-test1234567890abcdef",
					defaultModel: "claude-haiku-4-5",
				}),
			}),
		);

		const res = await settingsRoute.fetch(new Request("http://x/models"));
		const body = (await res.json()) as { defaultModel: string };
		expect(body.defaultModel).toBe("claude-haiku-4-5");
	});

	it("persists the file at ~/.setra/settings.json", async () => {
		const settingsRoute = await makeApp();
		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ openaiApiKey: "sk-openaiaaaaaaaaaaaabcdef" }),
			}),
		);
		const path = join(tmpDir, ".setra", "settings.json");
		expect(existsSync(path)).toBe(true);
		const raw = readFileSync(path, "utf-8");
		expect(raw).not.toContain("sk-openaiaaaaaaaaaaaabcdef");
		expect(raw).toContain("openai_api_key");
		const saved = JSON.parse(raw) as {
			companies: Record<string, { openai_api_key: string }>;
		};
		expect(
			saved.companies["test-company"]?.openai_api_key.split(":"),
		).toHaveLength(3);
	});

	it("normalizes governance approval actions", async () => {
		const settingsRoute = await makeApp();

		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					governance: {
						autoApprove: false,
						approvalActions: ["task_start", "pr_merge"],
					},
				}),
			}),
		);

		let res = await settingsRoute.fetch(new Request("http://x/"));
		let body = (await res.json()) as {
			governance: { autoApprove: boolean; approvalActions: string[] };
		};
		expect(body.governance.autoApprove).toBe(false);
		expect(body.governance.approvalActions).toEqual(["task_start", "pr_merge"]);

		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ governance: { autoApprove: true } }),
			}),
		);

		res = await settingsRoute.fetch(new Request("http://x/"));
		body = (await res.json()) as {
			governance: { autoApprove: boolean; approvalActions: string[] };
		};
		expect(body.governance.autoApprove).toBe(true);
		expect(body.governance.approvalActions).toEqual([]);
	});

	it("merges partial updates instead of overwriting", async () => {
		const settingsRoute = await makeApp();

		// First POST sets anthropic key + budget
		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					anthropicApiKey: "sk-ant-keepkeepkeepkeepkeep",
					budget: { dailyUsd: 50 },
				}),
			}),
		);
		// Second POST sets only the openai key — anthropic & budget must survive
		await settingsRoute.fetch(
			new Request("http://x/", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ openaiApiKey: "sk-oanewnewnewnewnewnewnew" }),
			}),
		);

		const body = (await (
			await settingsRoute.fetch(new Request("http://x/"))
		).json()) as Record<string, unknown>;
		expect(body["hasAnthropicKey"]).toBe(true);
		expect(body["hasOpenaiKey"]).toBe(true);
		expect((body["budget"] as Record<string, number>)["dailyUsd"]).toBe(50);
	});
});
