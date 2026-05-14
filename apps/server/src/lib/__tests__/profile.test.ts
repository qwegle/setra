import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Redirect ~ so the profile file lands in an isolated temp dir.
const tmpHome = mkdtempSync(join(tmpdir(), "setra-profile-test-"));
const originalHome = process.env.HOME;
beforeAll(() => {
	process.env.HOME = tmpHome;
});
afterAll(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	rmSync(tmpHome, { recursive: true, force: true });
});

async function load() {
	const mod = await import("../profile.js");
	return mod;
}

describe("profile", () => {
	it("returns an empty profile when no file exists", async () => {
		const { loadProfile } = await load();
		const p = loadProfile();
		expect(p.preferences).toEqual([]);
		expect(p.style).toEqual([]);
		expect(p.context).toEqual([]);
	});

	it("merges, deduplicates, and scrubs secrets on update", async () => {
		const { updateProfile, loadProfile } = await load();
		updateProfile({
			preferences: ["Always use TypeScript strict mode"],
			context: ["This repo uses pnpm workspaces"],
			displayName: "Nitikesh",
			preferredCli: "claude",
		});
		updateProfile({
			preferences: [
				"Always use TypeScript strict mode", // duplicate
				"Token sk-abc123def456ghi789jkl012mno should leak", // contains secret
			],
		});
		const p = loadProfile();
		expect(p.displayName).toBe("Nitikesh");
		expect(p.preferredCli).toBe("claude");
		expect(p.preferences).toHaveLength(2);
		const leaked = p.preferences.find((f) => f.includes("Token"));
		expect(leaked).toBeDefined();
		expect(leaked).not.toContain("sk-abc123");
		expect(leaked).toContain("[redacted]");
	});

	it("builds an Operator Profile section that omits when empty", async () => {
		const { buildOperatorProfileSection } = await load();
		const section = buildOperatorProfileSection();
		expect(section).toContain("Operator Profile");
		expect(section).toContain("Nitikesh");
	});

	it("distills preferences and context from a run transcript", async () => {
		const { distillProfileFromRun } = await load();
		const update = distillProfileFromRun({
			summary: "Finished refactor",
			userMessages: [
				"I prefer commits in conventional-commits format.",
				"We use pnpm for installs and Turbo for builds.",
				"random unrelated noise",
			],
		});
		expect(update.preferences?.[0]).toMatch(/conventional-commits/);
		expect(update.context?.[0]).toMatch(/pnpm/);
	});
});
