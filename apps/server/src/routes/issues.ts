import { zValidator } from "@hono/zod-validator";
import { IssuesService } from "@setra/application";
import {
	GitError,
	commit as gitCommit,
	createBranch as gitCreateBranch,
	merge as gitMerge,
	kebab,
} from "@setra/git";
import { mergePullRequest, openPullRequest } from "@setra/git/github";
import {
	SqliteIssuesRepository,
	requireTenantScope,
} from "@setra/infrastructure";
import { Hono } from "hono";
import { recordObservation } from "../clone/observer.js";
import { companyRequiresApproval } from "../lib/approval-gates.js";
import { logActivity } from "../lib/audit.js";
import { postProjectMessage } from "../lib/channel-hooks.js";
import { getCompanyId } from "../lib/company-scope.js";
import { type LifecycleStage, transitionStage } from "../lib/lifecycle.js";
import { startIssueTestRun } from "../lib/run-lifecycle.js";
import { rebuildSprintBoard } from "../lib/sprint-board.js";
import * as approvalsRepo from "../repositories/approvals.repo.js";
import * as integrationsRepo from "../repositories/integrations.repo.js";
import * as issuesRepo from "../repositories/issues.repo.js";
import { domainEventBus, publishDomainEvent } from "../sse/handler.js";
import {
	AddCommentSchema,
	BranchIssueSchema,
	CommitIssueSchema,
	CreateIssueSchema,
	LifecycleStageSchema,
	LinkIssueSchema,
	MergePrSchema,
	OpenPrSchema,
	UpdateIssueSchema,
} from "../validators/issues.validators.js";

export const issuesRoute = new Hono();
const issuesService = new IssuesService(
	new SqliteIssuesRepository(),
	domainEventBus,
);

