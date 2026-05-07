import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let tmpHome: string;
const ENV_KEYS = [
	"HOME",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"OPENROUTER_API_KEY",
	"GROQ_API_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
	for (const k of ENV_KEYS) delete process.env[k];
	tmpHome = mkdtempSync(join(tmpdir(), "setra-test-home-"));
	process.env["HOME"] = tmpHome;
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k];
		else process.env[k] = savedEnv[k];
	}
	rmSync(tmpHome, { recursive: true, force: true });
});

function writeSettings(s: Record<string, unknown>): void {
	const dir = join(tmpHome, ".setra");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), JSON.stringify(s));
}

import {
	TIER_LADDER,
	pickTierModel,
	resolveAutoAdapter,
} from "../lib/resolve-auto-adapter.js";

describe("resolveAutoAdapter", () => {
	it("returns null adapter when no keys are configured", () => {
		const r = resolveAutoAdapter("auto", null);
		expect(r.adapter).toBeNull();
		expect(r.reason).toBe("auto:no-keys-configured");
	});

	it("picks the CHEAPEST model on Anthropic (haiku, not sonnet) when only Anthropic key is present", () => {
		writeSettings({ anthropic_api_key: "sk-ant-test" });
		const r = resolveAutoAdapter("auto");
		expect(r.adapter).toBe("anthropic-api");
		expect(r.model).toBe("claude-haiku-4-5");
		expect(r.reason).toBe("auto:cheapest-connected:claude-haiku");
	});

	it("uses OpenRouter auto route when openrouter key is the only one set", () => {
		writeSettings({ openrouter_api_key: "sk-or-test" });
		const r = resolveAutoAdapter("auto");
		expect(r.adapter).toBe("openrouter");
		expect(r.model).toBe("openrouter/auto");
	});

	it("prefers cheaper provider: openrouter auto beats anthropic", () => {
		writeSettings({
			anthropic_api_key: "sk-ant-test",
			openrouter_api_key: "sk-or-test",
		});
		const r = resolveAutoAdapter("auto");
		expect(r.adapter).toBe("openrouter");
		expect(r.reason).toBe("auto:cheapest-connected:openrouter-auto");
	});

	it("prefers groq over gemini-flash over gpt-4o-mini over claude-haiku", () => {
		writeSettings({
			anthropic_api_key: "sk-ant-test",
			openai_api_key: "sk-oai-test",
			gemini_api_key: "g-test",
			groq_api_key: "gsk-test",
		});
		const r = resolveAutoAdapter("auto");
		expect(r.adapter).toBe("groq");
	});

	it("picks gemini-flash (NOT gemini-pro) for cost optimisation", () => {
		writeSettings({ gemini_api_key: "g-test" });
		const r = resolveAutoAdapter("auto");
		expect(r.model).toBe("gemini-2.5-flash");
	});

	it("picks gpt-4o-mini (NOT gpt-4.1) for cost optimisation", () => {
		writeSettings({ openai_api_key: "sk-oai-test" });
		const r = resolveAutoAdapter("auto");
		expect(r.model).toBe("gpt-4o-mini");
	});

	it("passes through explicit adapter without consulting settings", () => {
		const r = resolveAutoAdapter(
			"openrouter",
			"openrouter:meta-llama/llama-4-maverick:free",
		);
		expect(r.adapter).toBe("openrouter");
		expect(r.model).toBe("openrouter:meta-llama/llama-4-maverick:free");
		expect(r.reason).toBe("explicit-adapter");
	});

	it("preserves a requested model when auto-resolving (user override beats cheapest)", () => {
		writeSettings({ anthropic_api_key: "sk-ant-test" });
		const r = resolveAutoAdapter("auto", "claude-opus-4-5");
		expect(r.adapter).toBe("anthropic-api");
		expect(r.model).toBe("claude-opus-4-5");
	});

	it("treats env var as a configured key even when settings.json is absent", () => {
		process.env["GEMINI_API_KEY"] = "g-test";
		expect(resolveAutoAdapter("auto").adapter).toBe("gemini-api");
	});
});

describe("pickTierModel — smart routing ladder", () => {
	it("claude_local: trivial=haiku, standard=sonnet, complex=opus", () => {
		expect(pickTierModel("claude_local", "trivial")).toBe("claude-haiku-4-5");
		expect(pickTierModel("claude_local", "standard")).toBe("claude-sonnet-4-5");
		expect(pickTierModel("claude_local", "complex")).toBe("claude-opus-4-5");
	});

	it("gemini_local: trivial=flash-lite, standard=flash, complex=pro", () => {
		expect(pickTierModel("gemini_local", "trivial")).toBe(
			"gemini-2.5-flash-lite",
		);
		expect(pickTierModel("gemini_local", "standard")).toBe("gemini-2.5-flash");
		expect(pickTierModel("gemini_local", "complex")).toBe("gemini-2.5-pro");
	});

	it("codex_local: trivial=4o-mini, standard=4.1-mini, complex=5.4", () => {
		expect(pickTierModel("codex_local", "trivial")).toBe("gpt-4o-mini");
		expect(pickTierModel("codex_local", "complex")).toBe("gpt-5.4");
	});

	it("every adapter has all three tiers defined", () => {
		for (const ladder of Object.values(TIER_LADDER)) {
			expect(ladder.trivial).toBeTruthy();
			expect(ladder.standard).toBeTruthy();
			expect(ladder.complex).toBeTruthy();
		}
	});
});
