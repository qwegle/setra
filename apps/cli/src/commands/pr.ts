/**
 * setra pr — PR review workflow commands
 *
 * setra pr list [--repo owner/repo]       — list open PRs
 * setra pr review <pr-number>             — start a review agent session
 * setra pr diff <pr-number>               — show PR diff in terminal
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type PrDiffFile,
	type PrInfo,
	prGetDiff,
	prListOpen,
} from "@setra/agent-runner/tools/pr-review";
import chalk from "chalk";

// ─── Token resolution ─────────────────────────────────────────────────────────

function resolveToken(tokenArg?: string): string {
	if (tokenArg) return tokenArg;

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
			// ignore parse errors
		}
	}

	return "";
}

function parseOwnerRepo(repoArg: string): { owner: string; repo: string } {
	const [owner, repo] = repoArg.split("/");
	if (!owner || !repo) {
		throw new Error(
			`Invalid repo format. Expected owner/repo, got: ${repoArg}`,
		);
	}
	return { owner, repo };
}

/** Try to detect owner/repo from git remote in the current directory */
function detectOwnerRepo(): { owner: string; repo: string } | null {
	try {
		const remote = execSync("git remote get-url origin 2>/dev/null", {
			stdio: ["pipe", "pipe", "pipe"],
		})
			.toString()
			.trim();

		// Parse https://github.com/owner/repo.git or git@github.com:owner/repo.git
		const httpsMatch = remote.match(/github\.com\/([^/]+)\/([^/.]+)/);
		const sshMatch = remote.match(/github\.com:([^/]+)\/([^/.]+)/);
		const match = httpsMatch ?? sshMatch;
		if (match?.[1] && match[2]) {
			return { owner: match[1], repo: match[2] };
		}
	} catch {
		// not in a git repo or no remote
	}
	return null;
}

// ─── pr list ─────────────────────────────────────────────────────────────────

export async function prListCommand(opts: {
	repo?: string;
	token?: string;
}): Promise<void> {
	const token = resolveToken(opts.token);
	if (!token) {
		console.error(
			chalk.red(
				"No GitHub token found. Set GITHUB_TOKEN env, pass --token, or add github_token to ~/.setra/settings.json",
			),
		);
		process.exit(1);
	}

	let owner: string;
	let repo: string;

	if (opts.repo) {
		({ owner, repo } = parseOwnerRepo(opts.repo));
	} else {
		const detected = detectOwnerRepo();
		if (!detected) {
			console.error(
				chalk.red(
					"Could not detect repository. Use --repo owner/repo to specify.",
				),
			);
			process.exit(1);
		}
		({ owner, repo } = detected);
	}

	console.log(chalk.dim(`Fetching open PRs for ${owner}/${repo}…`));

	let prs: PrInfo[];
	try {
		prs = await prListOpen(owner, repo, token);
	} catch (err) {
		console.error(chalk.red(`Failed to fetch PRs: ${(err as Error).message}`));
		process.exit(1);
	}

	if (prs.length === 0) {
		console.log(chalk.dim("No open pull requests."));
		return;
	}

	console.log(
		chalk.bold(
			`\nOpen PRs in ${chalk.cyan(`${owner}/${repo}`)} (${prs.length})\n`,
		),
	);

	for (const pr of prs) {
		const num = chalk.yellow(`#${pr.number}`);
		const title = chalk.white(pr.title);
		const author = chalk.dim(`@${pr.user?.login ?? "unknown"}`);
		const branch = chalk.dim(`${pr.head?.ref ?? "?"} → ${pr.base?.ref ?? "?"}`);
		console.log(`  ${num}  ${title}`);
		console.log(`       ${author}  ${branch}`);
		console.log(`       ${chalk.dim(pr.html_url)}`);
		console.log();
	}
}

// ─── pr diff ─────────────────────────────────────────────────────────────────

