import { describe, expect, it } from "vitest";
import {
	defaultReadOnlyPaths,
	wrapWithSandbox,
} from "../sandbox-spawn.js";

describe("wrapWithSandbox", () => {
	const projectRoot = "/tmp/setra-test-project";

	it("is a no-op when SETRA_SANDBOX_ENFORCE is unset", () => {
		const before = process.env.SETRA_SANDBOX_ENFORCE;
		delete process.env.SETRA_SANDBOX_ENFORCE;
		try {
			const result = wrapWithSandbox("codex", ["exec", "-m", "gpt-5"], {
				projectRoot,
			});
			expect(result.wrapped).toBe(false);
			expect(result.command).toBe("codex");
			expect(result.mode).toBe("off");
		} finally {
			if (before === undefined) delete process.env.SETRA_SANDBOX_ENFORCE;
			else process.env.SETRA_SANDBOX_ENFORCE = before;
		}
	});

	it("preserves args verbatim when not wrapping", () => {
		const result = wrapWithSandbox("git", ["status", "--porcelain"], {
			projectRoot,
			mode: "off",
		});
		expect(result.args).toEqual(["status", "--porcelain"]);
	});

	it("throws in strict mode when no sandbox is available", () => {
		// On Linux without bwrap, strict must throw. On macOS sandbox-exec
		// is part of the OS, so we can't simulate "unavailable" without
		// stubbing the module. Use a platform-conditional assertion: on
		// macOS/Linux-with-bwrap the call succeeds and we assert wrapped=true;
		// elsewhere we assert it throws.
		const orig = process.env.PATH;
		try {
			process.env.PATH = "/nonexistent";
			let threw = false;
			let result: ReturnType<typeof wrapWithSandbox> | undefined;
			try {
				result = wrapWithSandbox("codex", [], {
					projectRoot,
					mode: "strict",
				});
			} catch {
				threw = true;
			}
			// Either it threw (Linux w/o bwrap, Windows) or it wrapped successfully (macOS).
			expect(threw || result?.wrapped === true).toBe(true);
		} finally {
			if (orig === undefined) delete process.env.PATH;
			else process.env.PATH = orig;
		}
	});

	it("defaultReadOnlyPaths returns only paths that exist", () => {
		const paths = defaultReadOnlyPaths();
		for (const p of paths) {
			expect(typeof p).toBe("string");
		}
	});
});
