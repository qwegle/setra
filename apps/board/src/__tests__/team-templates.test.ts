import { describe, expect, it } from "vitest";
import { ADAPTERS, TEAM_TEMPLATES } from "../lib/team-templates";

describe("team templates — auto-adapter defaults", () => {
	it("every preset agent uses adapter:'auto' (no hardcoded provider)", () => {
		const offenders: string[] = [];
		for (const tpl of TEAM_TEMPLATES) {
			for (const a of tpl.agents) {
				if (a.adapter !== "auto") {
					offenders.push(`${tpl.id}/${a.name} → ${a.adapter}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("ADAPTERS list begins with the 'auto' option", () => {
		expect(ADAPTERS[0]?.id).toBe("auto");
		expect(ADAPTERS[0]?.recommended).toBe(true);
	});

	it("only the 'auto' entry is marked recommended (one canonical default)", () => {
		const recommended = ADAPTERS.filter((a) => a.recommended).map((a) => a.id);
		expect(recommended).toEqual(["auto"]);
	});
});
