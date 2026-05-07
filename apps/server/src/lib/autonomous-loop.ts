/**
 * autonomous-loop.ts — Git-backed autonomous dispatch cycle.
 *
 * Called from dispatchOnce() after the main issue→agent→run pairing.
 * For every run that was just created (status='pending') and whose issue
 * lacks a branch_name, this module:
 *   1. Creates a git branch `setra/<issue-id>-<slug>` off the project default.
 *   2. Creates a git worktree at `~/.setra/plots/<plotId>/`.
 *   3. Updates plots.worktree_path to the new worktree.
 *   4. Sets board_issues.branch_name.
 *   5. Posts a comment on the issue: "🤖 Agent @<agent> started working on this"
 *   6. Posts a lifecycle event to the project channel.
 *
 * All git operations use execFile (async, non-blocking). Failures are
 * logged and swallowed — a git error must never abort a run.
 */

import { execFile as _execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getRawDb } from "@setra/db";
import { postChannelMessage } from "./channel-hooks.js";
import { buildIssueBranchName } from "./issue-branch.js";
import { addAutomationIssueComment } from "./issue-comments.js";

const execFile = promisify(_execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingDispatch {
	run_id: string;
	plot_id: string;
	agent_slug: string;
	agent_display_name: string;
	issue_id: string | null;
	issue_title: string | null;
	issue_company_id: string | null;
	workspace_path: string | null;
	branch: string | null;
	project_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setraPlotsRoot(): string {
	return join(homedir(), ".setra", "plots");
}

async function gitExec(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return execFile("git", args, { cwd }).catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`git ${args[0]} failed in ${cwd}: ${msg}`);
	});
}

function getDefaultBranch(repoPath: string): string {
	try {
		const db = getRawDb();
		const row = db
			.prepare(
				`SELECT default_branch FROM board_projects WHERE workspace_path = ? OR repo_path = ? LIMIT 1`,
			)
			.get(repoPath, repoPath) as { default_branch: string } | undefined;
		return row?.default_branch ?? "main";
	} catch {
		return "main";
	}
}

// ─── Git setup ────────────────────────────────────────────────────────────────

async function setupWorktree(
	repoPath: string,
	branchName: string,
	worktreePath: string,
	defaultBranch: string,
): Promise<void> {
	// Ensure the branch exists (off the default branch).
	try {
		await gitExec(repoPath, ["branch", branchName, defaultBranch]);
	} catch {
		// Branch may already exist — that's fine.
	}

	// Create the worktree directory hierarchy.
	mkdirSync(worktreePath, { recursive: true });

	// Add the worktree. Fails gracefully if it already exists.
	try {
		await gitExec(repoPath, ["worktree", "add", worktreePath, branchName]);
	} catch (err) {
		// If worktree already registered, try to repair it.
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("already exists") || msg.includes("already checked out")) {
			console.warn(
				`[autonomous-loop] worktree already registered for ${branchName}, skipping add`,
			);
		} else {
			throw err;
		}
	}
}

// ─── Main cycle ───────────────────────────────────────────────────────────────

/**
 * For every newly-dispatched run in the given company that lacks a git worktree,
 * create the branch + worktree and post a start comment on the linked issue.
 *
 * The `companyId` parameter is used for channel hooks and comments.
 * Returns the number of worktrees successfully set up.
 */
export async function autonomousDispatchCycle(
	companyId: string,
): Promise<number> {
	const db = getRawDb();

	// Find runs created within the last 2 minutes whose plot has no worktree yet
	// but has a linked board issue. This catches every fresh dispatch.
	const rows = db
		.prepare(
			`SELECT
         r.id             AS run_id,
         r.plot_id,
         r.agent          AS agent_slug,
         ar.display_name  AS agent_display_name,
         bi.id            AS issue_id,
         bi.title         AS issue_title,
         bi.company_id    AS issue_company_id,
         COALESCE(NULLIF(trim(bp.workspace_path), ''), NULLIF(trim(bp.repo_path), '')) AS workspace_path,
         COALESCE(NULLIF(trim(r.branch_name), ''), NULLIF(trim(bi.branch_name), ''), NULLIF(trim(pl.branch), '')) AS branch,
         pl.project_id
       FROM runs r
       JOIN plots pl         ON pl.id = r.plot_id
       JOIN agent_roster ar  ON ar.slug = r.agent
       LEFT JOIN board_issues bi  ON bi.linked_plot_id = r.plot_id
       LEFT JOIN board_projects bp ON bp.id = bi.project_id
       WHERE r.status IN ('pending', 'running')
         AND ar.company_id = ?
         AND (bi.branch_name IS NULL OR bi.branch_name = '')
         AND r.started_at >= datetime('now', '-2 minutes')
       ORDER BY r.started_at ASC
       LIMIT 10`,
		)
		.all(companyId) as PendingDispatch[];

	if (rows.length === 0) return 0;

	const plotsRoot = setraPlotsRoot();
	let setupCount = 0;

	for (const row of rows) {
		try {
			const branchName =
				row.branch && row.branch.trim().length > 0
					? row.branch
					: buildIssueBranchName(row.issue_id ?? row.plot_id, row.issue_title);
			const worktreePath = join(plotsRoot, row.plot_id);
			const now = new Date().toISOString();

			if (row.workspace_path && existsSync(row.workspace_path)) {
				const defaultBranch = getDefaultBranch(row.workspace_path);

				await setupWorktree(
					row.workspace_path,
					branchName,
					worktreePath,
					defaultBranch,
				);

				// Update the plot to point at the new worktree.
				db.prepare(
					`UPDATE plots
           SET worktree_path = ?, branch = ?, updated_at = ?
           WHERE id = ?`,
				).run(worktreePath, branchName, now, row.plot_id);
			} else {
				// No repo accessible server-side (desktop-only); just record branch name.
				db.prepare(
					`UPDATE plots SET branch = ?, updated_at = ? WHERE id = ?`,
				).run(branchName, now, row.plot_id);
			}

			db.prepare(
				`UPDATE runs SET branch_name = ?, updated_at = ? WHERE id = ?`,
			).run(branchName, now, row.run_id);

			// Stamp the branch name on the issue.
			if (row.issue_id) {
				db.prepare(
					`UPDATE board_issues
           SET branch_name = ?, updated_at = ?
           WHERE id = ?`,
				).run(branchName, now, row.issue_id);
			}

			// Post issue comment.
			if (row.issue_id) {
				addAutomationIssueComment(
					row.issue_id,
					row.issue_company_id,
					`🤖 Agent @${row.agent_slug} started working on this (branch: \`${branchName}\`)`,
					row.agent_slug,
				);
			}

			// Post lifecycle event to project channel.
			if (row.issue_company_id) {
				postChannelMessage(
					row.issue_company_id,
					"general",
					row.agent_slug,
					row.agent_display_name ?? row.agent_slug,
					"started",
					{ runId: row.run_id, issueId: row.issue_id ?? null },
				);
			}

			console.log(
				`[autonomous-loop] set up worktree for run=${row.run_id} branch=${branchName}`,
			);
			setupCount++;
		} catch (err) {
			console.warn(
				`[autonomous-loop] git setup failed for run=${row.run_id}:`,
				err,
			);
		}
	}

	return setupCount;
}
