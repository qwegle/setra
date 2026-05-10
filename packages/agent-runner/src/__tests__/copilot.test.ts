import { describe, expect, it } from "vitest";
import { CopilotAdapter, copilotAdapter } from "../adapters/copilot.js";
import type { Plot, Run } from "../types.js";

const plot: Plot = {
	id: "plot-1",
	worktreePath: "/tmp/wt",
} as Plot;

const baseRun: Run = {
	id: "run-1",
	model: "claude-sonnet-4.6",
	task: "do the thing",
} as Run;

describe("CopilotAdapter", () => {
	it("exposes registry-grade metadata", () => {
		expect(copilotAdapter.name).toBe("copilot");
		expect(copilotAdapter.displayName).toMatch(/copilot/i);
		expect(copilotAdapter.supportsModels).toContain("claude-sonnet-4.6");
		expect(copilotAdapter.supportsModels).toContain("gpt-5.4");
	});

	it("builds a non-interactive command with model, MCP config and prompt", () => {
		const spawn = copilotAdapter.buildCommand(plot, baseRun, "/cfg/mcp.json");
		expect(spawn.cmd).toBe("copilot");
		expect(spawn.args).toContain("--no-color");
		expect(spawn.args).toContain("--allow-all-tools");
		expect(spawn.args).toContain("--model");
		expect(spawn.args).toContain("claude-sonnet-4.6");
		expect(spawn.args).toContain("--mcp-config");
		expect(spawn.args).toContain("/cfg/mcp.json");
		expect(spawn.args.at(-2)).toBe("-p");
		expect(spawn.args.at(-1)).toBe("do the thing");
		expect(spawn.cwd).toBe("/tmp/wt");
		expect(spawn.env?.SETRA_RUN_ID).toBe("run-1");
		expect(spawn.env?.SETRA_AGENT).toBe("copilot");
	});

	it("falls back to defaultModel for unknown model ids", () => {
		const adapter = new CopilotAdapter();
		const spawn = adapter.buildCommand(
			plot,
			{ ...baseRun, model: "totally-fake-model" } as Run,
			"/cfg/mcp.json",
		);
		const idx = spawn.args.indexOf("--model");
		expect(spawn.args[idx + 1]).toBe(adapter.defaultModel);
	});

	it("omits --model when 'auto' is requested", () => {
		const spawn = copilotAdapter.buildCommand(
			plot,
			{ ...baseRun, model: "auto" } as Run,
			"/cfg/mcp.json",
		);
		expect(spawn.args).not.toContain("--model");
	});

	it("appends --system-prompt when systemPromptAppend is set", () => {
		const spawn = copilotAdapter.buildCommand(
			plot,
			{ ...baseRun, systemPromptAppend: "you are precise" } as Run,
			"/cfg/mcp.json",
		);
		const idx = spawn.args.indexOf("--system-prompt");
		expect(idx).toBeGreaterThan(-1);
		expect(spawn.args[idx + 1]).toBe("you are precise");
	});

	it("parses prompt + completion token usage", () => {
		const usage = copilotAdapter.parseTokenUsage(
			"prompt tokens: 1,200\ncompletion tokens: 350\n",
		);
		expect(usage).toEqual({
			promptTokens: 1200,
			completionTokens: 350,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	});

	it("falls back to total tokens when prompt/completion are absent", () => {
		const usage = copilotAdapter.parseTokenUsage("Total tokens: 4,096");
		expect(usage?.completionTokens).toBe(4096);
	});

	it("returns null cost (subscription-billed)", () => {
		expect(copilotAdapter.parseCostUSD("anything")).toBeNull();
	});

	it("detects rate limit signals", () => {
		expect(copilotAdapter.detectRateLimit("HTTP 429 Too Many Requests")).toBe(
			true,
		);
		expect(copilotAdapter.detectRateLimit("usage limit reached")).toBe(true);
		expect(copilotAdapter.detectRateLimit("hello world")).toBe(false);
	});

	it("detects completion signals", () => {
		expect(copilotAdapter.detectCompletion("Total tokens used: 100")).toBe(
			true,
		);
		expect(copilotAdapter.detectCompletion("Session ended.")).toBe(true);
		expect(copilotAdapter.detectCompletion("still thinking...")).toBe(false);
	});
});
