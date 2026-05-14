/**
 * sandbox-spawn.ts — wrap child-process spawn calls with the host
 * platform's process sandbox so adapter CLIs (claude, codex, gemini,
 * cursor, opencode) run with reduced filesystem and network privileges.
 *
 * Platform support:
 *
 *   - Linux:   bwrap   (bubblewrap), if available on PATH.
 *   - macOS:   sandbox-exec, available by default in /usr/bin.
 *   - Windows: no-op with a warning, governed by sandbox.enforce.
 *
 * Governance flag: SETRA_SANDBOX_ENFORCE
 *
 *   - "off"   (default for non-sensitive runs) — no wrapping, log only.
 *   - "warn"  — wrap when possible, warn when not.
 *   - "strict" — refuse to spawn if the platform cannot sandbox.
 *
 * The wrapper accepts a project root (read-write) and a list of
 * additional read-only paths the adapter needs (e.g. ~/.claude config).
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";

export type SandboxMode = "off" | "warn" | "strict";

export interface SandboxOptions {
	/** The project worktree that should be writable inside the sandbox. */
	projectRoot: string;
	/** Extra absolute paths to make read-only in the sandbox. */
	readOnlyPaths?: readonly string[];
	/** Allow outbound network access. Defaults to true; adapters that talk to model APIs need this. */
	allowNetwork?: boolean;
	/** Override the governance mode for this call. */
	mode?: SandboxMode;
}

export interface SandboxWrapResult {
	command: string;
	args: string[];
	mode: SandboxMode;
	wrapped: boolean;
	reason: string;
}

function readMode(opts: SandboxOptions): SandboxMode {
	if (opts.mode) return opts.mode;
	const env = (process.env.SETRA_SANDBOX_ENFORCE ?? "off").toLowerCase();
	if (env === "strict" || env === "warn" || env === "off") return env;
	return "off";
}

function which(bin: string): boolean {
	// Avoid bringing in `which` — check $PATH manually.
	const path = process.env.PATH ?? "";
	for (const entry of path.split(":")) {
		if (!entry) continue;
		if (existsSync(`${entry}/${bin}`)) return true;
	}
	return false;
}

function wrapBwrap(
	command: string,
	args: string[],
	opts: SandboxOptions,
): { command: string; args: string[] } {
	const bwrapArgs: string[] = [
		"--unshare-pid",
		"--unshare-ipc",
		"--unshare-uts",
		"--die-with-parent",
		"--ro-bind",
		"/usr",
		"/usr",
		"--ro-bind",
		"/lib",
		"/lib",
		"--symlink",
		"usr/bin",
		"/bin",
		"--symlink",
		"usr/lib",
		"/lib64",
		"--proc",
		"/proc",
		"--dev",
		"/dev",
		"--tmpfs",
		"/tmp",
		"--bind",
		opts.projectRoot,
		opts.projectRoot,
		"--chdir",
		opts.projectRoot,
	];
	for (const ro of opts.readOnlyPaths ?? []) {
		if (existsSync(ro)) bwrapArgs.push("--ro-bind", ro, ro);
	}
	if (!(opts.allowNetwork ?? true)) bwrapArgs.push("--unshare-net");
	bwrapArgs.push("--setenv", "HOME", opts.projectRoot);
	bwrapArgs.push("--", command, ...args);
	return { command: "bwrap", args: bwrapArgs };
}

function buildSandboxExecProfile(opts: SandboxOptions): string {
	const allowNet = opts.allowNetwork ?? true;
	const reads = [opts.projectRoot, ...(opts.readOnlyPaths ?? [])]
		.filter((p) => existsSync(p))
		.map((p) => `(subpath "${p.replace(/"/g, '\\"')}")`)
		.join(" ");
	return [
		"(version 1)",
		"(deny default)",
		"(allow process-fork)",
		"(allow process-exec)",
		"(allow signal (target same-sandbox))",
		"(allow file-read*)",
		`(allow file-write* ${reads || `(subpath "${opts.projectRoot}")`})`,
		"(allow sysctl-read)",
		"(allow mach-lookup)",
		allowNet ? "(allow network*)" : "(deny network*)",
		"(allow iokit-open)",
		"(allow ipc-posix-shm)",
	].join("\n");
}

function wrapSandboxExec(
	command: string,
	args: string[],
	opts: SandboxOptions,
): { command: string; args: string[] } {
	const profile = buildSandboxExecProfile(opts);
	return {
		command: "sandbox-exec",
		args: ["-p", profile, command, ...args],
	};
}

/**
 * Wrap (command, args) with the platform's sandbox if possible. Falls
 * back to the original (command, args) when sandboxing is unavailable
 * and the mode is "off" or "warn".
 *
 * Throws when the mode is "strict" and sandboxing is unavailable.
 */
export function wrapWithSandbox(
	command: string,
	args: string[],
	opts: SandboxOptions,
): SandboxWrapResult {
	const mode = readMode(opts);
	if (mode === "off") {
		return {
			command,
			args,
			mode,
			wrapped: false,
			reason: "sandbox mode off",
		};
	}

	const plat = platform();
	if (plat === "linux") {
		if (which("bwrap")) {
			const wrapped = wrapBwrap(command, args, opts);
			return { ...wrapped, mode, wrapped: true, reason: "bwrap" };
		}
		if (mode === "strict") {
			throw new Error(
				"sandbox mode 'strict' on Linux but bwrap is not installed. Install bubblewrap or set SETRA_SANDBOX_ENFORCE=warn.",
			);
		}
		return {
			command,
			args,
			mode,
			wrapped: false,
			reason: "bwrap not on PATH",
		};
	}

	if (plat === "darwin") {
		if (existsSync("/usr/bin/sandbox-exec")) {
			const wrapped = wrapSandboxExec(command, args, opts);
			return { ...wrapped, mode, wrapped: true, reason: "sandbox-exec" };
		}
		if (mode === "strict") {
			throw new Error(
				"sandbox mode 'strict' on macOS but /usr/bin/sandbox-exec is missing.",
			);
		}
		return {
			command,
			args,
			mode,
			wrapped: false,
			reason: "sandbox-exec missing",
		};
	}

	if (mode === "strict") {
		throw new Error(
			"sandbox mode 'strict' but the host platform has no supported sandbox (Windows: not implemented).",
		);
	}
	return {
		command,
		args,
		mode,
		wrapped: false,
		reason: `unsupported platform: ${plat}`,
	};
}

export function defaultReadOnlyPaths(): string[] {
	const home = homedir();
	return [
		`${home}/.claude`,
		`${home}/.codex`,
		`${home}/.gemini`,
		`${home}/.cursor`,
		`${home}/.config/opencode`,
		`${home}/.setra/settings.json`,
	].filter(existsSync);
}
