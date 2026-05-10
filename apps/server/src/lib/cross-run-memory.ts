/**
 * P22: cross-run memory.
 *
 * Before a new run starts, the agent should be able to look at prior
 * setra/run-* pull requests for the same component or tag and learn from
 * them. This module exposes a thin search shim over the GitHub PR list
 * filtered to the Setra branch prefix.
 *
 * The implementation is intentionally network-light: it issues a single
 * authenticated request per query and applies all filtering client-side
 * so callers can query by component (label) or by branch substring without
 * spending additional API budget on per-PR fetches.
 */

import { parseGitHubSlug } from "@setra/git/github";
import { SETRA_RUN_BRANCH_PREFIX } from "./pr-from-run.js";

export interface PriorRunPr {
	prNumber: number;
	prUrl: string;
	title: string;
	branch: string;
	mergedAt: string | null;
	labels: string[];
	runId: string | null;
}

export interface FindPriorRunPrsInput {
	repoUrl: string;
	token: string;
	component?: string;
	limit?: number;
	state?: "open" | "closed" | "all";
}

interface GitHubPr {
	number: number;
	html_url: string;
	title: string;
	merged_at: string | null;
	head?: { ref?: string };
	labels?: Array<{ name?: string }>;
}

function extractRunId(branch: string): string | null {
	if (!branch.startsWith(SETRA_RUN_BRANCH_PREFIX)) return null;
	return branch.slice(SETRA_RUN_BRANCH_PREFIX.length) || null;
}

function matchesComponent(pr: PriorRunPr, component: string): boolean {
	const needle = component.toLowerCase();
	if (pr.labels.some((l) => l.toLowerCase() === needle)) return true;
	return pr.title.toLowerCase().includes(needle);
}

export async function findPriorRunPrs(
	input: FindPriorRunPrsInput,
): Promise<PriorRunPr[]> {
	const slug = parseGitHubSlug(input.repoUrl);
	if (!slug) throw new Error(`Invalid GitHub repository URL: ${input.repoUrl}`);
	const state = input.state ?? "closed";
	const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
	const url = `https://api.github.com/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/pulls?state=${state}&per_page=${limit}&sort=updated&direction=desc`;
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${input.token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`GitHub PR list failed: ${response.status}`);
	}
	const list = (await response.json()) as GitHubPr[];
	const setraPrs: PriorRunPr[] = list
		.filter((pr) => (pr.head?.ref ?? "").startsWith(SETRA_RUN_BRANCH_PREFIX))
		.map((pr) => ({
			prNumber: pr.number,
			prUrl: pr.html_url,
			title: pr.title,
			branch: pr.head?.ref ?? "",
			mergedAt: pr.merged_at,
			labels: (pr.labels ?? [])
				.map((l) => l.name ?? "")
				.filter((n) => n.length > 0),
			runId: extractRunId(pr.head?.ref ?? ""),
		}));
	if (input.component && input.component.length > 0) {
		return setraPrs.filter((pr) => matchesComponent(pr, input.component!));
	}
	return setraPrs;
}
