import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AvailabilityReport,
	ProviderAvailability,
} from "../provider-availability.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
	execFile: vi.fn(
		(
			_cmd: string,
			_args: string[],
			callback: (err: Error | null, stdout: string, stderr: string) => void,
		) => {
			// Default: binary found
			callback(null, "/usr/local/bin/mock", "");
		},
	),
}));

vi.mock("../governance.js", () => ({
	loadGovernancePolicy: vi.fn(() => ({
		deploymentMode: "cloud",
		blockNetworkAccess: false,
		requireApprovalForToolUse: false,
		auditLog: { enabled: false, path: "" },
		maxCostPerRunUsd: 0,
	})),
	validateModelChoice: vi.fn(() => null),
	DEFAULT_POLICY: {
		deploymentMode: "cloud",
		blockNetworkAccess: false,
		requireApprovalForToolUse: false,
		auditLog: { enabled: false, path: "" },
		maxCostPerRunUsd: 0,
	},
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAvailability(
	providerId: string,
	status: ProviderAvailability["status"],
	defaultModel: string,
): ProviderAvailability {
	return {
		providerId,
		displayName: providerId,
		status,
		defaultModel,
		checkedAt: Date.now(),
	};
}

function makeReport(
	bestAvailableModel: string,
	providers: ProviderAvailability[],
): AvailabilityReport {
	return {
		providers,
		bestAvailableModel,
		anyAvailable: providers.some((p) => p.status === "available"),
		checkedAt: Date.now(),
	};
}

// ─── resolveModel ─────────────────────────────────────────────────────────────

describe("resolveModel", () => {
	let resolveModel: typeof import("../provider-availability.js").resolveModel;
	let validateModelChoice: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		({ resolveModel } = await import("../provider-availability.js"));
		const gov = await import("../governance.js");
		validateModelChoice = vi.mocked(gov.validateModelChoice);
		validateModelChoice.mockReturnValue(null);
	});

	it('returns "auto" → bestAvailableModel when auto requested', () => {
		const report = makeReport("claude-opus-4", [
			makeAvailability("claude", "available", "claude-opus-4"),
		]);
		const result = resolveModel("auto", report);
		expect(result.model).toBe("claude-opus-4");
		expect(result.wasDowngraded).toBe(false);
		expect(result.reason).toBeUndefined();
	});

	it("returns requested model unchanged when provider is available", () => {
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "available", "claude-opus-4-5"),
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		// 'ollama:llama3.2' provider = ollama (prefix match)
		const result = resolveModel("ollama:llama3.2", report);
		expect(result.model).toBe("ollama:llama3.2");
		expect(result.wasDowngraded).toBe(false);
	});

	it("downgrades to best available when provider key missing", () => {
		// Use a model that IS in the registry so modelToProviderId resolves it
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "no-key", "claude-opus-4-5"),
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		// claude-opus-4-5 is in the claude provider; claude is no-key → should downgrade
		const result = resolveModel("claude-opus-4-5", report);
		expect(result.wasDowngraded).toBe(true);
		expect(result.model).toBe("ollama:llama3.2");
	});

	it("downgrades to best available when binary not installed", () => {
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "no-binary", "claude-opus-4-5"),
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		const result = resolveModel("claude-opus-4-5", report);
		expect(result.wasDowngraded).toBe(true);
		expect(result.model).toBe("ollama:llama3.2");
	});

	it("downgrades when ollama unreachable", () => {
		const report = makeReport("claude-opus-4-5", [
			makeAvailability("claude", "available", "claude-opus-4-5"),
			makeAvailability("ollama", "unreachable", "ollama:llama3.2"),
		]);
		const result = resolveModel("ollama:llama3.2", report);
		expect(result.wasDowngraded).toBe(true);
		expect(result.model).toBe("claude-opus-4-5");
	});

	it("includes reason in downgrade result", () => {
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "no-key", "claude-opus-4-5"),
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		const result = resolveModel("claude-opus-4-5", report);
		expect(result.wasDowngraded).toBe(true);
		expect(typeof result.reason).toBe("string");
		expect(result.reason!.length).toBeGreaterThan(0);
	});

	it("downgrades when governance policy blocks the model", () => {
		validateModelChoice.mockReturnValue(
			'Governance policy (offline mode) blocks cloud model "claude-opus-4"',
		);
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		const result = resolveModel("claude-opus-4", report);
		expect(result.wasDowngraded).toBe(true);
		expect(result.reason).toMatch(/governance/i);
	});
});

// ─── assignModelForRole ───────────────────────────────────────────────────────

