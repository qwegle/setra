/**
 * IPC handlers for the PR review workflow.
 * Proxies GitHub API calls from the renderer process.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ipcMain } from "electron";

function resolveToken(): string {
	const envToken = process.env["GITHUB_TOKEN"];
	if (envToken) return envToken;

	const settingsPath = join(homedir(), ".setra", "settings.json");
	if (existsSync(settingsPath)) {
		try {
			const settings = JSON.parse(
				readFileSync(settingsPath, "utf-8"),
			) as Record<string, unknown>;
			if (typeof settings["github_token"] === "string") {
				return settings["github_token"];
			}
		} catch {
			// ignore
		}
	}
	return "";
}

function githubHeaders(token: string) {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
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
			"Content-Type": "application/json",
			...(options.headers as Record<string, string> | undefined),
		},
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`GitHub API error ${res.status}: ${text}`);
	}
	return text ? JSON.parse(text) : null;
}

export function registerPrHandlers(): void {
	// pr:list — list open PRs for a repo
	ipcMain.handle("pr:list", async (_event, ownerRepo: string) => {
		const [owner, repo] = ownerRepo.split("/");
		if (!owner || !repo) throw new Error(`Invalid repo: ${ownerRepo}`);
		const token = resolveToken();
		if (!token) throw new Error("No GITHUB_TOKEN configured");
		return ghFetch(
			`https://api.github.com/repos/${owner}/${repo}/pulls?state=open`,
			token,
		);
	});

	// pr:get-diff — get diff files for a PR
	ipcMain.handle(
		"pr:get-diff",
		async (_event, ownerRepo: string, prNumber: number) => {
			const [owner, repo] = ownerRepo.split("/");
			if (!owner || !repo) throw new Error(`Invalid repo: ${ownerRepo}`);
			const token = resolveToken();
			if (!token) throw new Error("No GITHUB_TOKEN configured");
			return ghFetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
				token,
			);
		},
	);

	// pr:submit-review — submit a review decision
	ipcMain.handle(
		"pr:submit-review",
		async (
			_event,
			ownerRepo: string,
			prNumber: number,
			event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
			body: string,
		) => {
			const [owner, repo] = ownerRepo.split("/");
			if (!owner || !repo) throw new Error(`Invalid repo: ${ownerRepo}`);
			const token = resolveToken();
			if (!token) throw new Error("No GITHUB_TOKEN configured");
			return ghFetch(
				`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
				token,
				{ method: "POST", body: JSON.stringify({ event, body }) },
			);
		},
	);

	// pr:start-review — spawn a review agent (stub: returns system prompt info)
	ipcMain.handle(
		"pr:start-review",
		async (_event, ownerRepo: string, prNumber: number) => {
			const token = resolveToken();
			if (!token) throw new Error("No GITHUB_TOKEN configured");
			const [owner, repo] = ownerRepo.split("/");

			// Fetch diff to include in agent context
			let fileCount = 0;
			try {
				const files = (await ghFetch(
					`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
					token,
				)) as Array<{ filename: string }>;
				fileCount = files.length;
			} catch {
				// non-fatal
			}

			return [
				`🔍 Review agent started for ${ownerRepo}#${prNumber}`,
				`📂 ${fileCount} file(s) changed`,
				``,
				`System prompt: You are a senior code reviewer. Review this PR thoroughly:`,
				`check logic, security, performance, style. Post inline comments for specific`,
				`issues and submit a final review.`,
				``,
				`Tools available: pr_get_diff, pr_post_comment, pr_submit_review`,
				``,
				`To run a live agent, integrate PR_REVIEW_TOOLS from @setra/agent-runner`,
				`with your agent adapter and provide GITHUB_TOKEN in the environment.`,
			].join("\n");
		},
	);
}
