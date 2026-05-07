import { beforeEach, describe, expect, it } from "vitest";

/**
 * Auto-onboarding gate logic.
 *
 * AppShell triggers the OnboardingWizard when:
 *   - the user has zero companies, AND
 *   - the wizard isn't already open, AND
 *   - the user hasn't dismissed it before (localStorage flag).
 *
 * That decision is small and deserves its own pure function so we can
 * test it independently of React. The logic mirrors AppShell.tsx.
 */

const ONBOARDING_DISMISSED_KEY = "setra:onboarding_dismissed";

interface Args {
	companyCount: number;
	alreadyOpen: boolean;
	dismissed: boolean;
}

function shouldAutoOpenOnboarding(args: Args): boolean {
	if (args.companyCount > 0) return false;
	if (args.alreadyOpen) return false;
	if (args.dismissed) return false;
	return true;
}

// The localStorage adapter the real component uses.
function isDismissed(storage: { getItem(k: string): string | null }): boolean {
	return storage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
}

function markDismissed(storage: { setItem(k: string, v: string): void }): void {
	storage.setItem(ONBOARDING_DISMISSED_KEY, "1");
}

describe("auto-onboarding gate", () => {
	it("opens on first launch — no companies, no dismissal, not already open", () => {
		expect(
			shouldAutoOpenOnboarding({
				companyCount: 0,
				alreadyOpen: false,
				dismissed: false,
			}),
		).toBe(true);
	});

	it("does not open if user has at least one company", () => {
		expect(
			shouldAutoOpenOnboarding({
				companyCount: 1,
				alreadyOpen: false,
				dismissed: false,
			}),
		).toBe(false);
	});

	it("does not re-open if the wizard is already on screen", () => {
		expect(
			shouldAutoOpenOnboarding({
				companyCount: 0,
				alreadyOpen: true,
				dismissed: false,
			}),
		).toBe(false);
	});

	it("does not re-open after the user dismissed once", () => {
		expect(
			shouldAutoOpenOnboarding({
				companyCount: 0,
				alreadyOpen: false,
				dismissed: true,
			}),
		).toBe(false);
	});

	describe("dismissal persistence (mock localStorage)", () => {
		let store: Record<string, string>;
		let storage: {
			getItem(k: string): string | null;
			setItem(k: string, v: string): void;
		};

		beforeEach(() => {
			store = {};
			storage = {
				getItem: (k) => (k in store ? (store[k] ?? null) : null),
				setItem: (k, v) => {
					store[k] = v;
				},
			};
		});

		it("isDismissed reads the flag", () => {
			expect(isDismissed(storage)).toBe(false);
			store[ONBOARDING_DISMISSED_KEY] = "1";
			expect(isDismissed(storage)).toBe(true);
		});

		it("markDismissed writes the flag", () => {
			markDismissed(storage);
			expect(store[ONBOARDING_DISMISSED_KEY]).toBe("1");
		});

		it("once marked, gate stays closed even with zero companies", () => {
			markDismissed(storage);
			expect(
				shouldAutoOpenOnboarding({
					companyCount: 0,
					alreadyOpen: false,
					dismissed: isDismissed(storage),
				}),
			).toBe(false);
		});
	});
});
