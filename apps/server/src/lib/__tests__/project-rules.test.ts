import { describe, expect, it } from "vitest";
import { type ProjectRule, getMatchingRules } from "../project-rules.js";

describe("getMatchingRules", () => {
	it("includes global rules and matching scoped rules", async () => {
		const rules: ProjectRule[] = [
			{
				name: "global.md",
				content: "# Global\n- Be concise",
			},
			{
				name: "testing.md",
				glob: "*.test.ts, __tests__/**",
				content: "# Testing\n- Use vitest",
			},
			{
				name: "api-standards.md",
				glob: "src/api/**",
				content: "# API\n- Validate inputs",
			},
		];

		const section = await getMatchingRules(rules, [
			"src/api/users.test.ts",
			"src/lib/util.ts",
		]);

		expect(section).toContain("## Project Rules");
		expect(section).toContain("### Global (always)");
		expect(section).toContain(
			"### Testing (matching: *.test.ts, __tests__/**)",
		);
		expect(section).toContain("### Api Standards (matching: src/api/**)");
		expect(section).toContain("Use vitest");
		expect(section).toContain("Validate inputs");
	});

	it("returns an empty string when nothing matches", async () => {
		const section = await getMatchingRules(
			[
				{
					name: "frontend.md",
					glob: "src/frontend/**",
					content: "# Frontend\n- Prefer components",
				},
			],
			["src/backend/service.ts"],
		);

		expect(section).toBe("");
	});
});
