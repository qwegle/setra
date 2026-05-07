import { describe, expect, it } from "vitest";
import type { RosterEntry } from "../lib/api";
import {
	H_GAP,
	NODE_W,
	buildForest,
	computeSubtreeWidth,
	flatten,
	layoutSubtree,
} from "../lib/org-tree-layout";

function entry(id: string, parent: string | null, name = id): RosterEntry {
	return {
		id,
		agent_id: id,
		display_name: name,
		reports_to: parent,
		is_active: 1,
		hired_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		template_id: "t",
		template_name: "engineer",
		description: null,
		agent: "claude",
		model: "claude-3-5-sonnet",
		estimated_cost_tier: "low",
		is_builtin: 0,
		runtime_status: null,
		paused_reason: null,
		adapter_type: null,
		model_id: null,
	};
}

describe("org-tree layout", () => {
	it("buildForest treats null parents and unknown parents as roots", () => {
		const a = entry("a", null);
		const b = entry("b", "missing");
		const c = entry("c", "a");
		const roots = buildForest([a, b, c]);
		expect(roots.map((r) => r.entry.id).sort()).toEqual(["a", "b"]);
		const aRoot = roots.find((r) => r.entry.id === "a");
		expect(aRoot).toBeDefined();
		if (!aRoot) throw new Error("expected root 'a'");
		expect(aRoot.children.map((n) => n.entry.id)).toEqual(["c"]);
	});

	it("computeSubtreeWidth: leaf = NODE_W, parent expands to fit children", () => {
		const root = entry("r", null);
		const c1 = entry("c1", "r");
		const c2 = entry("c2", "r");
		const [tree] = buildForest([root, c1, c2]);
		expect(tree).toBeDefined();
		if (!tree) throw new Error("expected tree");
		const w = computeSubtreeWidth(tree);
		expect(w).toBe(NODE_W * 2 + H_GAP);
	});

	it("layoutSubtree: parent x-centered above its 2 children", () => {
		const root = entry("r", null);
		const c1 = entry("c1", "r");
		const c2 = entry("c2", "r");
		const [tree] = buildForest([root, c1, c2]);
		expect(tree).toBeDefined();
		if (!tree) throw new Error("expected tree");
		computeSubtreeWidth(tree);
		layoutSubtree(tree, 0, 0);
		const all = flatten([tree]);
		const r = all.find((n) => n.entry.id === "r");
		const a = all.find((n) => n.entry.id === "c1");
		const b = all.find((n) => n.entry.id === "c2");
		expect(r).toBeDefined();
		expect(a).toBeDefined();
		expect(b).toBeDefined();
		if (!r || !a || !b) throw new Error("expected r/c1/c2 nodes");
		expect(r.x + NODE_W / 2).toBeCloseTo(
			(a.x + NODE_W / 2 + b.x + NODE_W / 2) / 2,
		);
		expect(a.y).toBeGreaterThan(r.y);
		expect(b.y).toBe(a.y);
	});

	it("flatten covers every node exactly once", () => {
		const nodes = [
			entry("a", null),
			entry("b", "a"),
			entry("c", "a"),
			entry("d", "b"),
			entry("e", "b"),
			entry("f", "c"),
		];
		const roots = buildForest(nodes);
		for (const r of roots) computeSubtreeWidth(r);
		for (const r of roots) layoutSubtree(r, 0, 0);
		const all = flatten(roots);
		expect(new Set(all.map((n) => n.entry.id))).toEqual(
			new Set(["a", "b", "c", "d", "e", "f"]),
		);
	});

	it("handles empty input", () => {
		expect(buildForest([])).toEqual([]);
		expect(flatten([])).toEqual([]);
	});
});
