/**
 * MCP tool definitions for PR review workflow.
 * Supports GitHub (and basic GitLab) PRs.
 */

export const PR_REVIEW_TOOLS = [
	{
		name: "pr_get_diff",
		description: "Fetch the full diff of a pull request",
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				pr_number: { type: "number" },
				token: {
					type: "string",
					description: "GitHub/GitLab personal access token",
				},
			},
			required: ["owner", "repo", "pr_number", "token"],
		},
	},
	{
		name: "pr_post_comment",
		description: "Post a review comment on a specific line of a PR diff",
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				pr_number: { type: "number" },
				token: { type: "string" },
				body: { type: "string" },
				path: { type: "string", description: "File path in the diff" },
				line: { type: "number", description: "Line number to comment on" },
				commit_id: { type: "string" },
			},
			required: ["owner", "repo", "pr_number", "token", "body"],
		},
	},
	{
		name: "pr_submit_review",
		description:
			"Submit a formal PR review: APPROVE, REQUEST_CHANGES, or COMMENT",
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				pr_number: { type: "number" },
				token: { type: "string" },
				event: {
					type: "string",
					enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"],
				},
				body: { type: "string", description: "Overall review summary" },
			},
			required: ["owner", "repo", "pr_number", "token", "event", "body"],
		},
	},
	{
		name: "pr_list_open",
		description: "List open PRs in a repository",
		inputSchema: {
			type: "object",
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				token: { type: "string" },
			},
			required: ["owner", "repo", "token"],
		},
	},
];

// ─── GitHub API helpers ───────────────────────────────────────────────────────

function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"Content-Type": "application/json",
	};
}

async function ghFetch(
	url: string,
	token: string,
	options: RequestInit = {},
): Promise<unknown> {
	const res = await fetch(url, {
		...options,
		headers: {
			...githubHeaders(token),
			...(options.headers as Record<string, string> | undefined),
		},
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`GitHub API error ${res.status}: ${text}`);
	}
	return text ? (JSON.parse(text) as unknown) : null;
}

// ─── GitLab API helpers ───────────────────────────────────────────────────────

function isGitLabToken(token: string): boolean {
	return (
		token.startsWith("glpat-") ||
		!!process.env["GITLAB_TOKEN"] ||
		token === process.env["GITLAB_TOKEN"]
	);
}

function gitlabHeaders(token: string): Record<string, string> {
	return {
		"PRIVATE-TOKEN": token,
		"Content-Type": "application/json",
	};
}

async function glFetch(
	url: string,
	token: string,
	options: RequestInit = {},
): Promise<unknown> {
	const res = await fetch(url, {
		...options,
		headers: {
			...gitlabHeaders(token),
			...(options.headers as Record<string, string> | undefined),
		},
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`GitLab API error ${res.status}: ${text}`);
	}
	return text ? (JSON.parse(text) as unknown) : null;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export interface PrDiffFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	patch?: string;
}

export interface PrInfo {
	number: number;
	title: string;
	state: string;
	html_url: string;
	user: { login: string };
	head: { sha: string; ref: string };
	base: { ref: string };
	body?: string | null;
	created_at: string;
	updated_at: string;
}

export async function prGetDiff(
	owner: string,
	repo: string,
	prNumber: number,
	token: string,
): Promise<PrDiffFile[]> {
	if (isGitLabToken(token)) {
		const projectId = encodeURIComponent(`${owner}/${repo}`);
		const data = (await glFetch(
			`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prNumber}/diffs`,
			token,
		)) as Array<{
			new_path: string;
			diff: string;
			new_file: boolean;
			deleted_file: boolean;
			renamed_file: boolean;
		}>;

		return data.map((d) => ({
			filename: d.new_path,
			status: d.new_file ? "added" : d.deleted_file ? "removed" : "modified",
			additions: (d.diff.match(/^\+/gm) ?? []).length,
			deletions: (d.diff.match(/^-/gm) ?? []).length,
			patch: d.diff,
		}));
	}

	return (await ghFetch(
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
		token,
	)) as PrDiffFile[];
}

export async function prPostComment(
	owner: string,
	repo: string,
	prNumber: number,
	token: string,
	body: string,
	path?: string,
	line?: number,
	commitId?: string,
): Promise<unknown> {
	if (isGitLabToken(token)) {
		const projectId = encodeURIComponent(`${owner}/${repo}`);
		return glFetch(
			`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prNumber}/notes`,
			token,
			{ method: "POST", body: JSON.stringify({ body }) },
		);
	}

	const payload: Record<string, unknown> = { body };
	if (path && line !== undefined && commitId) {
		payload.path = path;
		payload.line = line;
		payload.commit_id = commitId;
		payload.side = "RIGHT";
	}

	return ghFetch(
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
		token,
		{ method: "POST", body: JSON.stringify(payload) },
	);
}

export async function prSubmitReview(
	owner: string,
	repo: string,
	prNumber: number,
	token: string,
	event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
	body: string,
): Promise<unknown> {
	if (isGitLabToken(token)) {
		const projectId = encodeURIComponent(`${owner}/${repo}`);
		if (event === "APPROVE") {
			return glFetch(
				`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prNumber}/approve`,
				token,
				{ method: "POST" },
			);
		}
		return glFetch(
			`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${prNumber}/notes`,
			token,
			{ method: "POST", body: JSON.stringify({ body: `[${event}] ${body}` }) },
		);
	}

	return ghFetch(
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
		token,
		{ method: "POST", body: JSON.stringify({ event, body }) },
	);
}

export async function prListOpen(
	owner: string,
	repo: string,
	token: string,
): Promise<PrInfo[]> {
	if (isGitLabToken(token)) {
		const projectId = encodeURIComponent(`${owner}/${repo}`);
		return (await glFetch(
			`https://gitlab.com/api/v4/projects/${projectId}/merge_requests?state=opened`,
			token,
		)) as PrInfo[];
	}

	return (await ghFetch(
		`https://api.github.com/repos/${owner}/${repo}/pulls?state=open`,
		token,
	)) as PrInfo[];
}
