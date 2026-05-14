import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the WASM-based embedder — must happen before any store import
vi.mock("../embedder.js", () => ({
	embed: vi.fn(async () => new Float32Array(384).fill(0.1)),
	embedBatch: vi.fn(async (texts: string[]) =>
		texts.map(() => new Float32Array(384).fill(0.1)),
	),
	initEmbedder: vi.fn(async () => undefined),
}));

import { MemoryStore } from "../store.js";

let tmpDir: string;
let store: MemoryStore;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "setra-mem-"));
	store = new MemoryStore({
		dbPath: path.join(tmpDir, "test.db"),
		maxEntries: 5,
	});
});

afterEach(async () => {
	// Close the DB and clean up
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
	it("initialises table on init()", async () => {
		await store.init();
		// Should not throw; count() works after init
		expect(store.count()).toBe(0);
	});

	it("adds entry and returns id", async () => {
		await store.init();
		const id = await store.add("hello world");
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});

	it("count() returns correct number", async () => {
		await store.init();
		expect(store.count()).toBe(0);

		await store.add("first entry");
		expect(store.count()).toBe(1);

		await store.add("second entry");
		expect(store.count()).toBe(2);
	});

	it("search returns results sorted by score", async () => {
		await store.init();

		await store.add("typescript is a typed superset of javascript");
		await store.add("dogs are great companions");
		await store.add("rust is a systems programming language");

		// Since all embeddings are the same (mocked to 0.1 fill),
		// cosine similarity will be identical — results still sorted and returned
		const results = await store.search("programming language", { minScore: 0 });
		expect(Array.isArray(results)).toBe(true);
		expect(results.length).toBeGreaterThan(0);

		// Verify sorted by score descending
		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
		}
	});

	it("search with minScore filters low-scoring results", async () => {
		await store.init();
		await store.add("test content");

		// All mock embeddings are identical fill(0.1) vectors.
		// Cosine similarity of identical vectors = 1.0, but floating-point
		// arithmetic may produce ~0.9999999, so use a threshold just below 1.0.
		const highResults = await store.search("test", { minScore: 0.99 });
		expect(highResults.length).toBeGreaterThan(0);

		// With minScore above what cosine similarity can reach, nothing passes
		const tooHighResults = await store.search("test", { minScore: 1.01 });
		expect(tooHighResults.length).toBe(0);
	});

	it("delete removes entry", async () => {
		await store.init();
		const id = await store.add("entry to delete");
		expect(store.count()).toBe(1);

		await store.delete(id);
		expect(store.count()).toBe(0);
	});

	it("clear() removes all entries", async () => {
		await store.init();
		await store.add("entry 1");
		await store.add("entry 2");
		await store.add("entry 3");
		expect(store.count()).toBe(3);

		await store.clear();
		expect(store.count()).toBe(0);
	});

	it("clear(plotId) removes only that plot entries", async () => {
		await store.init();
		await store.add("plot A entry 1", {}, { plotId: "plot-a" });
		await store.add("plot A entry 2", {}, { plotId: "plot-a" });
		await store.add("plot B entry 1", {}, { plotId: "plot-b" });
		expect(store.count()).toBe(3);

		await store.clear("plot-a");
		expect(store.count()).toBe(1);

		const remaining = await store.search("entry", { minScore: 0 });
		expect(remaining.every((r) => r.entry.plotId === "plot-b")).toBe(true);
	});

	it("prunes oldest when maxEntries exceeded", async () => {
		// maxEntries is 5 (set in beforeEach)
		await store.init();

		const ids: string[] = [];
		for (let i = 0; i < 6; i++) {
			ids.push(await store.add(`entry number ${i}`));
		}

		// After adding 6 entries with maxEntries=5, one should be pruned
		expect(store.count()).toBeLessThanOrEqual(5);
	});

	it("search filters by plotId", async () => {
		await store.init();
		await store.add("in plot alpha", {}, { plotId: "alpha" });
		await store.add("in plot beta", {}, { plotId: "beta" });

		const alphaResults = await store.search("plot", {
			minScore: 0,
			plotId: "alpha",
		});
		expect(alphaResults.every((r) => r.entry.plotId === "alpha")).toBe(true);
	});

	it("prunes per agent when maxEntriesPerAgent exceeded", async () => {
		const perAgentStore = new MemoryStore({
			dbPath: path.join(tmpDir, "per-agent.db"),
			maxEntries: 1000,
			maxEntriesPerAgent: 3,
		});
		await perAgentStore.init();
		for (let i = 0; i < 5; i++) {
			await perAgentStore.add(`alpha entry ${i}`, {}, { agentId: "alpha" });
		}
		for (let i = 0; i < 2; i++) {
			await perAgentStore.add(`beta entry ${i}`, {}, { agentId: "beta" });
		}
		const alphaCount = await perAgentStore.search("alpha entry", {
			minScore: 0,
			limit: 100,
		});
		const alphaForAgent = alphaCount.filter((r) => r.entry.agentId === "alpha");
		expect(alphaForAgent.length).toBeLessThanOrEqual(3);
		const betaForAgent = alphaCount.filter((r) => r.entry.agentId === "beta");
		expect(betaForAgent.length).toBe(2);
	});
});
