import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the @setra/db dependency (used by tokens.ts → queryTokenStats)
vi.mock("@setra/db", () => ({
	getDb: vi.fn(() => {
		throw new Error("DB not available in tests");
	}),
	runs: {},
}));

// Also mock drizzle-orm to avoid any imports that need native bindings
vi.mock("drizzle-orm", () => ({
	gte: vi.fn(),
	sum: vi.fn(),
}));

import { MonitorService } from "../monitor.js";
import { sampleCpuPercent, sampleRam } from "../system.js";
import type { MonitorSnapshot } from "../types.js";

// ─── sampleCpuPercent ─────────────────────────────────────────────────────────

describe("sampleCpuPercent", () => {
	it("returns number between 0 and 100", async () => {
		const cpu = await sampleCpuPercent();
		expect(typeof cpu).toBe("number");
		expect(cpu).toBeGreaterThanOrEqual(0);
		expect(cpu).toBeLessThanOrEqual(100);
	});

	it("completes within 1 second", async () => {
		const start = Date.now();
		await sampleCpuPercent();
		const elapsed = Date.now() - start;
		// The implementation waits 500ms; give 600ms of margin
		expect(elapsed).toBeLessThan(1000);
	});
});

// ─── sampleRam ────────────────────────────────────────────────────────────────

describe("sampleRam", () => {
	it("usedMb > 0", () => {
		const ram = sampleRam();
		expect(ram.usedMb).toBeGreaterThan(0);
	});

	it("totalMb > usedMb", () => {
		const ram = sampleRam();
		expect(ram.totalMb).toBeGreaterThan(ram.usedMb);
	});

	it("percent between 0 and 100", () => {
		const ram = sampleRam();
		expect(ram.percent).toBeGreaterThan(0);
		expect(ram.percent).toBeLessThan(100);
	});

	it("processMb > 0", () => {
		const ram = sampleRam();
		expect(ram.processMb).toBeGreaterThan(0);
	});
});

// ─── MonitorService ───────────────────────────────────────────────────────────

describe("MonitorService", () => {
	let service: MonitorService;

	beforeEach(() => {
		// Create a fresh instance with a short poll interval for tests
		service = new MonitorService(100);
	});

	afterEach(() => {
		service.stop();
	});

	it("start/stop without error", () => {
		expect(() => service.start()).not.toThrow();
		expect(() => service.stop()).not.toThrow();
	});

	it("calling start twice is idempotent", () => {
		service.start();
		expect(() => service.start()).not.toThrow();
	});

	it("calling stop without start is safe", () => {
		expect(() => service.stop()).not.toThrow();
	});

	it("getSnapshot returns null before first poll", () => {
		// Don't start the service — snapshot should be null
		expect(service.getSnapshot()).toBeNull();
	});

	it("subscribe receives snapshots after start", async () => {
		const snapshots: MonitorSnapshot[] = [];
		const unsub = service.subscribe((snap) => snapshots.push(snap));

		service.start();

		// Wait long enough for at least one poll (intervalMs=100, poll takes ~500ms)
		await new Promise<void>((resolve) => setTimeout(resolve, 700));

		service.stop();
		unsub();

		expect(snapshots.length).toBeGreaterThan(0);
		const snap = snapshots[0];
		expect(snap).toBeDefined();
		expect(snap!.system.cpuPercent).toBeGreaterThanOrEqual(0);
		expect(snap!.system.ramUsedMb).toBeGreaterThan(0);
		expect(typeof snap!.timestamp).toBe("number");
	});

	it("unsubscribe stops notifications", async () => {
		const received: MonitorSnapshot[] = [];
		const unsub = service.subscribe((snap) => received.push(snap));

		service.start();
		await new Promise<void>((resolve) => setTimeout(resolve, 700));

		const countBeforeUnsub = received.length;
		unsub();

		// After unsubscribing, no more snapshots should arrive
		await new Promise<void>((resolve) => setTimeout(resolve, 300));
		const countAfterUnsub = received.length;

		service.stop();

		expect(countAfterUnsub).toBe(countBeforeUnsub);
	});

	it("subscribe returns existing snapshot immediately if available", async () => {
		service.start();

		// Wait for at least one poll
		await new Promise<void>((resolve) => setTimeout(resolve, 700));

		const immediateSnapshots: MonitorSnapshot[] = [];
		const unsub = service.subscribe((snap) => immediateSnapshots.push(snap));

		// The first call should receive the existing snapshot immediately
		expect(immediateSnapshots.length).toBeGreaterThan(0);

		service.stop();
		unsub();
	});
});
