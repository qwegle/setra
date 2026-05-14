import { describe, expect, it } from "vitest";
import { LoopDetector } from "../pipeline/loop-detector.js";

describe("LoopDetector", () => {
	it("does not flag a healthy run", () => {
		const d = new LoopDetector();
		expect(d.record("read_file", { path: "a.ts" }).shouldReplan).toBe(false);
		expect(d.record("read_file", { path: "b.ts" }).shouldReplan).toBe(false);
		expect(d.record("write_file", { path: "c.ts" }).shouldReplan).toBe(false);
	});

	it("flags a repeated identical tool call", () => {
		const d = new LoopDetector({ windowSize: 6, repeatThreshold: 3 });
		d.record("read_file", { path: "a.ts" });
		d.record("read_file", { path: "a.ts" });
		const signal = d.record("read_file", { path: "a.ts" });
		expect(signal.shouldReplan).toBe(true);
		expect(signal.kind).toBe("repeat");
		expect(signal.reason).toMatch(/loop/);
	});

	it("flags a streak of tool errors", () => {
		const d = new LoopDetector({ consecutiveErrorThreshold: 3 });
		d.record("a", {}, "bad");
		d.record("b", {}, "still bad");
		const signal = d.record("c", {}, "yet again");
		expect(signal.shouldReplan).toBe(true);
		expect(signal.kind).toBe("error_streak");
	});

	it("breaks the error streak when a successful call arrives", () => {
		const d = new LoopDetector({ consecutiveErrorThreshold: 3 });
		d.record("a", {}, "bad");
		d.record("b", {}, "bad");
		d.record("c", {}); // success — reset streak
		const signal = d.record("d", {}, "bad");
		expect(signal.shouldReplan).toBe(false);
	});

	it("only flags once per instance", () => {
		const d = new LoopDetector({ repeatThreshold: 2 });
		d.record("x", {});
		expect(d.record("x", {}).shouldReplan).toBe(true);
		// further records should not re-flag
		expect(d.record("x", {}).shouldReplan).toBe(false);
	});

	it("argument order does not affect hashing", () => {
		const d = new LoopDetector({ repeatThreshold: 2 });
		d.record("t", { a: 1, b: 2 });
		expect(d.record("t", { b: 2, a: 1 }).shouldReplan).toBe(true);
	});
});
