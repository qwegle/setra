import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { selectToolsForMember } from "@setra/company/mcp-tools";

const tmpDir = mkdtempSync(join(tmpdir(), "setra-mcp-scoping-"));
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_DATA = process.env.SETRA_DATA_DIR;

beforeAll(() => {
	process.env.HOME = tmpDir;
	process.env.SETRA_DATA_DIR = tmpDir;
});

afterAll(() => {
	if (ORIGINAL_HOME !== undefined) process.env.HOME = ORIGINAL_HOME;
	if (ORIGINAL_DATA !== undefined) process.env.SETRA_DATA_DIR = ORIGINAL_DATA;
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("selectToolsForMember", () => {
	it("returns the full surface for the lead", () => {
		const tools = selectToolsForMember({
			isLead: true,
			worktreeIsolation: false,
		});
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.map((t) => t.name)).toContain("team_runtime_state");
	});

	it("returns the full surface for an isolated coding member", () => {
		const tools = selectToolsForMember({
			isLead: false,
			worktreeIsolation: true,
		});
		expect(tools.length).toBeGreaterThan(0);
	});

	it("returns the minimal surface for a non-isolated, non-lead member", () => {
		const tools = selectToolsForMember({
			isLead: false,
			worktreeIsolation: false,
		});
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.map((t) => t.name)).not.toContain("team_runtime_state");
	});

	it("honours customAllowList over role defaults (lead with shrunk surface)", () => {
		const tools = selectToolsForMember({
			isLead: true,
			worktreeIsolation: false,
			customAllowList: ["team_broadcast"],
		});
		expect(tools.map((t) => t.name)).toEqual(["team_broadcast"]);
	});

	it("filters unknown tool names out of customAllowList", () => {
		const tools = selectToolsForMember({
			isLead: false,
			worktreeIsolation: true,
			customAllowList: ["team_broadcast", "totally_made_up_tool"],
		});
		expect(tools.map((t) => t.name)).toEqual(["team_broadcast"]);
	});

	it("falls back to role defaults if customAllowList intersects to nothing", () => {
		const tools = selectToolsForMember({
			isLead: false,
			worktreeIsolation: true,
			customAllowList: ["totally_made_up_tool"],
		});
		expect(tools.length).toBeGreaterThan(1);
	});
});