export async function prDiffCommand(
	prNumber: number,
	opts: { repo?: string; token?: string },
): Promise<void> {
	const token = resolveToken(opts.token);
	if (!token) {
		console.error(chalk.red("No GitHub token found. Set GITHUB_TOKEN env."));
		process.exit(1);
	}

	let owner: string;
	let repo: string;

	if (opts.repo) {
		({ owner, repo } = parseOwnerRepo(opts.repo));
	} else {
		const detected = detectOwnerRepo();
		if (!detected) {
			console.error(
				chalk.red("Could not detect repository. Use --repo owner/repo."),
			);
			process.exit(1);
		}
		({ owner, repo } = detected);
	}

	console.log(chalk.dim(`Fetching diff for PR #${prNumber}…`));

	let files: PrDiffFile[];
	try {
		files = await prGetDiff(owner, repo, prNumber, token);
	} catch (err) {
		console.error(chalk.red(`Failed to fetch diff: ${(err as Error).message}`));
		process.exit(1);
	}

	if (files.length === 0) {
		console.log(chalk.dim("No changed files in this PR."));
		return;
	}

	for (const file of files) {
		const statusColor =
			file.status === "added"
				? chalk.green
				: file.status === "removed"
					? chalk.red
					: chalk.yellow;

		console.log(
			`\n${statusColor("─".repeat(60))}\n${statusColor(file.filename)} ${chalk.dim(`+${file.additions} -${file.deletions}`)}`,
		);

		if (file.patch) {
			for (const line of file.patch.split("\n")) {
				if (line.startsWith("+") && !line.startsWith("+++")) {
					process.stdout.write(chalk.green(line) + "\n");
				} else if (line.startsWith("-") && !line.startsWith("---")) {
					process.stdout.write(chalk.red(line) + "\n");
				} else if (line.startsWith("@@")) {
					process.stdout.write(chalk.cyan(line) + "\n");
				} else {
					process.stdout.write(line + "\n");
				}
			}
		}
	}
}

// ─── pr review ───────────────────────────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Review this PR thoroughly: check logic, security, performance, style. Post inline comments for specific issues and submit a final review.

Use these tools:
- pr_get_diff: fetch all changed files
- pr_post_comment: post inline comments on specific lines
- pr_submit_review: submit your final verdict (APPROVE, REQUEST_CHANGES, or COMMENT)

Be constructive, specific, and thorough. Check for:
- Logic bugs and edge cases
- Security vulnerabilities (injection, auth bypass, data exposure)
- Performance issues (N+1 queries, unnecessary loops)
- Code style and maintainability
- Missing error handling
- Test coverage gaps`;

export async function prReviewCommand(
	prNumber: number,
	opts: { repo?: string; token?: string },
): Promise<void> {
	const token = resolveToken(opts.token);
	if (!token) {
		console.error(chalk.red("No GitHub token found. Set GITHUB_TOKEN env."));
		process.exit(1);
	}

	let owner: string;
	let repo: string;

	if (opts.repo) {
		({ owner, repo } = parseOwnerRepo(opts.repo));
	} else {
		const detected = detectOwnerRepo();
		if (!detected) {
			console.error(
				chalk.red("Could not detect repository. Use --repo owner/repo."),
			);
			process.exit(1);
		}
		({ owner, repo } = detected);
	}

	console.log(
		chalk.bold(
			`\n🔍 Starting PR review agent for ${chalk.cyan(`${owner}/${repo}#${prNumber}`)}\n`,
		),
	);
	console.log(
		chalk.dim("System prompt: " + REVIEW_SYSTEM_PROMPT.slice(0, 120) + "…"),
	);
	console.log();
	console.log(
		chalk.dim(
			"Available tools: pr_get_diff, pr_post_comment, pr_submit_review",
		),
	);
	console.log();
	console.log(
		chalk.yellow(
			"To integrate with a live agent, pass the PR_REVIEW_TOOLS to your agent runner\nand provide GITHUB_TOKEN in the environment.",
		),
	);
	console.log();
	console.log(
		chalk.dim(`PR: https://github.com/${owner}/${repo}/pull/${prNumber}`),
	);
	console.log(chalk.dim(`Token scope: ${token.slice(0, 8)}…`));
}
