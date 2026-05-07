/**
 * GitHub PR helper.
 */

export interface OpenPrInput {
	/** Full repo URL or "owner/repo" form, e.g. github.com/foo/bar. */
	repoUrl: string;
	branch: string;
	baseBranch: string;
	title: string;
	body: string;
	token?: string | null;
}

export interface OpenPrResult {
	url: string;
	number: number | null;
	state: "open";
	/** True when this is a stub (no real GitHub call was made). */
	stub: boolean;
}

/**
 * Parse `github.com/owner/repo` (with or without scheme/.git suffix) into
 * an `owner/repo` slug. Returns null for non-GitHub URLs.
 */
export function parseGitHubSlug(
	repoUrl: string,
): { owner: string; repo: string } | null {
	if (!repoUrl) return null;
	const cleaned = repoUrl
		.replace(/^git@github\.com:/i, "")
		.replace(/^https?:\/\//i, "")
		.replace(/^github\.com\//i, "")
		.replace(/\.git$/i, "")
		.replace(/^\/+|\/+$/g, "");
	const parts = cleaned.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	return { owner: parts[0], repo: parts[1] };
}

function getGitHubToken(token?: string | null): string {
	const resolved = token?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
	if (!resolved) {
		throw new Error(
			"GitHub token missing. Set GITHUB_TOKEN or configure the GitHub integration.",
		);
	}
	return resolved;
}

async function parseGitHubError(response: Response): Promise<string> {
	const fallback = `GitHub API ${response.status}`;
	try {
		const data = (await response.json()) as {
			message?: string;
			errors?: Array<{ message?: string }>;
		};
		const details = Array.isArray(data.errors)
			? data.errors
					.map((error) => error.message)
					.filter(Boolean)
					.join("; ")
			: "";
		return [data.message, details].filter(Boolean).join(": ") || fallback;
	} catch {
		const text = await response.text().catch(() => "");
		return text.trim() ? `${fallback}: ${text.slice(0, 300)}` : fallback;
	}
}

function parsePullRequestNumber(prUrl: string): number {
	const match = prUrl.match(/\/pull\/(\d+)(?:$|[/?#])/i);
	if (!match)
		throw new Error(
			`Could not determine pull request number from URL: ${prUrl}`,
		);
	return Number(match[1]);
}

export async function openPullRequest(
	input: OpenPrInput,
): Promise<OpenPrResult> {
	const slug = parseGitHubSlug(input.repoUrl);
	if (!slug) {
		throw new Error(`Invalid GitHub repository URL: ${input.repoUrl}`);
	}
	const token = getGitHubToken(input.token);
	const response = await fetch(
		`https://api.github.com/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/pulls`,
		{
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: JSON.stringify({
				title: input.title,
				head: input.branch,
				base: input.baseBranch,
				body: input.body,
			}),
		},
	);
	if (!response.ok) {
		throw new Error(await parseGitHubError(response));
	}
	const data = (await response.json()) as {
		html_url?: string;
		number?: number;
		state?: string;
	};
	return {
		url:
			data.html_url ??
			`https://github.com/${slug.owner}/${slug.repo}/pull/new/${input.branch}`,
		number: data.number ?? null,
		state: "open",
		stub: false,
	};
}

export async function mergePullRequest(input: {
	repoUrl: string;
	prUrl: string;
	token?: string | null;
}): Promise<{ merged: true; stub: boolean }> {
	const slug = parseGitHubSlug(input.repoUrl);
	if (!slug) {
		throw new Error(`Invalid GitHub repository URL: ${input.repoUrl}`);
	}
	const token = getGitHubToken(input.token);
	const pullNumber = parsePullRequestNumber(input.prUrl);
	const response = await fetch(
		`https://api.github.com/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}/pulls/${pullNumber}/merge`,
		{
			method: "PUT",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
	);
	if (!response.ok) {
		throw new Error(await parseGitHubError(response));
	}
	const data = (await response.json()) as {
		merged?: boolean;
		message?: string;
	};
	if (!data.merged) {
		throw new Error(
			data.message || "GitHub reported the pull request was not merged.",
		);
	}
	return { merged: true, stub: false };
}
