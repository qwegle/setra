import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: Database.Database;

function createDb(): Database.Database {
	return new Database(":memory:");
}

async function loadQueueModule() {
	vi.resetModules();
	vi.doMock("@setra/db", () => ({
		getRawDb: () => db,
	}));
	return import("../queue.js");
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 1500,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for queue state");
}

beforeEach(() => {
	db = createDb();
});

afterEach(() => {
	db.close();
	vi.restoreAllMocks();
});

describe("jobQueue", () => {
	it("processes jobs in priority order", async () => {
		const { jobQueue } = await loadQueueModule();
		const order: string[] = [];

		jobQueue.process("wake", async (job) => {
			order.push(job.payload.name as string);
			return job.payload.name;
		});
		jobQueue.add("wake", { name: "low" }, { priority: 5 });
		jobQueue.add("wake", { name: "high" }, { priority: 1 });

		await waitFor(() => jobQueue.getStats().completed === 2);
		expect(order).toEqual(["high", "low"]);
	});

	it("respects the configured concurrency limit", async () => {
		const { jobQueue } = await loadQueueModule();
		(jobQueue as unknown as { maxConcurrency: number }).maxConcurrency = 1;
		let active = 0;
		let maxSeen = 0;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		jobQueue.process("wake", async () => {
			active += 1;
			maxSeen = Math.max(maxSeen, active);
			await gate;
			active -= 1;
			return { ok: true };
		});
		jobQueue.add("wake", { name: "first" }, { priority: 1 });
		jobQueue.add("wake", { name: "second" }, { priority: 2 });

		await waitFor(
			() =>
				jobQueue.getActive().length === 1 && jobQueue.getWaiting().length === 1,
		);
		expect(maxSeen).toBe(1);

		release();
		await waitFor(() => jobQueue.getStats().completed === 2);
	});

	it("retries failed jobs", async () => {
		const { jobQueue } = await loadQueueModule();
		let attempts = 0;

		jobQueue.process("wake", async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("retry me");
			return { ok: true };
		});
		const jobId = jobQueue.add(
			"wake",
			{ name: "retryable" },
			{ maxAttempts: 3 },
		);

		await waitFor(() => {
			const job = jobQueue.getJob(jobId);
			return job?.status === "waiting" && job.attempts === 1;
		});
		db.prepare("UPDATE jobs SET available_at = 0 WHERE id = ?").run(jobId);
		(jobQueue as unknown as { tick: () => void }).tick();
		await waitFor(() => jobQueue.getJob(jobId)?.status === "completed");

		expect(attempts).toBe(2);
		expect(jobQueue.getJob(jobId)?.attempts).toBe(2);
	});

	it("transitions completed jobs from waiting to active to completed", async () => {
		const { jobQueue } = await loadQueueModule();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		jobQueue.process("wake", async () => {
			await gate;
			return "done";
		});

		const jobId = jobQueue.add("wake", { name: "transitions" });
		expect(jobQueue.getJob(jobId)?.status).toBe("waiting");

		await waitFor(() => jobQueue.getJob(jobId)?.status === "active");
		release();
		await waitFor(() => jobQueue.getJob(jobId)?.status === "completed");
	});

	it("marks exhausted jobs as failed", async () => {
		const { jobQueue } = await loadQueueModule();
		jobQueue.process("wake", async () => {
			throw new Error("permanent failure");
		});

		const jobId = jobQueue.add("wake", { name: "broken" }, { maxAttempts: 1 });
		await waitFor(() => jobQueue.getJob(jobId)?.status === "failed");
		expect(jobQueue.getJob(jobId)?.error).toBe("permanent failure");
	});
});
