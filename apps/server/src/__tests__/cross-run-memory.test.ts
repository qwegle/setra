import { describe, expect, it, vi } from "vitest";
import { findPriorRunPrs } from "../lib/cross-run-memory.js";

function mockFetchOnce(data: unknown, ok = true, status = 200) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok,
		status,
		json: async () => data,
	} as Response);
	(globalThis as unknown as { fetch: typeof fetch }).fetch =
		fetchMock as unknown as typeof fetch;
	return fetchMock;
}

const FIXTURE_PRS = [
	{
		number: 12,
		html_url: "https://github.com/o/r/pull/12",
		title: "[setra] eng run 0001",
		merged_at: "2024-01-01T00:00:00Z",
		head: { ref: "setra/run-0001" },
		labels: [{ name: "auth" }],
	},
	{
		number: 13,
		html_url: "https://github.com/o/r/pull/13",
		title: "[setra] eng run 0002 fix billing crash",
		merged_at: "2024-01-02T00:00:00Z",
		head: { ref: "setra/run-0002" },
		labels: [],
	},
	{
		number: 14,
		html_url: "https://github.com/o/r/pull/14",
		title: "manual hotfix",
		merged_at: "2024-01-03T00:00:00Z",
		head: { ref: "hotfix/x" },
		labels: [],
	},
];

describe("findPriorRunPrs", () => {
	it("returns only setra/run-* PRs and parses the runId", async () => {
		mockFetchOnce(FIXTURE_PRS);
		const result = await findPriorRunPrs({
			repoUrl: "github.com/o/r",
			token: "tok",
		});
		expect(result).toHaveLength(2);
		expect(result.map((p) => p.runId)).toEqual(["0001", "0002"]);
		expect(result[0]?.labels).toContain("auth");
	});

	it("filters by component label first", async () => {
		mockFetchOnce(FIXTURE_PRS);
		const result = await findPriorRunPrs({
			repoUrl: "github.com/o/r",
			token: "tok",
			component: "auth",
		});
		expect(result).toHaveLength(1);
		expect(result[0]?.prNumber).toBe(12);
	});

	it("falls back to title substring match for component", async () => {
		mockFetchOnce(FIXTURE_PRS);
		const result = await findPriorRunPrs({
			repoUrl: "github.com/o/r",
			token: "tok",
			component: "billing",
		});
		expect(result).toHaveLength(1);
		expect(result[0]?.prNumber).toBe(13);
	});

	it("rejects invalid repo URLs", async () => {
		await expect(
			findPriorRunPrs({ repoUrl: "not-a-url", token: "tok" }),
		).rejects.toThrow(/Invalid GitHub/);
	});

	it("throws when GitHub returns a non-OK response", async () => {
		mockFetchOnce({}, false, 401);
		await expect(
			findPriorRunPrs({ repoUrl: "github.com/o/r", token: "tok" }),
		).rejects.toThrow(/GitHub PR list failed/);
	});
});
