import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the YAML parser so skills tests don't need to install yaml in test context
// (yaml is a real dep, but we want to isolate loader logic)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeSkillFile(dir: string, filename: string, content: string): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, filename), content, "utf-8");
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "setra-skills-"));
	vi.resetModules(); // ensure fresh cache per test
});

afterEach(() => {
	vi.resetModules();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── loadSkills ───────────────────────────────────────────────────────────────

describe("loadSkills", () => {
	it("returns 14 builtin skills", async () => {
		const { loadSkills } = await import("../loader.js");
		// Use a unique non-existent cwd so no custom skills load
		const skills = loadSkills(path.join(tmpDir, "empty-project"));
		const builtins = skills.filter((s) => s.source === "builtin");
		expect(builtins).toHaveLength(14);
	});

	it("builtin skill code-review has correct template", async () => {
		const { loadSkills } = await import("../loader.js");
		const skills = loadSkills(path.join(tmpDir, "empty-project-2"));
		const codeReview = skills.find((s) => s.id === "code-review");
		expect(codeReview).toBeDefined();
		expect(codeReview?.template).toContain("$scope");
		expect(codeReview?.template).toContain("$severity");
		expect(codeReview?.modelHint).toBe("claude-opus-4");
	});

	it("loads custom skill from filesystem", async () => {
		const { loadSkills } = await import("../loader.js");
		const projectSkillsDir = path.join(tmpDir, "proj", ".setra", "skills");
		writeSkillFile(
			projectSkillsDir,
			"my-skill.md",
			[
				"---",
				"name: My Custom Skill",
				"description: A custom skill for testing",
				"aliases:",
				"  - custom",
				"  - my",
				"modelHint: claude-haiku-4",
				"tags:",
				"  - test",
				"---",
				"Custom skill template: $param",
			].join("\n"),
		);

		const skills = loadSkills(path.join(tmpDir, "proj"));
		const custom = skills.find((s) => s.id === "my-skill");
		expect(custom).toBeDefined();
		expect(custom?.source).toBe("project");
		expect(custom?.name).toBe("My Custom Skill");
		expect(custom?.modelHint).toBe("claude-haiku-4");
		expect(custom?.aliases).toContain("custom");
	});

	it("project skill overrides global skill with same id", async () => {
		const { loadSkills } = await import("../loader.js");
		// Write a project skill with id 'debug' (same as a builtin)
		const projectSkillsDir = path.join(tmpDir, "proj2", ".setra", "skills");
		writeSkillFile(
			projectSkillsDir,
			"debug.md",
			[
				"---",
				"name: Custom Debug",
				"description: Overrides the builtin debug skill",
				"tags: []",
				"---",
				"Custom debug template: $error",
			].join("\n"),
		);

		const skills = loadSkills(path.join(tmpDir, "proj2"));
		const debugSkill = skills.find((s) => s.id === "debug");
		expect(debugSkill).toBeDefined();
		expect(debugSkill?.source).toBe("project");
		expect(debugSkill?.name).toBe("Custom Debug");

		// There should only be ONE 'debug' skill (project overrides builtin)
		const allDebug = skills.filter((s) => s.id === "debug");
		expect(allDebug).toHaveLength(1);
	});

	it("total count = builtins + custom (no overlap)", async () => {
		const { loadSkills } = await import("../loader.js");
		const projectSkillsDir = path.join(tmpDir, "proj3", ".setra", "skills");
		writeSkillFile(
			projectSkillsDir,
			"brand-new.md",
			[
				"---",
				"name: Brand New Skill",
				"description: A completely new skill",
				"tags: []",
				"---",
				"Brand new template: $input",
			].join("\n"),
		);

		const skills = loadSkills(path.join(tmpDir, "proj3"));
		// 14 builtins + 1 project = 15
		expect(skills.length).toBe(15);
	});
});

// ─── renderSkill ──────────────────────────────────────────────────────────────

describe("renderSkill", () => {
	it("substitutes $param with value", async () => {
		const { renderSkill } = await import("../renderer.js");
		const skill = {
			id: "test",
			name: "Test",
			description: "",
			aliases: [],
			inputSchema: { target: "string" },
			tags: [],
			template: "Review $target for issues",
			source: "builtin" as const,
		};
		const result = renderSkill(skill, { target: "src/auth.ts" });
		expect(result.prompt).toBe("Review src/auth.ts for issues");
	});

	it("leaves $param as-is when arg missing (warns)", async () => {
		const { renderSkill } = await import("../renderer.js");
		const writeSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		const skill = {
			id: "test",
			name: "Test",
			description: "",
			aliases: [],
			inputSchema: { target: "string — the target" },
			tags: [],
			template: "Review $target for issues",
			source: "builtin" as const,
		};
		const result = renderSkill(skill, {});
		// $target remains unsubstituted (no value provided)
		expect(result.prompt).toBe("Review $target for issues");
		// A warning should have been written
		expect(writeSpy).toHaveBeenCalledWith(
			expect.stringContaining('missing arg "target"'),
		);
		writeSpy.mockRestore();
	});

	it("handles multiple params", async () => {
		const { renderSkill } = await import("../renderer.js");
		const skill = {
			id: "test",
			name: "Test",
			description: "",
			aliases: [],
			inputSchema: { scope: "string", severity: "string" },
			tags: [],
			template: "Review $scope with severity $severity",
			source: "builtin" as const,
		};
		const result = renderSkill(skill, { scope: "src/", severity: "high" });
		expect(result.prompt).toBe("Review src/ with severity high");
	});

	it("returns correct modelHint", async () => {
		const { renderSkill } = await import("../renderer.js");
		const skill = {
			id: "test",
			name: "Test",
			description: "",
			aliases: [],
			inputSchema: {},
			tags: [],
			template: "Do something",
			modelHint: "claude-opus-4",
			source: "builtin" as const,
		};
		const result = renderSkill(skill, {});
		expect(result.modelHint).toBe("claude-opus-4");
	});

	it("does not set modelHint when skill has none", async () => {
		const { renderSkill } = await import("../renderer.js");
		const skill = {
			id: "test",
			name: "Test",
			description: "",
			aliases: [],
			inputSchema: {},
			tags: [],
			template: "Do something",
			source: "builtin" as const,
		};
		const result = renderSkill(skill, {});
		expect(result.modelHint).toBeUndefined();
	});

	it("substitutes the same param appearing multiple times", async () => {
		const { renderSkill } = await import("../renderer.js");
		const skill = {
			id: "test",
			name: "Test",
			description: "",
			aliases: [],
			inputSchema: { name: "string" },
			tags: [],
			template: "Hello $name, how are you $name?",
			source: "builtin" as const,
		};
		const result = renderSkill(skill, { name: "Alice" });
		expect(result.prompt).toBe("Hello Alice, how are you Alice?");
	});
});
