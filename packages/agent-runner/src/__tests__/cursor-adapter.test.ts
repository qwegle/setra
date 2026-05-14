import { describe, expect, it } from "vitest";
import { CursorAdapter, cursorAdapter } from "../adapters/cursor.js";
import type { Plot, Run } from "../types.js";

const plot: Plot = {
	id: "plot-1",
	worktreePath: "/tmp/wt",
} as Plot;

const baseRun: Run = {
	id: "run-1",
	model: "auto",
	task: "do the thing",
} as Run;

describe("CursorAdapter", () => {
	it("exposes registry-grade metadata", () => {
		expect(cursorAdapter.name).toBe("cursor");
		expect(cursorAdapter.displayName).toMatch(/cursor/i);
		expect(cursorAdapter.supportsModels).toContain("auto");
		expect(cursorAdapter.defaultModel).toBe("auto");
	});

	it("builds a non-interactive command with model, cwd and prompt", () => {
		const spawn = cursorAdapter.buildCommand(plot, baseRun, "/cfg/mcp.json");
		expect(spawn.cmd).toBe("cursor-agent");
		expect(spawn.args).toContain("--print");
		expect(spawn.args).toContain("--force");
		expect(spawn.args).toContain("--model");
		expect(spawn.args).toContain("auto");
		expect(spawn.args).toContain("--cwd");
		expect(spawn.args).toContain("/tmp/wt");
		expect(spawn.args[spawn.args.length - 1]).toBe("do the thing");
		expect(spawn.env?.SETRA_AGENT).toBe("cursor");
	});

	it("falls back to defaultModel for unknown model ids", () => {
		const spawn = cursorAdapter.buildCommand(
			plot,
			{ ...baseRun, model: "made-up-model-9000" } as Run,
			"/cfg/mcp.json",
		);
		expect(spawn.args).toContain("auto");
		expect(spawn.args).not.toContain("made-up-model-9000");
	});

	it("honours system prompt injection via --system", () => {
		const args = cursorAdapter.buildSystemPromptArgs("be terse");
		expect(args).toEqual(["--system", "be terse"]);
	});

	it("does not pass an MCP CLI flag (cursor uses ~/.cursor/mcp.json)", () => {
		expect(cursorAdapter.buildMcpArgs("/cfg/mcp.json")).toEqual([]);
	});

	it("parses tokens and cost from cursor output", () => {
		const out = "tokens: input 1,234 / output 567\ncost: $0.0089\nDone.";
		expect(cursorAdapter.parseTokenUsage(out)).toEqual({
			promptTokens: 1234,
			completionTokens: 567,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		expect(cursorAdapter.parseCostUSD(out)).toBeCloseTo(0.0089, 4);
	});

	it("detects rate-limit and completion signals", () => {
		expect(cursorAdapter.detectRateLimit("Error 429: Too Many Requests")).toBe(true);
		expect(cursorAdapter.detectRateLimit("ok")).toBe(false);
		expect(cursorAdapter.detectCompletion("Task complete.")).toBe(true);
	});

	it("instantiates without args", () => {
		const a = new CursorAdapter();
		expect(a.name).toBe("cursor");
	});
});
