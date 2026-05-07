import { describe, expect, it } from "vitest";
import { COMPANY_TEMPLATES, getTemplate } from "../company-templates.js";

describe("COMPANY_TEMPLATES", () => {
	it("has 11 templates", () => {
		expect(COMPANY_TEMPLATES.length).toBe(11);
	});
});

describe("getTemplate", () => {
	it('getTemplate("starter") returns template with 3 members', () => {
		const t = getTemplate("starter");
		expect(t).toBeDefined();
		expect(t!.members.length).toBe(3);
	});

	it('getTemplate("gtm-sales") has 5 members with sales skills', () => {
		const t = getTemplate("gtm-sales");
		expect(t).toBeDefined();
		expect(t!.members.length).toBe(5);
		expect(t!.preSeededSkills.length).toBeGreaterThan(0);
		const skillNames = t!.preSeededSkills.map((s) => s.name);
		expect(skillNames).toContain("lead-qualify");
		expect(skillNames).toContain("outbound-email");
		expect(skillNames).toContain("sales-funnel-report");
	});

	it('getTemplate("governance-onprem") has all members using ollama model', () => {
		const t = getTemplate("governance-onprem");
		expect(t).toBeDefined();
		expect(t!.totalCostBudgetUsd).toBe(0);
		for (const m of t!.members) {
			expect(m.model).toMatch(/ollama/);
		}
	});

	it('getTemplate("nonexistent") returns undefined', () => {
		expect(getTemplate("nonexistent")).toBeUndefined();
	});

	it("new specialist templates exist", () => {
		expect(getTemplate("game-studio")).toBeDefined();
		expect(getTemplate("model-lab")).toBeDefined();
		expect(getTemplate("web3-protocol")).toBeDefined();
		expect(getTemplate("mobile-expo")).toBeDefined();
	});

	it("all templates have valid leadSlug that exists in members", () => {
		for (const t of COMPANY_TEMPLATES) {
			const slugs = t.members.map((m) => m.slug);
			expect(slugs).toContain(t.leadSlug);
		}
	});
});
