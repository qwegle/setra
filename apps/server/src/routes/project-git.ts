import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getCompanyId } from "../lib/company-scope.js";
import * as projectsRepo from "../repositories/projects.repo.js";

export const projectGitRoute = new Hono();

const CommitSchema = z.object({
	message: z.string().trim().min(1, "Commit message is required"),
});

const GitPathSchema = z.object({
	path: z.string().trim().min(1, "Path is required"),
});

const BranchSchema = z.object({
	branch: z.string().trim().min(1, "Branch is required"),
});

const StashSchema = z.object({
	message: z.string().trim().optional(),
});

function getWorkspaceRoot(projectId: string, companyId: string): string {
	const project = projectsRepo.getProjectFull(projectId);
	if (!project || project.companyId !== companyId) {
		throw new Error("project not found");
	}
	const root = project.workspacePath?.trim();
	if (!root) throw new Error("workspace is not configured for this project");
	if (!path.isAbsolute(root))
		throw new Error("workspace path must be absolute");
	const stat = statSync(root, { throwIfNoEntry: false });
	if (!stat || !stat.isDirectory()) {
		throw new Error("workspace path does not exist");
	}
	return root;
}

function runGit(root: string, args: string[]): string {
	try {
		return execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			throw new Error("git is not installed");
		}
		const stderr =
			typeof error === "object" && error && "stderr" in error
				? String(error.stderr)
				: "";
		if (stderr.includes("not a git repository")) {
			throw new Error("workspace is not a git repository");
		}
		if (stderr.includes("bad object") || stderr.includes("unknown revision")) {
			throw new Error("commit not found");
		}
		if (
			stderr.includes("nothing to commit") ||
			stderr.includes("no changes added to commit")
		) {
			throw new Error("nothing to commit");
		}
		if (stderr.includes("did not match any file")) {
			throw new Error("path not found");
		}
		throw new Error(
			stderr.trim() ||
				(error instanceof Error ? error.message : "git command failed"),
		);
	}
}

function resolveWorkspacePath(root: string, relativePath: string): string {
	const rel = relativePath.replace(/^\/+/, "");
	const abs = path.resolve(root, rel);
	const normalizedRoot = path.resolve(root);
	if (
		!(abs === normalizedRoot || abs.startsWith(`${normalizedRoot}${path.sep}`))
	) {
		throw new Error("path is outside workspace");
	}
	return abs;
}

function buildUntrackedDiff(root: string, filePath: string): string {
	const abs = resolveWorkspacePath(root, filePath);
	const content = readFileSync(abs, "utf8");
	const lines = content.split(/\r?\n/);
	const additions = lines.map((line) => `+${line}`).join("\n");
	return [
		`diff --git a/${filePath} b/${filePath}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ b/${filePath}`,
		`@@ -0,0 +1,${lines.length} @@`,
		additions,
	].join("\n");
}

function parseStatusLine(line: string) {
	const indexStatus = line[0] === "?" ? "?" : line[0] === " " ? "" : line[0];
	const workingTreeStatus =
		line[1] === "?" ? "?" : line[1] === " " ? "" : line[1];
	return {
		path: line.slice(3).trim(),
		status:
			indexStatus ||
			workingTreeStatus ||
			(line.slice(0, 2) === "??" ? "??" : "M"),
		indexStatus,
		workingTreeStatus,
		staged: Boolean(indexStatus && indexStatus !== "?"),
	};
}

function jsonError(message: string): {
	error: string;
	status: 404 | 422 | 500;
} {
	const status =
		message === "project not found" || message === "commit not found"
			? 404
			: message.includes("workspace") ||
					message.includes("path") ||
					message.includes("branch")
				? 422
				: 500;
	return { error: message, status };
}

projectGitRoute.get("/:projectId/git/log", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
		const limit = Math.max(
			1,
			Math.min(100, Number(c.req.query("limit") ?? 20) || 20),
		);
		const offset = (page - 1) * limit;
		const output = runGit(root, [
			"log",
			"--format=%H|%h|%s|%an|%aI",
			"--stat",
			"-n",
			String(limit),
			"--skip",
			String(offset),
		]);

		const commits: Array<{
			sha: string;
			shortSha: string;
			message: string;
			author: string;
			date: string;
			filesChanged: number;
		}> = [];
		let current:
			| {
					sha: string;
					shortSha: string;
					message: string;
					author: string;
					date: string;
					filesChanged: number;
			  }
			| undefined;

		for (const line of output.split(/\r?\n/)) {
			if (!line.trim()) continue;
			const parts = line.split("|");
			if (parts.length >= 5) {
				if (current) commits.push(current);
				const [sha = "", shortSha = "", ...rest] = parts;
				const date = rest.pop() ?? "";
				const author = rest.pop() ?? "";
				const message = rest.join("|");
				current = { sha, shortSha, message, author, date, filesChanged: 0 };
				continue;
			}
			if (current && line.includes(" | ")) {
				current.filesChanged += 1;
			}
		}
		if (current) commits.push(current);

		return c.json({ commits, page, limit });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to read git history",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.get("/:projectId/git/branches", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		const output = runGit(root, [
			"branch",
			"--format=%(refname:short)|%(HEAD)",
		]);
		const branches = output
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				const [name, head] = line.split("|");
				return { name, current: head?.trim() === "*" };
			});
		return c.json({ branches });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to list branches",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.post(
	"/:projectId/git/checkout",
	zValidator("json", BranchSchema),
	(c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { branch } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			runGit(root, ["checkout", branch]);
			return c.json({ ok: true, branch });
		} catch (error) {
			const { error: message, status } = jsonError(
				error instanceof Error ? error.message : "failed to switch branches",
			);
			return c.json({ error: message }, status);
		}
	},
);

