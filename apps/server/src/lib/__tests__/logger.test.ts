import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../logger.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createLogger", () => {
	it("emits valid JSON with timestamp, level, module, and message", () => {
		const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const logger = createLogger("prompt-builder");

		logger.info("built prompt");

		const line = stdout.mock.calls[0]?.[0];
		expect(typeof line).toBe("string");
		const entry = JSON.parse(line as string) as Record<string, unknown>;
		expect(entry.level).toBe("info");
		expect(entry.module).toBe("prompt-builder");
		expect(entry.msg).toBe("built prompt");
		expect(typeof entry.ts).toBe("string");
		expect(Number.isNaN(Date.parse(entry.ts as string))).toBe(false);
	});

	it("includes structured context fields", () => {
		const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const logger = createLogger("audit");

		logger.warn("entry appended", { requestId: "req-1", companyId: "co-1" });

		const entry = JSON.parse(stdout.mock.calls[0]?.[0] as string) as Record<
			string,
			unknown
		>;
		expect(entry.requestId).toBe("req-1");
		expect(entry.companyId).toBe("co-1");
	});

	it("writes error logs to stderr", () => {
		const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const stderr = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const logger = createLogger("server");

		logger.error("boom", { code: 500 });

		expect(stderr).toHaveBeenCalledTimes(1);
		expect(stdout).not.toHaveBeenCalled();
		const entry = JSON.parse(stderr.mock.calls[0]?.[0] as string) as Record<
			string,
			unknown
		>;
		expect(entry.level).toBe("error");
		expect(entry.code).toBe(500);
	});
});
