/**
 * run-worktree.ts - per-run git-worktree path resolver.
 *
 * Mirrors WUPHF's worktree.go pattern: each coding run gets its own branch
 * checkout under a stable directory so concurrent agents cannot stomp each
 * other's in-progress work. This file is the lightweight path/branch
 * resolver - actual git worktree creation lives in @setra/git and is
 * invoked by the run dispatcher when a run starts.
 *
 * Path scheme: $SETRA_DATA_DIR/run-worktrees/<projectSlug>/<runId>
 * Branch scheme: setra/run-<runId>
 *
 * Both are deterministic from the runId so a crash-and-resume can locate
 * an existing worktree without consulting the DB.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface RunWorktreeIdentity {
	runId: string;
	projectSlug?: string;
}

export interface RunWorktreeLayout {
	directory: string;
	branchName: string;
}

const SAFE_SLUG = /[^a-z0-9-]+/g;

function sanitize(slug: string, fallback: string): string {
	const cleaned = (slug ?? "").toLowerCase().replace(SAFE_SLUG, "-");
	const trimmed = cleaned.replace(/^-+|-+$/g, "");
	return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Resolve the on-disk worktree directory and the branch name for a given
 * run. Pure - does not touch the filesystem.
 */
export function resolveRunWorktree(
	identity: RunWorktreeIdentity,
	dataDir: string = process.env.SETRA_DATA_DIR ??
		join(process.env.HOME ?? "", ".setra"),
): RunWorktreeLayout {
	const project = sanitize(identity.projectSlug ?? "", "default");
	const runId = sanitize(identity.runId, "unknown");
	const directory = join(dataDir, "run-worktrees", project, runId);
	const branchName = `setra/run-${runId}`;
	return { directory, branchName };
}

/**
 * Ensure the parent directory exists so a subsequent `git worktree add`
 * can succeed. Idempotent.
 */
export function ensureRunWorktreeParent(layout: RunWorktreeLayout): void {
	mkdirSync(join(layout.directory, ".."), { recursive: true });
}