projectGitRoute.post("/:projectId/git/pull", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		const output = runGit(root, ["pull", "--rebase", "--autostash"]);
		return c.json({ ok: true, output });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to pull changes",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.post("/:projectId/git/push", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		const output = runGit(root, ["push"]);
		return c.json({ ok: true, output });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to push changes",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.post(
	"/:projectId/git/stage",
	zValidator("json", GitPathSchema),
	(c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { path: filePath } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			runGit(root, ["add", "--", filePath]);
			return c.json({ ok: true, path: filePath });
		} catch (error) {
			const { error: message, status } = jsonError(
				error instanceof Error ? error.message : "failed to stage file",
			);
			return c.json({ error: message }, status);
		}
	},
);

projectGitRoute.post(
	"/:projectId/git/unstage",
	zValidator("json", GitPathSchema),
	(c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { path: filePath } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			runGit(root, ["restore", "--staged", "--", filePath]);
			return c.json({ ok: true, path: filePath });
		} catch (error) {
			const { error: message, status } = jsonError(
				error instanceof Error ? error.message : "failed to unstage file",
			);
			return c.json({ error: message }, status);
		}
	},
);

projectGitRoute.post(
	"/:projectId/git/stash",
	zValidator("json", StashSchema),
	(c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { message } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			const args = ["stash", "push", "-u"];
			if (message) args.push("-m", message);
			const output = runGit(root, args);
			return c.json({ ok: true, output });
		} catch (error) {
			const { error: message, status } = jsonError(
				error instanceof Error ? error.message : "failed to save stash",
			);
			return c.json({ error: message }, status);
		}
	},
);

projectGitRoute.post("/:projectId/git/stash/pop", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		const output = runGit(root, ["stash", "pop"]);
		return c.json({ ok: true, output });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to pop stash",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.get("/:projectId/git/diff/:sha", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const sha = c.req.param("sha");
		const root = getWorkspaceRoot(projectId, companyId);
		const message = runGit(root, ["log", "-1", "--format=%s", sha]).trim();
		const diff = runGit(root, ["show", sha, "--stat", "--patch", "--format="]);
		return c.json({ sha, message, diff });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to read commit diff",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.get("/:projectId/git/status", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		const output = runGit(root, ["status", "--porcelain"]);
		const files = output.split(/\r?\n/).filter(Boolean).map(parseStatusLine);
		return c.json({ files });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to read git status",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.get("/:projectId/git/working-diff", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const filePath = c.req.query("path");
		if (!filePath) return c.json({ error: "path is required" }, 400);
		const root = getWorkspaceRoot(projectId, companyId);
		const statusOutput = runGit(root, ["status", "--porcelain", "--", filePath])
			.split(/\r?\n/)
			.find(Boolean);
		const status = statusOutput ? parseStatusLine(statusOutput) : null;
		let diff = "";
		if (!status) {
			diff = "";
		} else if (status.status === "??" || status.status === "A") {
			diff = buildUntrackedDiff(root, filePath);
		} else {
			diff = status.staged
				? runGit(root, ["diff", "--cached", "--no-ext-diff", "--", filePath])
				: runGit(root, ["diff", "--no-ext-diff", "--", filePath]);
			if (!diff.trim()) {
				diff = runGit(root, [
					"diff",
					"--cached",
					"--no-ext-diff",
					"--",
					filePath,
				]);
			}
		}
		return c.json({ path: filePath, diff });
	} catch (error) {
		const { error: message, status } = jsonError(
			error instanceof Error ? error.message : "failed to read git diff",
		);
		return c.json({ error: message }, status);
	}
});

projectGitRoute.post(
	"/:projectId/git/commit",
	zValidator("json", CommitSchema),
	(c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { message } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			runGit(root, ["commit", "-m", message]);
			const sha = runGit(root, ["rev-parse", "HEAD"]).trim();
			return c.json({ ok: true, sha });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "failed to create commit";
			const status =
				message === "project not found"
					? 404
					: message === "nothing to commit"
						? 422
						: message.includes("workspace")
							? 422
							: 500;
			return c.json({ error: message }, status);
		}
	},
);

// POST /:projectId/git/revert — reset to a checkpoint (commit SHA)
// body: { sha: string, hard?: boolean }
//   hard=true  → git reset --hard <sha>  (discard all uncommitted changes)
//   hard=false → git revert <sha>         (creates a new revert commit)
const RevertSchema = z.object({
	sha: z.string().min(4).max(40),
	hard: z.boolean().optional().default(false),
});

projectGitRoute.post(
	"/:projectId/git/revert",
	zValidator("json", RevertSchema),
	(c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { sha, hard } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			if (hard) {
				runGit(root, ["reset", "--hard", sha]);
			} else {
				runGit(root, ["revert", "--no-edit", sha]);
			}
			const head = runGit(root, ["rev-parse", "HEAD"]).trim();
			return c.json({ ok: true, head });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "failed to revert";
			return c.json(
				{ error: message },
				message === "project not found" ? 404 : 500,
			);
		}
	},
);

// GET /:projectId/git/remote — get the remote origin URL
projectGitRoute.get("/:projectId/git/remote", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const root = getWorkspaceRoot(projectId, companyId);
		let remoteUrl: string | null = null;
		try {
			remoteUrl = runGit(root, ["remote", "get-url", "origin"]).trim() || null;
		} catch {
			remoteUrl = null;
		}
		const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
		return c.json({ remoteUrl, branch });
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : "failed" },
			500,
		);
	}
});
