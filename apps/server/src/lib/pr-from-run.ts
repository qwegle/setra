/**
 * P21: PR-from-run.
 *
 * Given a completed and approved run, open a real GitHub pull request whose
 * body is the rendered evidence bundle. Returns the PR URL and the assembled
 * bundle so callers can persist artifacts.
 *
 * This is the autoresearch PR #44 pattern adapted to Setra: the agent's work
 * becomes a self-describing PR, and the cross-run memory layer (P22) later
 * reads these PRs back to inform new runs.
 */

import { openPullRequest } from "@setra/git/github";
import {
	renderRunBundleMarkdown,
	renderRunToolCallsTsv,
} from "./run-bundle-markdown.js";
import { type RunBundle, assembleRunBundle } from "./run-bundle.js";
import { resolveRunWorktree } from "./run-worktree.js";

export const SETRA_RUN_BRANCH_PREFIX = "setra/run-";

export interface OpenPrFromRunInput {
	runId: string;
	repoUrl: string;
	baseBranch?: string;
	token?: string | null;
	title?: string;
	projectSlug?: string;
}

export interface OpenPrFromRunResult {
	prUrl: string;
	prNumber: number | null;
	stub: boolean;
	branch: string;
	bundle: RunBundle;
	bodyMarkdown: string;
	toolCallsTsv: string;
}

/**
 * Build a PR title from the run header. Tests can pass an explicit `title`.
 */
function defaultTitle(bundle: RunBundle): string {
	const display = bundle.run.displayName ?? bundle.run.agentSlug;
	return `[setra] ${display} run ${bundle.run.id}`;
}

export async function openPullRequestFromRun(
	input: OpenPrFromRunInput,
): Promise<OpenPrFromRunResult> {
	const bundle = assembleRunBundle(input.runId);
	if (!bundle) {
		throw new Error(`Run not found: ${input.runId}`);
	}
	if (bundle.run.status && bundle.run.status !== "success") {
		throw new Error(
			`Run ${input.runId} is in status "${bundle.run.status}"; only successful runs may open PRs`,
		);
	}
	const worktree = resolveRunWorktree({
		runId: input.runId,
		...(input.projectSlug !== undefined
			? { projectSlug: input.projectSlug }
			: {}),
	});
	const body = renderRunBundleMarkdown(bundle);
	const tsv = renderRunToolCallsTsv(bundle);
	const pr = await openPullRequest({
		repoUrl: input.repoUrl,
		branch: worktree.branchName,
		baseBranch: input.baseBranch ?? "main",
		title: input.title ?? defaultTitle(bundle),
		body,
		token: input.token ?? null,
	});
	return {
		prUrl: pr.url,
		prNumber: pr.number,
		stub: pr.stub,
		branch: worktree.branchName,
		bundle,
		bodyMarkdown: body,
		toolCallsTsv: tsv,
	};
}
