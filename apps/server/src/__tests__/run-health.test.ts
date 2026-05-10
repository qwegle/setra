import { describe, expect, it } from "vitest";
import {
	RUN_HEALTH_DEAD_MS,
	RUN_HEALTH_STALLED_MS,
	RUN_HEALTH_STUCK_MS,
	classifyRunHealth,
} from "../lib/run-health.js";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");

function isoAgo(ms: number): string {
	return new Date(NOW - ms).toISOString();
}

describe("classifyRunHealth", () => {
	it("returns done for terminal statuses regardless of timestamps", () => {
		for (const status of [
			"success",
			"completed",
			"failed",
			"cancelled",
			"canceled",
			"blocked",
		]) {
			expect(classifyRunHealth({ status, updatedAt: isoAgo(0) }, NOW)).toBe(
				"done",
			);
		}
	});

	it("returns active when heartbeat is fresh", () => {
		expect(
			classifyRunHealth({ status: "running", updatedAt: isoAgo(1_000) }, NOW),
		).toBe("active");
	});

	it("returns stuck just past the 90s threshold", () => {
		expect(
			classifyRunHealth(
				{ status: "running", updatedAt: isoAgo(RUN_HEALTH_STUCK_MS + 1) },
				NOW,
			),
		).toBe("stuck");
	});

	it("returns stalled just past the 5m threshold", () => {
		expect(
			classifyRunHealth(
				{ status: "running", updatedAt: isoAgo(RUN_HEALTH_STALLED_MS + 1) },
				NOW,
			),
		).toBe("stalled");
	});

	it("returns dead just past the 10m threshold", () => {
		expect(
			classifyRunHealth(
				{ status: "running", updatedAt: isoAgo(RUN_HEALTH_DEAD_MS + 1) },
				NOW,
			),
		).toBe("dead");
	});

	it("falls back to startedAt when updatedAt is null", () => {
		expect(
			classifyRunHealth(
				{
					status: "running",
					updatedAt: null,
					startedAt: isoAgo(RUN_HEALTH_STUCK_MS + 1_000),
				},
				NOW,
			),
		).toBe("stuck");
	});

	it("returns active when no timestamps are available (just-started run)", () => {
		expect(
			classifyRunHealth(
				{ status: "running", updatedAt: null, startedAt: null },
				NOW,
			),
		).toBe("active");
	});

	it("treats unparseable heartbeats as fresh rather than crashing", () => {
		expect(
			classifyRunHealth({ status: "running", updatedAt: "not-a-date" }, NOW),
		).toBe("active");
	});
});
