import { describe, expect, it } from "vitest";

import { resolveRunWorktree } from "../lib/run-worktree.js";

describe("resolveRunWorktree", () => {
	it("places worktrees under <dataDir>/run-worktrees/<projectSlug>/<runId>", () => {
		const layout = resolveRunWorktree(
			{ runId: "abc123", projectSlug: "my-project" },
			"/data",
		);
		expect(layout.directory).toBe("/data/run-worktrees/my-project/abc123");
		expect(layout.branchName).toBe("setra/run-abc123");
	});

	it("sanitises unsafe characters from project slug and run id", () => {
		const layout = resolveRunWorktree(
			{ runId: "RUN/With Spaces!", projectSlug: "Cool Project" },
			"/data",
		);
		expect(layout.directory).toBe(
			"/data/run-worktrees/cool-project/run-with-spaces",
		);
		expect(layout.branchName).toBe("setra/run-run-with-spaces");
	});

	it("falls back to default slugs when sanitisation produces empty", () => {
		const layout = resolveRunWorktree(
			{ runId: "!!!", projectSlug: "@@@" },
			"/data",
		);
		expect(layout.directory).toBe("/data/run-worktrees/default/unknown");
	});

	it("uses SETRA_DATA_DIR when no explicit dir is passed", () => {
		const orig = process.env.SETRA_DATA_DIR;
		process.env.SETRA_DATA_DIR = "/tmp/setra-test-data";
		const layout = resolveRunWorktree({
			runId: "r1",
			projectSlug: "p1",
		});
		expect(layout.directory).toBe("/tmp/setra-test-data/run-worktrees/p1/r1");
		if (orig !== undefined) process.env.SETRA_DATA_DIR = orig;
		else delete process.env.SETRA_DATA_DIR;
	});
});
