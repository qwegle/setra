import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNoKeyMessage } from "../provider-availability.js";

// Mock governance and child_process so existing mocks work
vi.mock("node:child_process", () => ({
	execFile: vi.fn(
		(
			_cmd: string,
			_args: string[],
			cb: (err: null, stdout: string, stderr: string) => void,
		) => {
			cb(null, "/usr/bin/mock", "");
		},
	),
}));

vi.mock("../governance.js", () => ({
	loadGovernancePolicy: vi.fn(() => ({
		deploymentMode: "cloud",
		blockNetworkAccess: false,
		requireApprovalForToolUse: false,
		auditLog: { enabled: false, path: "" },
		maxCostPerRunUsd: 0,
		allowedProviders: [],
	})),
	validateModelChoice: vi.fn(() => null),
	DEFAULT_POLICY: {
		deploymentMode: "cloud",
		blockNetworkAccess: false,
		requireApprovalForToolUse: false,
		auditLog: { enabled: false, path: "" },
		maxCostPerRunUsd: 0,
	},
}));

describe("getNoKeyMessage", () => {
	it("returns a non-empty string", () => {
		const msg = getNoKeyMessage();
		expect(typeof msg).toBe("string");
		expect(msg.length).toBeGreaterThan(0);
		expect(msg).toMatch(/ollama/i);
	});
});

describe("resolveModelWithFallback", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		// Clear API keys
		delete process.env["ANTHROPIC_API_KEY"];
		delete process.env["OPENAI_API_KEY"];
		delete process.env["GEMINI_API_KEY"];
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		vi.restoreAllMocks();
	});

	it("falls back to Ollama when no API keys and Ollama is running", async () => {
		// Mock fetch to simulate Ollama running with models
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: vi
				.fn()
				.mockResolvedValue({ models: [{ name: "qwen2.5-coder:7b" }] }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { resolveModelWithFallback } = await import(
			"../provider-availability.js"
		);
		const result = await resolveModelWithFallback("auto");
		expect(result.isFallback).toBe(true);
		expect(result.provider).toBe("ollama");
		expect(result.model).toBeTruthy();
	});

	it("throws helpful error when Ollama not running and no API keys", async () => {
		// Mock fetch to simulate Ollama not running
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		vi.stubGlobal("fetch", fetchMock);

		const { resolveModelWithFallback } = await import(
			"../provider-availability.js"
		);
		await expect(resolveModelWithFallback("auto")).rejects.toThrow(
			/No models available/,
		);
	});
});
