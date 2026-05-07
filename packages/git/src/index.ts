/**
 * @setra/git — minimal git plumbing for project workspaces.
 *
 * All operations shell out to the local `git` binary via child_process with
 * a timeout so a hung git invocation can't lock the server. Functions that
 * mutate the repo are guarded by validateWorkspace() which rejects any path
 * that is not under one of the allowed roots supplied by the caller (the
 * server passes in `board_projects.workspace_path` values).
 *
 * The intent is for callers (apps/server) to look up the legitimate
 * workspace root for a given project/issue and then pass that to these
 * helpers. Without an allowedRoots check the helpers fall back to a
 * permissive mode that only validates absolute existence — fine for
 * single-tenant local installs but the server should always pass roots.
 */
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

export interface GitOptions {
	/**
	 * Optional allow-list of absolute paths. If supplied, the workspace path
	 * must be exactly one of them or a descendant of one. If empty/undefined
	 * the path is only checked for absoluteness + existence.
	 */
	allowedRoots?: readonly string[];
	/** Override exec timeout (ms). */
	timeoutMs?: number;
}

export class GitError extends Error {
	constructor(
		message: string,
		public readonly code: "invalid_path" | "out_of_bounds" | "exec_failed",
		public readonly stderr?: string,
	) {
		super(message);
		this.name = "GitError";
	}
}

/**
 * Verify the path is absolute, exists, is a directory, and (when
 * allowedRoots is non-empty) is contained within at least one of them.
 */
export function validateWorkspace(
	workspacePath: string,
	allowedRoots?: readonly string[],
): string {
	if (!workspacePath || !isAbsolute(workspacePath)) {
		throw new GitError(
			`workspacePath must be absolute, got: ${workspacePath}`,
			"invalid_path",
		);
	}
	const resolved = resolve(workspacePath);
	if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
		throw new GitError(
			`workspacePath does not exist or is not a directory: ${resolved}`,
			"invalid_path",
		);
	}
	if (allowedRoots && allowedRoots.length > 0) {
		const ok = allowedRoots.some((root) => {
			if (!isAbsolute(root)) return false;
			const r = resolve(root);
			if (resolved === r) return true;
			const rel = relative(r, resolved);
			return (
				rel.length > 0 &&
				!rel.startsWith("..") &&
				!isAbsolute(rel) &&
				!rel.startsWith(`..${sep}`)
			);
		});
		if (!ok) {
			throw new GitError(
				`workspacePath is not under any allowed company workspace: ${resolved}`,
				"out_of_bounds",
			);
		}
	}
	return resolved;
}

async function runGit(
	cwd: string,
	args: readonly string[],
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileP("git", args as string[], {
			cwd,
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		});
		return { stdout: String(stdout), stderr: String(stderr) };
	} catch (err) {
		const e = err as NodeJS.ErrnoException & {
			stderr?: string;
			stdout?: string;
		};
		throw new GitError(
			`git ${args.join(" ")} failed: ${e.message}`,
			"exec_failed",
			e.stderr ?? undefined,
		);
	}
}

export interface EnsureRepoResult {
	initialized: boolean;
	defaultBranch: string;
	alreadyExisted: boolean;
}

/**
 * If a `.git` dir exists, return the current branch. Otherwise run
 * `git init -b main` to create one.
 */
export async function ensureRepo(
	workspacePath: string,
	opts: GitOptions = {},
): Promise<EnsureRepoResult> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const dotGit = resolve(cwd, ".git");
	if (existsSync(dotGit)) {
		const branch = await currentBranchSafe(cwd, timeout);
		return {
			initialized: true,
			defaultBranch: branch ?? "main",
			alreadyExisted: true,
		};
	}
	await runGit(cwd, ["init", "-b", "main"], timeout);
	return { initialized: true, defaultBranch: "main", alreadyExisted: false };
}

async function currentBranchSafe(
	cwd: string,
	timeoutMs: number,
): Promise<string | null> {
	try {
		const { stdout } = await runGit(
			cwd,
			["rev-parse", "--abbrev-ref", "HEAD"],
			timeoutMs,
		);
		const out = stdout.trim();
		return out.length > 0 ? out : null;
	} catch {
		return null;
	}
}

export async function currentBranch(
	workspacePath: string,
	opts: GitOptions = {},
): Promise<string> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	const branch = await currentBranchSafe(
		cwd,
		opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
	if (!branch)
		throw new GitError(
			"could not resolve current branch (no commits yet?)",
			"exec_failed",
		);
	return branch;
}