function resolveGitHubToken(companyId: string): string | null {
	const envToken = process.env.GITHUB_TOKEN?.trim();
	if (envToken) return envToken;
	const integration = integrationsRepo
		.listIntegrations(companyId)
		.find((row) => row.type.toLowerCase() === "github");
	if (!integration || !integration.config) return null;
	for (const key of ["token", "accessToken", "githubToken", "pat", "apiKey"]) {
		const value = integration.config[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

async function maybeCompleteParentIssue(
	c: Parameters<typeof getCompanyId>[0],
	companyId: string,
	parentIssueId: unknown,
): Promise<void> {
	if (typeof parentIssueId !== "string" || parentIssueId.length === 0) return;
	const parent = issuesRepo.completeParentIssueIfDone(parentIssueId, companyId);
	if (!parent) return;
	issuesRepo.addActivityLog(
		parent.id,
		companyId,
		"system",
		"status_changed",
		JSON.stringify({ to: "done", reason: "all_sub_issues_done" }),
	);
	publishDomainEvent({
		type: "issue.updated",
		issueId: parent.id,
		projectId: parent.projectId,
		companyId,
		event: "updated",
	});
	await logActivity(c, "issue.auto_completed", "issue", parent.id, {
		reason: "all_sub_issues_done",
	});
	rebuildSprintBoard(parent.projectId);
}

issuesRoute.post("/", zValidator("json", CreateIssueSchema), async (c) => {
	const body = c.req.valid("json");
	const acceptanceCriteria =
		body.acceptanceCriteria ?? body.acceptance_criteria;
	const testCommand = body.testCommand ?? body.test_command;
	const testStatus = body.testStatus ?? body.test_status;
	const createInput = {
		projectId: body.projectId,
		title: body.title,
		...(body.description !== undefined
			? { description: body.description }
			: {}),
		...(body.status !== undefined ? { status: body.status } : {}),
		...(body.priority !== undefined ? { priority: body.priority } : {}),
		...(body.parentIssueId !== undefined
			? { parentIssueId: body.parentIssueId }
			: {}),
		...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
		...(testCommand !== undefined ? { testCommand } : {}),
		...(testStatus !== undefined
			? { testStatus }
			: testCommand?.trim()
				? { testStatus: "pending" as const }
				: {}),
	};
	const result = await issuesService.createIssue(
		requireTenantScope(getCompanyId(c)),
		createInput,
	);
	if (!result.issue) {
		return c.json(
			{
				error:
					result.reason === "project_not_found"
						? "project not found"
						: result.reason === "parent_issue_not_found"
							? "parent issue not found"
							: "insert failed",
			},
			result.reason === "insert_failed" ? 500 : 404,
		);
	}

	// Train clone on user-authored issue content
	const cid = getCompanyId(c);
	void recordObservation(body.title, "issue_title", 1.0, cid);
	if (body.description)
		void recordObservation(body.description, "issue_description", 1.0, cid);

	await logActivity(c, "issue.created", "issue", result.issue.id, {
		projectId: body.projectId,
		parentIssueId: body.parentIssueId ?? null,
	});

	return c.json(result.issue, 201);
});

issuesRoute.get("/:id", (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.param("id");
	const row = issuesRepo.getIssueById(issueId, cid);
	if (!row) return c.json({ error: "not found" }, 404);

	const comments = issuesRepo.getComments(issueId, cid);
	const activity = issuesRepo.getActivity(issueId, cid);
	const lifecycle = issuesRepo.getLifecycleEvents(issueId, cid);

	return c.json({ ...row, comments, activity, lifecycle });
});

issuesRoute.get("/:id/sub-issues", (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.param("id");
	const parent = issuesRepo.getIssueById(issueId, cid);
	if (!parent) return c.json({ error: "not found" }, 404);
	return c.json(issuesRepo.getSubIssues(issueId, cid));
});

issuesRoute.patch("/:id", zValidator("json", UpdateIssueSchema), async (c) => {
	const scope = requireTenantScope(getCompanyId(c));
	const body = c.req.valid("json");
	const issueId = c.req.param("id");
	const acceptanceCriteria =
		body.acceptanceCriteria ?? body.acceptance_criteria;
	const testCommand = body.testCommand ?? body.test_command;
	const testStatus = body.testStatus ?? body.test_status;
	const updateInput = {
		...(body.title !== undefined ? { title: body.title } : {}),
		...(body.description !== undefined
			? { description: body.description }
			: {}),
		...(body.status !== undefined ? { status: body.status } : {}),
		...(body.priority !== undefined ? { priority: body.priority } : {}),
		...(body.assignedAgentId !== undefined
			? { assignedAgentId: body.assignedAgentId }
			: {}),
		...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
		...(body.labels !== undefined ? { labels: body.labels } : {}),
		...(body.tags !== undefined ? { tags: body.tags } : {}),
		...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
		...(testCommand !== undefined ? { testCommand } : {}),
		...(testStatus !== undefined
			? {
					testStatus: testStatus as
						| "none"
						| "pending"
						| "running"
						| "passed"
						| "failed",
				}
			: testCommand !== undefined
				? {
						testStatus: testCommand.trim()
							? ("pending" as const)
							: ("none" as const),
					}
				: {}),
	};
	const updated = await issuesService.updateIssue(scope, issueId, updateInput);
	if (!updated) return c.json({ error: "not found" }, 404);
	await logActivity(c, "issue.updated", "issue", issueId, body);
	if (body.status !== undefined) {
		await maybeCompleteParentIssue(c, scope.companyId, updated.parentIssueId);
	}
	return c.json(updated);
});

issuesRoute.post("/:id/tests/run", async (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.param("id");
	const issue = issuesRepo.loadIssueWithProject(issueId, cid);
	if (!issue) return c.json({ error: "not found" }, 404);
	const result = await startIssueTestRun(issueId, { requireAutoTest: false });
	if (!result.started) {
		const status =
			result.reason === "missing_workspace"
				? 422
				: result.reason === "already_running"
					? 409
					: 400;
		return c.json({ error: result.reason ?? "test_run_failed" }, status);
	}
	await logActivity(c, "issue.tests_run", "issue", issueId, {
		projectId: issue.projectId,
	});
	return c.json({ ok: true }, 202);
});

issuesRoute.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await issuesRepo.deleteIssue(c.req.param("id"), cid);
	if (!row) return c.json({ error: "not found" }, 404);
	publishDomainEvent({
		type: "issue.updated",
		issueId: row.id,
		projectId: row.projectId,
		companyId: cid,
		event: "updated",
	});
	await logActivity(c, "issue.deleted", "issue", row.id);
	return c.json({ deleted: true });
});

// ─── Comments ──────────────────────────────────────────────────────────────────

issuesRoute.get("/:id/comments", (c) => {
	const cid = getCompanyId(c);
	const rows = issuesRepo.getComments(c.req.param("id"), cid);
	return c.json(rows);
});

issuesRoute.post(
	"/:id/comments",
	zValidator("json", AddCommentSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const body = c.req.valid("json");
		const issueId = c.req.param("id");
		const author = body.author ?? "human";
		const comment = issuesRepo.addComment(issueId, cid, body.body, author);
		if (!comment) return c.json({ error: "not found" }, 404);

		// Train clone from human comments
		if (author === "human" && body.body) {
			void recordObservation(body.body, "comment", 1.0, cid);
		}
		issuesRepo.addActivityLog(issueId, cid, author, "comment_added");
		publishDomainEvent({
			type: "issue.updated",
			issueId,
			companyId: cid,
			event: "updated",
		});

		// Wake agent when human comments on an in_review or in_progress issue
		if (author === "human") {
			try {
				const { wakeAgentForIssueComment } = await import(
					"../lib/agent-wake.js"
				);
				wakeAgentForIssueComment(issueId, cid, body.body);
			} catch {
				/* best-effort */
			}
		}

		return c.json(comment, 201);
	},
);

issuesRoute.delete("/:id/comments/:commentId", (c) => {
	const cid = getCompanyId(c);
	issuesRepo.deleteComment(c.req.param("id"), cid, c.req.param("commentId"));
	return c.json({ deleted: true });
});

// ─── Activity ──────────────────────────────────────────────────────────────────

issuesRoute.get("/:id/activity", (c) => {
	const cid = getCompanyId(c);
	const rows = issuesRepo.getActivity(c.req.param("id"), cid);
	return c.json(rows);
});

// ─── Git plumbing: branch / commit / PR / merge ───────────────────────────────
//
// These endpoints are the bridge between the issue lifecycle and the project
// workspace's local git repo. The dispatcher (lib/dispatcher.ts) and the
// agent runner both call these to advance an issue from "backlog" to "merged".
// They all require the project to have a workspace_path on disk.

function appendCommitSha(existing: string | null, sha: string): string {
	let arr: string[] = [];
	if (existing) {
		try {
			const parsed = JSON.parse(existing) as unknown;
			if (Array.isArray(parsed))
				arr = parsed.filter((v): v is string => typeof v === "string");
		} catch {
			/* ignore malformed JSON */
		}
	}
	if (!arr.includes(sha)) arr.push(sha);
	return JSON.stringify(arr);
}

issuesRoute.post("/:id/link", zValidator("json", LinkIssueSchema), (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.param("id");
	const issue = issuesRepo.loadIssueWithProject(issueId, cid);
	if (!issue) return c.json({ error: "issue not found" }, 404);
	const body = c.req.valid("json");
	const nextPrState =
		body.prState ??
		(issue.prState === "open" ||
		issue.prState === "merged" ||
		issue.prState === "closed"
			? issue.prState
			: null);
	const nextCommitShas = body.commitSha
		? appendCommitSha(issue.commitShas, body.commitSha)
		: issue.commitShas;
	issuesRepo.updateIssueGitLinks(issueId, cid, {
		prUrl: body.prUrl ?? issue.prUrl,
		prState: nextPrState,
		commitShas: nextCommitShas,
	});
	return c.json({
		ok: true,
		prUrl: body.prUrl ?? issue.prUrl,
		prState: nextPrState,
		commitShas: JSON.parse(nextCommitShas ?? "[]"),
	});
});

issuesRoute.post(
	"/:id/branch",
	zValidator("json", BranchIssueSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const issueId = c.req.param("id");
		const issue = issuesRepo.loadIssueWithProject(issueId, cid);
		if (!issue) return c.json({ error: "issue not found" }, 404);
		if (!issue.workspacePath)
			return c.json(
				{
					error:
						"project has no workspace_path; configure one before branching",
				},
				422,
			);

		const slugLow = (issue.slug ?? "").toLowerCase();
		const branchName = `issue/${slugLow}-${kebab(issue.title ?? "task")}`;
		const fromBranch = issue.defaultBranch ?? "main";

		try {
			await gitCreateBranch(issue.workspacePath, branchName, fromBranch, {
				allowedRoots: [issue.workspacePath],
			});
		} catch (err) {
			if (err instanceof GitError)
				return c.json({ error: err.message, code: err.code }, 422);
			throw err;
		}

		const now = new Date().toISOString();
		issuesRepo.updateBranchName(issueId, cid, branchName);
		issuesRepo.addActivityLog(
			issueId,
			cid,
			"system",
			"branch_created",
			JSON.stringify({ branchName, fromBranch }),
		);

		// Lifecycle: backlog → branched. force=true: this endpoint owns the
		// semantics, even if the user previously cancelled and is rebooting.
		const tr = transitionStage(issueId, {
			to: "branched",
			actorType: "system",
			force: true,
		});
		await logActivity(c, "issue.lifecycle.advanced", "issue", issueId, {
			from: tr.fromStage,
			to: tr.toStage,
		});
		if (tr.companyId) {
			postProjectMessage(
				tr.companyId,
				issue.projectId,
				"system",
				`🌿 Branch \`${branchName}\` created for \`${issue.slug}\` ${issue.title}`,
			);
		}
		rebuildSprintBoard(issue.projectId);

		publishDomainEvent({
			type: "issue.updated",
			issueId,
			event: "branch_created",
			branchName,
			companyId: cid,
			projectId: issue.projectId,
		});
		return c.json({
			ok: true,
			branchName,
			fromBranch,
			lifecycleStage: tr.toStage,
		});
	},
);

issuesRoute.post(
	"/:id/commit",
	zValidator("json", CommitIssueSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const issueId = c.req.param("id");
		const body = c.req.valid("json");
		const issue = issuesRepo.loadIssueWithProject(issueId, cid);
		if (!issue) return c.json({ error: "issue not found" }, 404);
		if (!issue.workspacePath)
			return c.json({ error: "project has no workspace_path" }, 422);
		if (!issue.branchName)
			return c.json(
				{ error: "issue has no branch yet — POST /branch first" },
				422,
			);

		try {
			// Make sure HEAD is on the issue branch before committing.
			await gitCreateBranch(issue.workspacePath, issue.branchName, undefined, {
				allowedRoots: [issue.workspacePath],
			});
			const result = await gitCommit(
				issue.workspacePath,
				body.message,
				body.files,
				{ allowedRoots: [issue.workspacePath] },
			);
			const newJson = appendCommitSha(issue.commitShas, result.sha);
			issuesRepo.updateCommitShas(issueId, cid, newJson);
			issuesRepo.addActivityLog(
				issueId,
				cid,
				"agent",
				"commit",
				JSON.stringify({
					sha: result.sha,
					message: body.message,
					noChanges: result.noChanges,
				}),
			);
			publishDomainEvent({
				type: "issue.updated",
				issueId,
				event: "commit",
				sha: result.sha,
				companyId: cid,
				projectId: issue.projectId,
			});

			// Lifecycle: only advance if currently `branched` or already
			// `committed` (per task spec). Stay put otherwise — we don't want a
			// late commit to undo a PR merge.
			const current = (issue.lifecycleStage ?? "backlog") as LifecycleStage;
			if (current === "branched" || current === "committed") {
				const tr = transitionStage(issueId, {
					to: "committed",
					actorType: "agent",
					force: true,
				});
				await logActivity(c, "issue.lifecycle.advanced", "issue", issueId, {
					from: tr.fromStage,
					to: tr.toStage,
				});
				if (tr.companyId) {
					postProjectMessage(
						tr.companyId,
						issue.projectId,
						"system",
						`💾 Commit \`${result.sha.slice(0, 8)}\` on \`${issue.slug}\`: ${body.message.split("\n")[0]}`,
					);
				}
			}
			rebuildSprintBoard(issue.projectId);

			return c.json({ ok: true, sha: result.sha, noChanges: result.noChanges });
		} catch (err) {
			if (err instanceof GitError)
				return c.json({ error: err.message, code: err.code }, 422);
			throw err;
		}
	},
);

issuesRoute.post("/:id/pr", zValidator("json", OpenPrSchema), async (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.param("id");
	const body = c.req.valid("json");
	const issue = issuesRepo.loadIssueWithProject(issueId, cid);
	if (!issue) return c.json({ error: "issue not found" }, 404);
	if (!issue.branchName)
		return c.json({ error: "branch missing — POST /branch first" }, 422);

	// openPullRequest is currently a stub (see packages/git/src/github.ts).
	// Real GitHub API call lands when the integration ships — until then this
	// produces a deterministic URL we can show in the UI / channel messages.
	let pr: Awaited<ReturnType<typeof openPullRequest>>;
	try {
		pr = await openPullRequest({
			repoUrl: issue.repoUrl ?? "",
			branch: issue.branchName,
			baseBranch: issue.defaultBranch ?? "main",
			title: body.title,
			body: body.body,
			token: resolveGitHubToken(cid),
		});
	} catch (err) {
		return c.json(
			{
				error:
					err instanceof Error ? err.message : "failed to open pull request",
			},
			502,
		);
	}

	issuesRepo.updatePrOpened(issueId, cid, pr.url);
	issuesRepo.addActivityLog(
		issueId,
		cid,
		"agent",
		"pr_opened",
		JSON.stringify({ url: pr.url, stub: pr.stub }),
	);

	publishDomainEvent({
		type: "issue.updated",
		issueId,
		event: "pr_opened",
		prUrl: pr.url,
		companyId: cid,
		projectId: issue.projectId,
	});

	const tr = transitionStage(issueId, {
		to: "pr_open",
		actorType: "agent",
		force: true,
	});
	await logActivity(c, "issue.lifecycle.advanced", "issue", issueId, {
		from: tr.fromStage,
		to: tr.toStage,
	});
	if (tr.companyId) {
		postProjectMessage(
			tr.companyId,
			issue.projectId,
			"system",
			`📤 PR opened for \`${issue.slug}\` ${issue.title}: ${pr.url}`,
		);
	}
	rebuildSprintBoard(issue.projectId);

	return c.json({
		ok: true,
		prUrl: pr.url,
		prState: pr.state,
		stub: pr.stub,
		lifecycleStage: tr.toStage,
	});
});

issuesRoute.post(
	"/:id/pr/merge",
	zValidator("json", MergePrSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const issueId = c.req.param("id");
		const issue = issuesRepo.loadIssueWithProject(issueId, cid);
		if (!issue) return c.json({ error: "issue not found" }, 404);
		if (!issue.prUrl) return c.json({ error: "no PR open on this issue" }, 422);
		if (!issue.branchName) return c.json({ error: "no branch" }, 422);

		if (companyRequiresApproval(cid, "pr_merge")) {
			const latest = await approvalsRepo.getLatestEntityApproval(
				issueId,
				cid,
				"pr_merge",
				"issue",
			);
			if (!latest || latest.status === "rejected") {
				const created = await approvalsRepo.createApproval({
					companyId: cid,
					type: "pr_merge",
					entityType: "issue",
					entityId: issueId,
					title: `Merge ${issue.slug}`,
					description: `CTO wants to merge the PR for: ${issue.title}`,
					requestedBy: "cto",
					targetIssueSlug: issue.slug,
					riskLevel: "medium",
				});
				await logActivity(
					c,
					"approval.requested",
					"approval",
					created?.id ?? "",
					{
						issueId,
						action: "pr_merge",
					},
				);
				return c.json(
					{
						error:
							"Merge requires approval. Approve this request in Approvals, then retry.",
						approvalId: created?.id ?? null,
						approvalStatus: "pending",
					},
					409,
				);
			}
			if (latest.status !== "approved") {
				return c.json(
					{
						error:
							"Merge requires approval. Approve the pending request, then retry.",
						approvalId: latest.id,
						approvalStatus: latest.status,
					},
					409,
				);
			}
		}

		let mergeSha: string | null = null;
		if (issue.workspacePath) {
			try {
				const result = await gitMerge(
					issue.workspacePath,
					issue.branchName,
					issue.defaultBranch ?? "main",
					{ allowedRoots: [issue.workspacePath] },
				);
				mergeSha = result.sha;
			} catch (err) {
				if (err instanceof GitError)
					return c.json({ error: err.message, code: err.code }, 422);
				throw err;
			}
		}
		try {
			await mergePullRequest({
				repoUrl: issue.repoUrl ?? "",
				prUrl: issue.prUrl,
				token: resolveGitHubToken(cid),
			});
		} catch (err) {
			return c.json(
				{
					error:
						err instanceof Error ? err.message : "failed to merge pull request",
				},
				502,
			);
		}

		issuesRepo.updatePrMerged(issueId, cid);
		issuesRepo.addActivityLog(
			issueId,
			cid,
			"agent",
			"pr_merged",
			JSON.stringify({ mergeSha }),
		);

		publishDomainEvent({
			type: "issue.updated",
			issueId,
			event: "pr_merged",
			companyId: cid,
			projectId: issue.projectId,
		});

		const tr = transitionStage(issueId, {
			to: "merged",
			actorType: "agent",
			force: true,
		});
		await logActivity(c, "issue.lifecycle.advanced", "issue", issueId, {
			from: tr.fromStage,
			to: tr.toStage,
		});
		if (tr.companyId) {
			postProjectMessage(
				tr.companyId,
				issue.projectId,
				"system",
				`🔀 PR merged for \`${issue.slug}\` ${issue.title}`,
			);
		}
		rebuildSprintBoard(issue.projectId);

		return c.json({
			ok: true,
			prState: "merged" as const,
			mergeSha,
			lifecycleStage: tr.toStage,
		});
	},
);

// POST /api/issues/:id/lifecycle  { stage }
// Manual stage transition. Validates that `stage` is reachable from the
// issue's current stage (or is `cancelled` from any non-terminal stage).
issuesRoute.post(
	"/:id/lifecycle",
	zValidator("json", LifecycleStageSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const scope = requireTenantScope(cid);
		const issueId = c.req.param("id");
		const issue = issuesRepo.loadIssueWithProject(issueId, cid);
		if (!issue) return c.json({ error: "issue not found" }, 404);

		const { stage } = c.req.valid("json");
		let tr;
		try {
			tr = await issuesService.transitionLifecycle(scope, issueId, {
				to: stage as LifecycleStage,
				actorType: "human",
				actorId: c.req.header("x-actor-id") ?? null,
			});
		} catch (err) {
			return c.json(
				{ error: err instanceof Error ? err.message : "transition failed" },
				422,
			);
		}
		if (!tr) return c.json({ error: "issue not found" }, 404);

		await logActivity(c, "issue.lifecycle.advanced", "issue", issueId, {
			from: tr.fromStage,
			to: tr.toStage,
			manual: true,
		});
		if (tr.companyId && !tr.noop) {
			postProjectMessage(
				tr.companyId,
				issue.projectId,
				"human",
				`⚙️ \`${issue.slug}\` advanced ${tr.fromStage} → ${tr.toStage}`,
			);
		}
		rebuildSprintBoard(issue.projectId);
		await maybeCompleteParentIssue(c, cid, issue.parentIssueId);
		return c.json({
			ok: true,
			fromStage: tr.fromStage,
			toStage: tr.toStage,
			noop: tr.noop,
		});
	},
);
