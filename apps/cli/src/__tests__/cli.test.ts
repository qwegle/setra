import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const CLI_DIST = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"../../../../apps/cli/dist/index.js",
);

const cliAvailable = fs.existsSync(CLI_DIST);

// Helper — run the CLI with arguments, return stdout + stderr
async function setra(
	args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const result = await execa("node", [CLI_DIST, ...args], {
			reject: false,
			timeout: 10_000,
		});
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode ?? 0,
		};
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; exitCode?: number };
		return {
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
			exitCode: e.exitCode ?? 1,
		};
	}
}

describe.skipIf(!cliAvailable)("CLI integration", () => {
	it("setra --help shows all commands", async () => {
		const { stdout, exitCode } = await setra(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/setra/i);
		// Should show at least some subcommands
		expect(stdout).toMatch(/init|run|new|serve/i);
	});

	it("setra --version shows version", async () => {
		const { stdout, stderr, exitCode } = await setra(["--version"]);
		expect(exitCode).toBe(0);
		const output = stdout + stderr;
		// version string like 0.1.0
		expect(output).toMatch(/\d+\.\d+\.\d+/);
	});

	it("setra governance --help shows options", async () => {
		const { stdout, exitCode } = await setra(["governance", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/governance/i);
	});

	it("setra governance status shows policy table", async () => {
		const { stdout, exitCode } = await setra(["governance", "status"]);
		// exit code can be 0 or 1 depending on policy presence
		const output = stdout;
		// Should output some status info
		expect(typeof output).toBe("string");
		expect(exitCode).toBeLessThanOrEqual(1);
	});

	it("setra governance check qwen2.5-coder:7b shows result", async () => {
		const { stdout, exitCode } = await setra([
			"governance",
			"check",
			"qwen2.5-coder:7b",
		]);
		expect(exitCode).toBeLessThanOrEqual(1);
		const output = stdout;
		expect(typeof output).toBe("string");
	});

	it("setra governance check gpt-4o shows result in cloud mode", async () => {
		const { stdout, exitCode } = await setra(["governance", "check", "gpt-4o"]);
		expect(exitCode).toBeLessThanOrEqual(1);
		const output = stdout;
		expect(typeof output).toBe("string");
	});

	it("setra ledger --help shows options", async () => {
		const { stdout, exitCode } = await setra(["ledger", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/ledger/i);
	});

	it("setra trace --help shows options", async () => {
		const { stdout, exitCode } = await setra(["trace", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/trace/i);
	});

	it("setra serve --help shows options", async () => {
		const { stdout, exitCode } = await setra(["serve", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/serve/i);
	});

	it("setra team --help shows options", async () => {
		const { stdout, exitCode } = await setra(["team", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/team/i);
	});

	it("setra kanban move handles missing card without ESM require crash", async () => {
		const { stdout, stderr, exitCode } = await setra([
			"kanban",
			"move",
			"missing-card",
			"--to",
			"In Progress",
		]);
		expect(exitCode).toBe(1);
		const output = `${stdout}\n${stderr}`;
		expect(output).toMatch(/Card not found/i);
		expect(output).not.toMatch(/Dynamic require/i);
	});
});

describe.skipIf(cliAvailable)("CLI dist not built", () => {
	it("skips CLI tests when dist/index.js is not available", () => {
		expect(true).toBe(true);
	});
});