export async function getRemoteUrl(
	workspacePath: string,
	remote = "origin",
	opts: GitOptions = {},
): Promise<string | null> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	try {
		const { stdout } = await runGit(
			cwd,
			["config", "--get", `remote.${remote}.url`],
			opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		const url = stdout.trim();
		return url.length > 0 ? url : null;
	} catch {
		return null;
	}
}

export async function createBranch(
	workspacePath: string,
	branchName: string,
	fromBranch?: string,
	opts: GitOptions = {},
): Promise<void> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (!/^[A-Za-z0-9._/\-]+$/.test(branchName)) {
		throw new GitError(`invalid branch name: ${branchName}`, "invalid_path");
	}
	if (fromBranch) {
		if (!/^[A-Za-z0-9._/\-]+$/.test(fromBranch)) {
			throw new GitError(
				`invalid from-branch name: ${fromBranch}`,
				"invalid_path",
			);
		}
		await runGit(cwd, ["checkout", fromBranch], timeout).catch(() => undefined);
	}
	// -B = create or reset; idempotent if the branch already exists.
	await runGit(cwd, ["checkout", "-B", branchName], timeout);
}

export interface CommitResult {
	sha: string;
	/** True when there were no staged changes and we returned the existing HEAD. */
	noChanges: boolean;
}

/**
 * Stage `files` (or all changes) and commit. If the working tree is clean we
 * return the current HEAD with `noChanges: true` instead of erroring — the
 * dispatcher shouldn't fail an issue just because the agent produced no
 * diff yet.
 */
export async function commit(
	workspacePath: string,
	message: string,
	files?: readonly string[],
	opts: GitOptions = {},
): Promise<CommitResult> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	if (files && files.length > 0) {
		await runGit(cwd, ["add", "--", ...files], timeout);
	} else {
		await runGit(cwd, ["add", "-A"], timeout);
	}

	// Detect staged changes; if none, short-circuit.
	const { stdout: diff } = await runGit(
		cwd,
		["diff", "--cached", "--name-only"],
		timeout,
	);
	if (diff.trim().length === 0) {
		const head = await runGit(cwd, ["rev-parse", "HEAD"], timeout).catch(
			() => ({ stdout: "" }),
		);
		return { sha: head.stdout.trim(), noChanges: true };
	}

	await runGit(
		cwd,
		[
			"-c",
			"user.email=agent@setra.local",
			"-c",
			"user.name=Setra Agent",
			"commit",
			"-m",
			message,
		],
		timeout,
	);
	const { stdout } = await runGit(cwd, ["rev-parse", "HEAD"], timeout);
	return { sha: stdout.trim(), noChanges: false };
}

export async function pushBranch(
	workspacePath: string,
	branchName: string,
	remote = "origin",
	opts: GitOptions = {},
): Promise<void> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	if (
		!/^[A-Za-z0-9._/\-]+$/.test(branchName) ||
		!/^[A-Za-z0-9._\-]+$/.test(remote)
	) {
		throw new GitError(`invalid branch/remote name`, "invalid_path");
	}
	await runGit(
		cwd,
		["push", "-u", remote, branchName],
		opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	);
}

/**
 * Merge `branchName` into `intoBranch` (default branch). Used when an agent
 * Reviewer approves a PR — the local mirror of the PR is merged into the
 * project's default branch so subsequent runs see the latest.
 */
export async function merge(
	workspacePath: string,
	branchName: string,
	intoBranch: string,
	opts: GitOptions = {},
): Promise<{ sha: string }> {
	const cwd = validateWorkspace(workspacePath, opts.allowedRoots);
	const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (
		!/^[A-Za-z0-9._/\-]+$/.test(branchName) ||
		!/^[A-Za-z0-9._/\-]+$/.test(intoBranch)
	) {
		throw new GitError(`invalid branch name`, "invalid_path");
	}
	await runGit(cwd, ["checkout", intoBranch], timeout);
	await runGit(
		cwd,
		["merge", "--no-ff", "-m", `merge ${branchName}`, branchName],
		timeout,
	);
	const { stdout } = await runGit(cwd, ["rev-parse", "HEAD"], timeout);
	return { sha: stdout.trim() };
}

/**
 * Slugify a free-text title into a branch-safe segment.
 * "Add /health endpoint!" → "add-health-endpoint"
 */
export function kebab(input: string, max = 40): string {
	const s = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, max)
		.replace(/-+$/g, "");
	return s.length > 0 ? s : "task";
}
