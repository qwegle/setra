import { afterEach, describe, expect, it, test, vi } from "vitest";
import { withRetry } from "../retry.js";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("withRetry", () => {
	test.each([
		"429 Too Many Requests",
		"503 Service Unavailable",
		"socket closed: ECONNRESET",
	])("retries transient errors like %s", async (message) => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		let attempts = 0;

		const promise = withRetry(
			async () => {
				attempts += 1;
				if (attempts < 2) throw new Error(message);
				return "ok";
			},
			{ maxAttempts: 3, initialDelayMs: 10 },
		);

		await vi.runAllTimersAsync();
		await expect(promise).resolves.toBe("ok");
		expect(attempts).toBe(2);
	});

	test.each(["400 Bad Request", "401 Unauthorized", "404 Not Found"])(
		"does not retry client errors like %s",
		async (message) => {
			let attempts = 0;

			await expect(
				withRetry(async () => {
					attempts += 1;
					throw new Error(message);
				}),
			).rejects.toThrow(message);
			expect(attempts).toBe(1);
		},
	);

	it("respects maxAttempts", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		let attempts = 0;

		const promise = withRetry(
			async () => {
				attempts += 1;
				throw new Error("503 upstream unavailable");
			},
			{ maxAttempts: 3, initialDelayMs: 10 },
		);
		const assertion = expect(promise).rejects.toThrow(
			"503 upstream unavailable",
		);

		await vi.runAllTimersAsync();
		await assertion;
		expect(attempts).toBe(3);
	});

	it("uses exponential backoff delays", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const retryDelays: number[] = [];
		let attempts = 0;

		const promise = withRetry(
			async () => {
				attempts += 1;
				if (attempts < 3) throw new Error("429 rate limit");
				return "done";
			},
			{
				maxAttempts: 4,
				initialDelayMs: 10,
				backoffMultiplier: 2,
				onRetry: (_attempt, _error, delayMs) => retryDelays.push(delayMs),
			},
		);

		await vi.runAllTimersAsync();
		await expect(promise).resolves.toBe("done");
		expect(retryDelays).toHaveLength(2);
		expect(retryDelays[0]).toBeCloseTo(10, 5);
		expect(retryDelays[1]).toBeCloseTo(20, 5);
	});
});
