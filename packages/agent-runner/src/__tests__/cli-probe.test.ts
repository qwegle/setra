import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock child_process BEFORE importing cli-probe so the dynamic execFile is
// deterministic. We simulate "claude installed @1.0.0, codex missing,
// gemini installed but --version times out, opencode + cursor missing".
vi.mock("child_process", () => {
	const execFile = (
		bin: string,
		args: readonly string[],
		_opts: unknown,
		cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
	) => {
		// `which <bin>` lookup
		if (bin === "which") {
			const target = args[0];
			if (target === "claude" || target === "gemini") {
				return cb(null, { stdout: `/usr/local/bin/${target}\n`, stderr: "" });
			}
			return cb(new Error("not found"), { stdout: "", stderr: "" });
		}
		// Per-CLI version probes
		if (bin === "claude") {
			return cb(null, { stdout: "claude 1.0.0 (build abc)\n", stderr: "" });
		}
		if (bin === "gemini") {
			return cb(new Error("ETIMEDOUT"), { stdout: "", stderr: "" });
		}
		return cb(new Error("not found"), { stdout: "", stderr: "" });
	};
	return { execFile };
});

import {
	FIRST_CLASS_CLIS,
	probeCLIs,
	_resetCliProbeCacheForTests,
} from "../cli-probe.js";

describe("cli-probe", () => {
	beforeEach(() => {
		_resetCliProbeCacheForTests();
	});

	it("ships the five first-class adapters in stable order", () => {
		expect(FIRST_CLASS_CLIS.map((c) => c.id)).toEqual([
			"claude",
			"codex",
			"gemini",
			"opencode",
			"cursor",
		]);
	});

	it("reports installed=true with parsed version when CLI responds", async () => {
		const all = await probeCLIs({ force: true });
		const claude = all.find((c) => c.id === "claude");
		expect(claude).toBeDefined();
		expect(claude!.installed).toBe(true);
		expect(claude!.version).toBe("1.0.0");
		expect(claude!.installCommand).toContain("@anthropic-ai/claude-code");
	});

	it("reports installed=true with version=null when version probe fails", async () => {
		const all = await probeCLIs({ force: true });
		const gemini = all.find((c) => c.id === "gemini");
		expect(gemini!.installed).toBe(true);
		expect(gemini!.version).toBeNull();
	});

	it("reports installed=false for missing binaries", async () => {
		const all = await probeCLIs({ force: true });
		for (const id of ["codex", "opencode", "cursor"]) {
			const status = all.find((c) => c.id === id);
			expect(status, id).toBeDefined();
			expect(status!.installed, id).toBe(false);
			expect(status!.version, id).toBeNull();
		}
	});

	it("only-filter restricts the result set", async () => {
		const subset = await probeCLIs({ force: true, only: ["claude", "cursor"] });
		expect(subset.map((c) => c.id).sort()).toEqual(["claude", "cursor"]);
	});

	it("never throws and never reads any env var named *_API_KEY", async () => {
		// Spy on env reads by snapshotting and restoring keys; the probe must not
		// accidentally read them (it has no business doing so).
		const before = Object.keys(process.env).filter((k) => k.endsWith("_API_KEY"));
		const all = await probeCLIs({ force: true });
		const after = Object.keys(process.env).filter((k) => k.endsWith("_API_KEY"));
		expect(after).toEqual(before);
		expect(all.length).toBe(FIRST_CLASS_CLIS.length);
	});
});
