/**
 * cli-probe.ts — detect locally installed coding-agent CLIs.
 *
 * The user-facing onboarding flow ("Connect a coding CLI") relies on this
 * to render live install/version state for the five first-class adapters
 * (Claude Code, Codex, Gemini, OpenCode, Cursor). Used by:
 *   - `apps/server/src/routes/cli-status.ts` (HTTP surface, polled by the UI)
 *   - The new top-bar AdapterStatusPill (PR-C)
 *
 * Detection is best-effort: we run `which <bin>` then `<bin> --version` and
 * cache the result in-memory for `CACHE_TTL_MS` so the polling endpoint is
 * cheap. A null version means the binary is on PATH but didn't respond to
 * `--version` within the timeout (still considered "installed").
 *
 * No API keys are ever read here. Auth is the CLI's own concern.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface CliDescriptor {
	/** Stable id matching the adapter `name` in `packages/agent-runner/src/adapters/*`. */
	id: string;
	/** Human-readable label for the UI. */
	label: string;
	/** Binary name to look up on PATH. */
	bin: string;
	/** Argument(s) that print a version string. */
	versionArgs: readonly string[];
	/** Shell command the user copy-pastes to install. */
	installCommand: string;
	/** Documentation URL (anchored under our docs site). */
	docUrl: string;
}

export const FIRST_CLASS_CLIS: readonly CliDescriptor[] = [
	{
		id: "claude",
		label: "Claude Code",
		bin: "claude",
		versionArgs: ["--version"],
		installCommand: "npm install -g @anthropic-ai/claude-code",
		docUrl: "/docs/adapters/claude",
	},
	{
		id: "codex",
		label: "Codex",
		bin: "codex",
		versionArgs: ["--version"],
		installCommand: "npm install -g @openai/codex",
		docUrl: "/docs/adapters/codex",
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		bin: "gemini",
		versionArgs: ["--version"],
		installCommand: "npm install -g @google/gemini-cli",
		docUrl: "/docs/adapters/gemini",
	},
	{
		id: "opencode",
		label: "OpenCode",
		bin: "opencode",
		versionArgs: ["--version"],
		installCommand: "curl -fsSL https://opencode.ai/install | bash",
		docUrl: "/docs/adapters/opencode",
	},
	{
		id: "cursor",
		label: "Cursor CLI",
		bin: "cursor-agent",
		versionArgs: ["--version"],
		installCommand: "curl https://cursor.com/install -fsS | bash",
		docUrl: "/docs/adapters/cursor",
	},
] as const;

export interface CliStatus {
	id: string;
	label: string;
	bin: string;
	installed: boolean;
	version: string | null;
	installCommand: string;
	docUrl: string;
	checkedAt: number;
}

const CACHE_TTL_MS = 60_000;
const VERSION_TIMEOUT_MS = 1_500;

interface CacheEntry {
	value: CliStatus;
	expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

async function probeOne(d: CliDescriptor, now: number): Promise<CliStatus> {
	let installed = false;
	let version: string | null = null;
	try {
		await execFileAsync("which", [d.bin], { timeout: VERSION_TIMEOUT_MS });
		installed = true;
	} catch {
		installed = false;
	}
	if (installed) {
		try {
			const { stdout } = await execFileAsync(d.bin, [...d.versionArgs], {
				timeout: VERSION_TIMEOUT_MS,
			});
			version = parseVersion(stdout);
		} catch {
			version = null;
		}
	}
	return {
		id: d.id,
		label: d.label,
		bin: d.bin,
		installed,
		version,
		installCommand: d.installCommand,
		docUrl: d.docUrl,
		checkedAt: now,
	};
}

function parseVersion(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (!trimmed) return null;
	// Take the first line and the first semver-ish token on it.
	const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
	const semver = firstLine.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/);
	return semver ? semver[0] : firstLine.slice(0, 32);
}

export interface ProbeOptions {
	/** Force a re-probe ignoring the cache. */
	force?: boolean;
	/** Probe only this subset of CLIs (by id). */
	only?: readonly string[];
}

/**
 * Probe all first-class CLIs (or a subset) and return their status. Cached
 * per-id for `CACHE_TTL_MS`. Safe to call from a high-frequency polling
 * endpoint — only the first call after expiry actually shells out.
 */
export async function probeCLIs(opts: ProbeOptions = {}): Promise<CliStatus[]> {
	const now = Date.now();
	const targets = opts.only
		? FIRST_CLASS_CLIS.filter((c) => opts.only!.includes(c.id))
		: FIRST_CLASS_CLIS;

	const results = await Promise.all(
		targets.map(async (d) => {
			if (!opts.force) {
				const hit = cache.get(d.id);
				if (hit && hit.expiresAt > now) return hit.value;
			}
			const value = await probeOne(d, now);
			cache.set(d.id, { value, expiresAt: now + CACHE_TTL_MS });
			return value;
		}),
	);

	return results;
}

/** Test-only: clear the in-memory cache. */
export function _resetCliProbeCacheForTests(): void {
	cache.clear();
}