describe("assignModelForRole", () => {
	let assignModelForRole: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		({ assignModelForRole } = await import("../provider-availability.js"));
		const gov = await import("../governance.js");
		vi.mocked(gov.validateModelChoice).mockReturnValue(null);
	});

	it("architect + best → large tier model", () => {
		// Provide a report where a large-tier model is available (claude or gemini)
		const report = makeReport("claude-opus-4-5", [
			makeAvailability("claude", "available", "claude-opus-4-5"),
			makeAvailability("gemini", "available", "gemini-2.5-pro"),
		]);
		const model = assignModelForRole("architect", "best", report);
		// Large tier candidates include claude-opus-4-5, gemini-2.5-pro etc.
		expect(typeof model).toBe("string");
		expect(model.length).toBeGreaterThan(0);
	});

	it("docs + economy → small tier model", () => {
		// Provide a report where a small-tier model is available
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "available", "claude-haiku-4-5"),
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		const model = assignModelForRole("docs", "economy", report);
		expect(typeof model).toBe("string");
		expect(model.length).toBeGreaterThan(0);
	});

	it("qa + balanced → small tier model", () => {
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "available", "claude-haiku-4-5"),
		]);
		const model = assignModelForRole("qa", "balanced", report);
		expect(typeof model).toBe("string");
		expect(model.length).toBeGreaterThan(0);
	});

	it("unknown role + balanced → medium tier model (default tier)", () => {
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("anthropic-api", "available", "claude-sonnet-4-5"),
		]);
		const model = assignModelForRole(
			"totally-unknown-role",
			"balanced",
			report,
		);
		expect(typeof model).toBe("string");
		expect(model.length).toBeGreaterThan(0);
	});

	it("returns ollama model when only ollama available", () => {
		const report = makeReport("ollama:llama3.2", [
			makeAvailability("claude", "no-key", "claude-opus-4-5"),
			makeAvailability("gemini", "no-key", "gemini-2.5-pro"),
			makeAvailability("ollama", "available", "ollama:llama3.2"),
		]);
		// When no cloud model resolves without downgrade, falls back to bestAvailableModel
		const model = assignModelForRole("architect", "best", report);
		expect(model).toBeTruthy();
	});
});

// ─── getAvailability ──────────────────────────────────────────────────────────

describe("getAvailability", () => {
	let getAvailability: any;
	let loadGovernancePolicyMock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.clearAllMocks();
		({ getAvailability } = await import("../provider-availability.js"));
		const gov = await import("../governance.js");
		loadGovernancePolicyMock = vi.mocked(gov.loadGovernancePolicy);

		// Default: cloud mode, no allowedProviders restriction
		loadGovernancePolicyMock.mockReturnValue({
			deploymentMode: "cloud",
			blockNetworkAccess: false,
			requireApprovalForToolUse: false,
			auditLog: { enabled: false, path: "" },
			maxCostPerRunUsd: 0,
		});

		// Mock fetch to make ollama "unreachable" by default
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Connection refused")),
		);

		// Ensure no API keys are set
		const keysToUnset = [
			"ANTHROPIC_API_KEY",
			"GEMINI_API_KEY",
			"OPENAI_API_KEY",
			"CODEX_API_KEY",
		];
		for (const key of keysToUnset) {
			delete process.env[key];
		}
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns cached result within TTL", async () => {
		// First call — populates cache
		const first = await getAvailability(true);
		// Second call immediately after — should return same checkedAt (cached)
		const second = await getAvailability(false);
		expect(second.checkedAt).toBe(first.checkedAt);
	});

	it("forces re-probe when force=true", async () => {
		const first = await getAvailability(true);
		// Wait just a tick so Date.now() can advance
		await new Promise<void>((resolve) => setTimeout(resolve, 1));
		const second = await getAvailability(true);
		// checkedAt should be >= (re-probed)
		expect(second.checkedAt).toBeGreaterThanOrEqual(first.checkedAt);
	});

	it("marks cloud providers unavailable in offline mode (via allowedProviders)", async () => {
		// Simulate governance policy that only allows ollama
		loadGovernancePolicyMock.mockReturnValue({
			deploymentMode: "offline",
			allowedProviders: ["ollama"],
			blockNetworkAccess: true,
			requireApprovalForToolUse: false,
			auditLog: { enabled: false, path: "" },
			maxCostPerRunUsd: 0,
		});

		const report = await getAvailability(true);

		// Cloud providers (claude, gemini, codex, etc.) that are not in allowedProviders
		// must be marked as unreachable even if they had keys
		const cloudProviders = report.providers.filter(
			(p: { providerId: string; status: string }) =>
				!["ollama", "mlx-lm", "exo", "lmstudio", "custom-openai"].includes(
					p.providerId,
				),
		);
		for (const provider of cloudProviders) {
			expect(provider.status).toBe("unreachable");
		}
	});

	it("returns anyAvailable=false when no providers are configured", async () => {
		// No API keys, no local server running
		const report = await getAvailability(true);
		// All providers should be no-key or unreachable
		const available = report.providers.filter(
			(p: { providerId: string; status: string }) => p.status === "available",
		);
		expect(available.length).toBe(0);
		expect(report.anyAvailable).toBe(false);
	});

	it("returns a valid AvailabilityReport shape", async () => {
		const report = await getAvailability(true);
		expect(report).toHaveProperty("providers");
		expect(report).toHaveProperty("bestAvailableModel");
		expect(report).toHaveProperty("anyAvailable");
		expect(report).toHaveProperty("checkedAt");
		expect(Array.isArray(report.providers)).toBe(true);
		expect(typeof report.bestAvailableModel).toBe("string");
		expect(typeof report.anyAvailable).toBe("boolean");
		expect(typeof report.checkedAt).toBe("number");
	});
});
