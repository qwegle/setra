/**
 * run-lifecycle.ts — post-run completion handler.
 *
 * Called when a run exits (from server-runner.ts or via the
 * POST /api/runs/:id/completed endpoint used by the desktop PTY bridge).
 *
 * On success (exitCode === 0):
 *   1. Stage & commit all changes in the worktree.
 *   2. Push the branch.
 *   3. Create a PR via `gh pr create` (falls back to a git-push-only note).
 *   4. Comment on the issue: "✅ Completed. PR #X created"
 *   5. Update issue status → 'in_review'.
 *   6. Record success in agent_scores.
 *
 * On failure (exitCode !== 0):
 *   1. Comment on the issue: "❌ Failed (exit code X). Retrying…"
 *   2. Record failure in agent_scores.
 *   3. Retry (up to MAX_RETRIES total runs for the issue).
 *   4. After max retries: escalate to the CTO agent.
 *
 * Post an event to the team_messages channel after every lifecycle change.
 */

import { execFile as _execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { getRawDb } from "@setra/db";
import * as issuesRepo from "../repositories/issues.repo.js";
import { emit, publishDomainEvent } from "../sse/handler.js";
import { createRunReflection } from "./agent-reflection.js";
import { postChannelMessage } from "./channel-hooks.js";
import { recordFailure, recordSuccess } from "./credibility.js";
import { requestDispatcherTick } from "./dispatcher-scheduler.js";
import { dispatchPlan } from "./dispatcher.js";
import { addAutomationIssueComment } from "./issue-comments.js";
import { createLogger } from "./logger.js";
import { createPlan, listPlans } from "./plan-engine.js";
import { getProjectSettings } from "./project-settings.js";
import { isCeoAgent, isCtoAgent, isDevAgent } from "./prompt-builder.js";
import { spawnServerRun } from "./server-runner.js";

const execFile = promisify(_execFile);
const log = createLogger("run-lifecycle");

const MAX_RETRIES = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunDetail {
	run_id: string;
	plot_id: string;
	agent_slug: string;
	agent_display_name: string;
	agent_company_id: string | null;
	worktree_path: string | null;
	branch_name: string | null;
	issue_id: string | null;
	issue_title: string | null;
	issue_description: string | null;
	issue_company_id: string | null;
	parent_issue_id: string | null;
	review_status: string | null;
	review_round: number;
	error_message: string | null;
	attempt_count: number;
	outcome: string | null;
	agent_args: string | null;
	started_at: string;
	ended_at: string | null;
	cost_usd: number | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function gitExec(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return execFile("git", args, { cwd }).catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`git ${args[0]} failed in ${cwd}: ${msg}`);
	});
}

function countRunsForIssue(issueId: string): number {
	const db = getRawDb();
	const row = db
		.prepare(
			`SELECT COUNT(*) AS c
         FROM runs r
         JOIN board_issues bi ON bi.linked_plot_id = r.plot_id
        WHERE bi.id = ?`,
		)
		.get(issueId) as { c: number } | undefined;
	return row?.c ?? 0;
}

function findCtoAgent(companyId: string): string | null {
	const db = getRawDb();
	const row = db
		.prepare(
			`SELECT slug FROM agent_roster
        WHERE company_id = ?
          AND is_active = 1
          AND (lower(slug) LIKE '%cto%' OR lower(display_name) LIKE '%cto%')
        ORDER BY created_at ASC
        LIMIT 1`,
		)
		.get(companyId) as { slug: string } | undefined;
	return row?.slug ?? null;
}

function findCeoAgent(companyId: string): string | null {
	const db = getRawDb();
	const row = db
		.prepare(
			`SELECT slug FROM agent_roster
        WHERE company_id = ?
          AND is_active = 1
          AND (lower(slug) LIKE '%ceo%' OR lower(display_name) LIKE '%ceo%')
        ORDER BY created_at ASC
        LIMIT 1`,
		)
		.get(companyId) as { slug: string } | undefined;
	return row?.slug ?? null;
}

function loadRunDetail(runId: string): RunDetail | null {
	const db = getRawDb();
	return (
		(db
			.prepare(
				`SELECT
           r.id             AS run_id,
           r.plot_id,
           r.agent          AS agent_slug,
           ar.display_name  AS agent_display_name,
           ar.company_id    AS agent_company_id,
           pl.worktree_path,
           COALESCE(NULLIF(trim(r.branch_name), ''), NULLIF(trim(bi.branch_name), ''), NULLIF(trim(pl.branch), '')) AS branch_name,
           bi.id            AS issue_id,
           bi.title         AS issue_title,
           bi.description   AS issue_description,
           bi.company_id    AS issue_company_id,
           bi.parent_issue_id AS parent_issue_id,
           bi.review_status AS review_status,
           COALESCE(bi.review_round, 0) AS review_round,
           r.error_message,
           r.outcome,
           r.agent_args,
           r.started_at,
           r.ended_at,
           r.cost_usd,
           (SELECT COUNT(*) FROM runs r2
             JOIN board_issues bi2 ON bi2.linked_plot_id = r2.plot_id
            WHERE bi2.id = bi.id) AS attempt_count
         FROM runs r
         JOIN agent_roster ar ON ar.slug = r.agent
         JOIN plots pl         ON pl.id = r.plot_id
         LEFT JOIN board_issues bi ON bi.linked_plot_id = r.plot_id
        WHERE r.id = ?`,
			)
			.get(runId) as RunDetail | undefined) ?? null
	);
}

function getRunDurationMs(detail: RunDetail): number {
	const startedAt = Date.parse(detail.started_at);
	const endedAt = detail.ended_at ? Date.parse(detail.ended_at) : Date.now();
	if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) return 0;
	return Math.max(0, endedAt - startedAt);
}

// ─── Git commit + push ────────────────────────────────────────────────────────

async function commitAndPush(
	worktreePath: string,
	branch: string,
	message: string,
): Promise<void> {
	// Stage everything.
	await gitExec(worktreePath, ["add", "-A"]);

	// Check if there's anything to commit.
	const { stdout: statusOut } = await gitExec(worktreePath, [
		"status",
		"--porcelain",
	]);
	if (!statusOut.trim()) {
		log.info("nothing to commit", { worktreePath });
		return;
	}

	await gitExec(worktreePath, [
		"commit",
		"-m",
		message,
		"--author",
		"Setra Agent <agent@setra.sh>",
	]);

	await gitExec(worktreePath, ["push", "origin", branch, "--set-upstream"]);
}

// ─── PR creation ─────────────────────────────────────────────────────────────

async function createPullRequest(
	worktreePath: string,
	branch: string,
	title: string,
	body: string,
): Promise<string | null> {
	// Try `gh pr create` first.
	try {
		const { stdout } = await execFile(
			"gh",
			[
				"pr",
				"create",
				"--title",
				title,
				"--body",
				body,
				"--head",
				branch,
				"--fill",
			],
			{ cwd: worktreePath },
		);
		const prUrl = stdout.trim().split("\n").pop() ?? null;
		return prUrl && prUrl.startsWith("http") ? prUrl : null;
	} catch {
		// `gh` not available or auth not configured — return null.
		log.warn("gh pr create unavailable", { worktreePath, branch });
		return null;
	}
}

interface RunMeta {
	kind?: "cto_review" | "plan_revision" | string;
	sourceRunId?: string;
	sourceAgentSlug?: string;
	reviewRound?: number;
	planId?: string;
}

function parseRunMeta(detail: RunDetail): RunMeta {
	try {
		return detail.agent_args ? (JSON.parse(detail.agent_args) as RunMeta) : {};
	} catch {
		return {};
	}
}

function toAgentIdentity(detail: RunDetail) {
	return {
		id: detail.agent_slug,
		slug: detail.agent_slug,
		display_name: detail.agent_display_name ?? detail.agent_slug,
		adapter_type: null,
		model_id: null,
		system_prompt: null,
		skills: null,
		company_id: detail.agent_company_id,
	};
}

function issueLooksComplex(detail: RunDetail): boolean {
	const text =
		`${detail.issue_title ?? ""}\n${detail.issue_description ?? ""}`.toLowerCase();
	const signals = [
		"feature",
		"workflow",
		"plan",
		"subtask",
		"approval",
		"multi",
		"complex",
		"architecture",
		"parallel",
		"dispatch",
		"integration",
		"monorepo",
	].filter((signal) => text.includes(signal)).length;
	return signals >= 2 || text.split(/\s+/).filter(Boolean).length >= 120;
}

function loadRunOutput(runId: string): string {
	const rows = getRawDb()
		.prepare(
			`SELECT content FROM chunks WHERE run_id = ? ORDER BY sequence ASC`,
		)
		.all(runId) as Array<{ content: string }>;
	return rows
		.map((row) => row.content)
		.join("\n")
		.trim();
}

async function loadWorkingDiff(detail: RunDetail): Promise<string> {
	if (!detail.worktree_path || !existsSync(detail.worktree_path)) return "";
	try {
		const { stdout } = await gitExec(detail.worktree_path, [
			"diff",
			"--no-ext-diff",
			"--stat",
			"--patch",
			"--unified=3",
		]);
		return stdout.trim();
	} catch {
		return "";
	}
}

async function runHasCodeChanges(detail: RunDetail): Promise<boolean> {
	if (detail.worktree_path && existsSync(detail.worktree_path)) {
		try {
			const { stdout } = await gitExec(detail.worktree_path, [
				"status",
				"--porcelain",
			]);
			if (stdout.trim().length > 0) return true;
		} catch {
			/* fall back to chunk inspection */
		}
	}
	const output = loadRunOutput(detail.run_id).toLowerCase();
	return /(write_file|diff --git|src\/|apps\/|packages\/|```\w+)/.test(output);
}

async function createQueuedRun(input: {
	plotId: string;
	agentSlug: string;
	branchName: string | null;
	companyId: string;
	issueId: string;
	task: string;
	agentArgs?: Record<string, unknown>;
}): Promise<string> {
	const now = new Date().toISOString();
	const runId = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT INTO runs (id, plot_id, agent, branch_name, agent_args, status, started_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
		)
		.run(
			runId,
			input.plotId,
			input.agentSlug,
			input.branchName,
			input.agentArgs ? JSON.stringify(input.agentArgs) : null,
			now,
			now,
		);
	const agent = getRawDb()
		.prepare(
			`SELECT adapter_type FROM agent_roster WHERE slug = ? AND company_id = ? LIMIT 1`,
		)
		.get(input.agentSlug, input.companyId) as
		| { adapter_type: string | null }
		| undefined;
	const ptyOnly = new Set(["claude", "codex", "gemini", "amp", "opencode"]);
	if (ptyOnly.has(agent?.adapter_type ?? "")) return runId;
	await spawnServerRun({
		runId,
		agentSlug: input.agentSlug,
		issueId: input.issueId,
		companyId: input.companyId,
		task: input.task,
	});
	return runId;
}

function publishIssueUpdated(input: {
	issueId: string;
	projectId: string | null;
	companyId: string | null;
}) {
	if (input.companyId && input.projectId) {
		publishDomainEvent({
			type: "issue.updated",
			issueId: input.issueId,
			projectId: input.projectId,
			companyId: input.companyId,
			event: "updated",
		});
	}
}

export async function startIssueTestRun(
	issueId: string,
	options: {
		workspacePath?: string | null;
		requireAutoTest?: boolean;
	} = {},
): Promise<{
	started: boolean;
	reason?:
		| "issue_not_found"
		| "missing_test_command"
		| "missing_workspace"
		| "already_running"
		| "auto_test_disabled";
}> {
	const db = getRawDb();
	const issue = db
		.prepare(
			`SELECT
				i.id AS issueId,
				i.project_id AS projectId,
				i.company_id AS companyId,
				TRIM(COALESCE(i.test_command, '')) AS testCommand,
				COALESCE(NULLIF(trim(?), ''), NULLIF(trim(pl.worktree_path), ''), NULLIF(trim(p.workspace_path), ''), NULLIF(trim(p.repo_path), '')) AS workspacePath,
				COALESCE(i.test_status, 'none') AS testStatus,
				i.status AS status
			 FROM board_issues i
			 LEFT JOIN plots pl ON pl.id = i.linked_plot_id
			 LEFT JOIN board_projects p ON p.id = i.project_id
			WHERE i.id = ?
			LIMIT 1`,
		)
		.get(options.workspacePath ?? null, issueId) as
		| {
				issueId: string;
				projectId: string | null;
				companyId: string | null;
				testCommand: string;
				workspacePath: string | null;
				testStatus: string;
		  }
		| undefined;
	if (!issue) return { started: false, reason: "issue_not_found" };
	if (!issue.testCommand) {
		return { started: false, reason: "missing_test_command" };
	}
	// Hard cap: a test command is a single shell line, not a script. Anything
	// longer is either a paste mistake or a smuggle attempt; reject before exec.
	if (issue.testCommand.length > 1000) {
		return { started: false, reason: "missing_test_command" };
	}
	// Newlines turn one shell line into many — same risk as a multi-statement
	// SQL injection. Treat as missing rather than truncating, so the operator
	// has to fix the field before it runs.
	if (/[\r\n\u2028\u2029]/.test(issue.testCommand)) {
		return { started: false, reason: "missing_test_command" };
	}
	if (issue.testStatus === "running") {
		return { started: false, reason: "already_running" };
	}
	if (options.requireAutoTest && issue.projectId) {
		const settings = getProjectSettings(issue.projectId);
		if (!settings.autoTestEnabled) {
			return { started: false, reason: "auto_test_disabled" };
		}
	}
	if (!issue.workspacePath || !existsSync(issue.workspacePath)) {
		return { started: false, reason: "missing_workspace" };
	}

	const startedAt = new Date().toISOString();
	db.prepare(
		`UPDATE board_issues
		    SET test_status = 'running', updated_at = ?
		  WHERE id = ?`,
	).run(startedAt, issue.issueId);
	publishIssueUpdated({
		issueId: issue.issueId,
		projectId: issue.projectId,
		companyId: issue.companyId,
	});
	emit("issue:test-result", {
		issueId: issue.issueId,
		projectId: issue.projectId,
		companyId: issue.companyId,
		status: "running",
	});

	const { exec } = await import("node:child_process");
	exec(
		issue.testCommand,
		{ cwd: issue.workspacePath, timeout: 300_000 },
		(error, stdout, stderr) => {
			const passed = !error;
			const output = `${stdout ?? ""}${stderr ?? ""}`.slice(-2000);
			const finishedAt = new Date().toISOString();
			db.prepare(
				`UPDATE board_issues
				    SET test_status = ?,
				        status = CASE
				          WHEN status = 'cancelled' THEN status
				          WHEN status = 'in_review' THEN status
				          WHEN ? = 1 THEN 'done'
				          ELSE 'in_review'
				        END,
				        updated_at = ?
				  WHERE id = ?`,
			).run(
				passed ? "passed" : "failed",
				passed ? 1 : 0,
				finishedAt,
				issue.issueId,
			);
			publishIssueUpdated({
				issueId: issue.issueId,
				projectId: issue.projectId,
				companyId: issue.companyId,
			});
			emit("issue:test-result", {
				issueId: issue.issueId,
				projectId: issue.projectId,
				companyId: issue.companyId,
				passed,
				status: passed ? "passed" : "failed",
				output,
			});
		},
	);
	return { started: true };
}

async function queueCtoReview(
	detail: RunDetail,
	companyId: string,
): Promise<boolean> {
	const ctoSlug = findCtoAgent(companyId);
	if (!ctoSlug || !detail.issue_id) return false;
	const reviewRound = (detail.review_round ?? 0) + 1;
	const output = loadRunOutput(detail.run_id);
	const diff = await loadWorkingDiff(detail);
	const task = [
		`You are reviewing code written by ${detail.agent_display_name || detail.agent_slug} for issue #${detail.issue_id}.`,
		"Evaluate correctness, security, performance, and edge cases.",
		"Respond with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED on the first line, then concise rationale and actionable feedback.",
		detail.issue_title ? `Issue: ${detail.issue_title}` : "",
		detail.issue_description ? `Description:\n${detail.issue_description}` : "",
		output ? `Developer output:\n${output.slice(0, 12000)}` : "",
		diff ? `Working diff:\n${diff.slice(0, 16000)}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	await createQueuedRun({
		plotId: detail.plot_id,
		agentSlug: ctoSlug,
		branchName: detail.branch_name,
		companyId,
		issueId: detail.issue_id,
		task,
		agentArgs: {
			kind: "cto_review",
			sourceRunId: detail.run_id,
			sourceAgentSlug: detail.agent_slug,
			reviewRound,
		},
	});
	getRawDb()
		.prepare(
			`UPDATE board_issues
			    SET review_status = 'pending_review', review_round = ?, status = 'in_review', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			  WHERE id = ?`,
		)
		.run(reviewRound, detail.issue_id);
	addAutomationIssueComment(
		detail.issue_id,
		companyId,
		`🧠 CTO auto-review round ${reviewRound} started for ${detail.agent_slug}'s implementation.`,
		"cto",
	);
	return true;
}

function parseReviewVerdict(output: string): "APPROVED" | "CHANGES_REQUESTED" {
	const upper = output.toUpperCase();
	if (upper.includes("VERDICT: CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
	return "APPROVED";
}

async function continuePlanExecution(
	issueId: string | null,
	companyId: string | null,
): Promise<void> {
	if (!issueId || !companyId) return;
	const plans = await listPlans(companyId, { status: "executing" });
	for (const plan of plans) {
		if (
			plan.issueId === issueId ||
			plan.subtasks.some((subtask) => subtask.issueId === issueId)
		) {
			await dispatchPlan(plan);
		}
	}
}

async function finalizeSuccess(
	detail: RunDetail,
	companyId: string | null,
	options: {
		doneStatus?: boolean;
		reviewStatus?: string | null;
		reviewNote?: string | null;
	} = {},
): Promise<void> {
	const db = getRawDb();
	const now = new Date().toISOString();
	let prUrl: string | null = null;
	const hasWorktree = detail.worktree_path && existsSync(detail.worktree_path);
	const branch = detail.branch_name;
	if (hasWorktree && branch) {
		try {
			const commitMsg = `setra: complete task for issue ${detail.issue_id ?? "unknown"} [agent=${detail.agent_slug}]`;
			await commitAndPush(detail.worktree_path!, branch, commitMsg);
			const prTitle = detail.issue_title
				? `[Setra] ${detail.issue_title}`
				: `Setra: ${branch}`;
			const prBody = [
				`Automated changes by Setra agent \`${detail.agent_slug}\`.`,
				"",
				detail.issue_id ? `Closes issue \`${detail.issue_id}\`.` : "",
			]
				.filter(Boolean)
				.join("\n");
			prUrl = await createPullRequest(
				detail.worktree_path!,
				branch,
				prTitle,
				prBody,
			);
		} catch (err) {
			log.warn("git commit or push failed", {
				runId: detail.run_id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	if (detail.issue_id && detail.outcome !== "reassigned") {
		const status = options.doneStatus ? "done" : "in_review";
		const completedAt = options.doneStatus ? now : null;
		if (prUrl) {
			db.prepare(
				`UPDATE board_issues
				    SET pr_url = ?,
				        pr_state = 'open',
				        status = ?,
				        completed_at = COALESCE(?, completed_at),
				        review_status = ?,
				        updated_at = ?
				  WHERE id = ?`,
			).run(
				prUrl,
				status,
				completedAt,
				options.reviewStatus ?? null,
				now,
				detail.issue_id,
			);
		} else {
			db.prepare(
				`UPDATE board_issues
				    SET status = ?,
				        completed_at = COALESCE(?, completed_at),
				        review_status = ?,
				        updated_at = ?
				  WHERE id = ?`,
			).run(
				status,
				completedAt,
				options.reviewStatus ?? null,
				now,
				detail.issue_id,
			);
		}
		const commentLines = [
			options.reviewNote ??
				(options.doneStatus
					? "✅ Work complete. CTO approved the implementation."
					: "✅ Work complete. Awaiting human verification."),
		];
		if (prUrl) commentLines.push(`PR: ${prUrl}`);
		else if (branch) commentLines.push(`Branch: \`${branch}\``);
		addAutomationIssueComment(
			detail.issue_id,
			detail.issue_company_id ?? companyId,
			commentLines.join("\n"),
			detail.agent_slug,
		);
		if (options.doneStatus && detail.parent_issue_id) {
			issuesRepo.completeParentIssueIfDone(
				detail.parent_issue_id,
				detail.issue_company_id ?? companyId ?? "",
			);
		}
		await continuePlanExecution(
			detail.issue_id,
			detail.issue_company_id ?? companyId,
		);
	}
	if (companyId && prUrl) {
		postChannelMessage(
			companyId,
			"general",
			detail.agent_slug,
			detail.agent_display_name ?? detail.agent_slug,
			"completed",
			{ runId: detail.run_id, issueId: detail.issue_id ?? null },
		);
	}
	log.info("run completed", { runId: detail.run_id, prUrl: prUrl ?? "none" });
}

async function handleReviewRunSuccess(
	detail: RunDetail,
	companyId: string,
	meta: RunMeta,
): Promise<void> {
	if (!detail.issue_id) return;
	const output = loadRunOutput(detail.run_id);
	const verdict = parseReviewVerdict(output);
	const round = meta.reviewRound ?? detail.review_round ?? 1;
	if (verdict === "APPROVED") {
		await finalizeSuccess(detail, companyId, {
			doneStatus: true,
			reviewStatus: "approved",
			reviewNote: `✅ CTO auto-review approved the implementation on round ${round}.`,
		});
		return;
	}
	getRawDb()
		.prepare(
			`UPDATE board_issues
			    SET review_status = 'changes_requested', status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			  WHERE id = ?`,
		)
		.run(round >= 3 ? "blocked" : "in_progress", detail.issue_id);
	addAutomationIssueComment(
		detail.issue_id,
		companyId,
		`🔁 CTO requested changes on review round ${round}.\n\n${output.slice(0, 3000)}`,
		"cto",
	);
	if (round >= 3 || !meta.sourceAgentSlug) return;
	await createQueuedRun({
		plotId: detail.plot_id,
		agentSlug: meta.sourceAgentSlug,
		branchName: detail.branch_name,
		companyId,
		issueId: detail.issue_id,
		task: `The CTO reviewed your work for issue ${detail.issue_id} and requested changes. Address every point below, keep the fix scoped, and resubmit for review.\n\n${output.slice(0, 10000)}`,
		agentArgs: { reviewRound: round, feedbackFrom: "cto" },
	});
}

// ─── Retry dispatch ───────────────────────────────────────────────────────────

function summarizeError(detail: RunDetail, exitCode: number): string {
	const summary = (detail.error_message ?? `exit code ${exitCode}`)
		.split("\n")
		.map((part) => part.trim())
		.find(Boolean);
	return (summary ?? `exit code ${exitCode}`)
		.replace(/\s+/g, " ")
		.slice(0, 180);
}

function syncAgentStatusAfterCompletion(detail: RunDetail): void {
	const db = getRawDb();
	const previous = db
		.prepare(
			`SELECT id, status, run_mode FROM agent_roster WHERE slug = ? AND (? IS NULL OR company_id = ?) LIMIT 1`,
		)
		.get(detail.agent_slug, detail.agent_company_id, detail.agent_company_id) as
		| { id: string; status: string; run_mode: string | null }
		| undefined;
	if (!previous) return;
	const active = db
		.prepare(
			`SELECT COUNT(*) AS c FROM runs WHERE agent = ? AND status IN ('pending', 'running')`,
		)
		.get(detail.agent_slug) as { c: number } | undefined;
	const nextStatus = (active?.c ?? 0) > 0 ? "running" : "idle";
	const now = new Date().toISOString();
	const result = db
		.prepare(
			`UPDATE agent_roster
          SET status = ?,
              paused_reason = CASE WHEN ? = 'idle' THEN NULL ELSE paused_reason END,
              last_run_ended_at = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
          AND status IN ('idle', 'running')`,
		)
		.run(nextStatus, nextStatus, now, previous.id);
	if ((result.changes ?? 0) > 0 && previous.status !== nextStatus) {
		log.info("agent lifecycle status synced", {
			agentSlug: detail.agent_slug,
			from: previous.status,
			to: nextStatus,
		});
	}
	if (nextStatus === "idle" && previous.run_mode === "continuous") {
		requestDispatcherTick(`agent-${detail.agent_slug}-idle`);
	}
}

type RetryOutcome = "retried" | "escalated" | "backlog" | "noop";

function handleEscalation(detail: RunDetail, companyId: string | null): void {
	if (!detail.issue_id) return;
	const escalateTarget = detail.agent_slug === "cto" ? "CEO" : "CTO";
	const cid = detail.issue_company_id ?? companyId;
	if (!cid) return;
	try {
		getRawDb()
			.prepare(
				`INSERT INTO activity_log (id, issue_id, company_id, actor, event, payload, created_at)
				 VALUES (?, ?, ?, 'setra', 'escalated', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
			)
			.run(
				globalThis.crypto.randomUUID(),
				detail.issue_id,
				cid,
				JSON.stringify({ to: escalateTarget, from: detail.agent_slug }),
			);
	} catch {
		/* best-effort */
	}
}

function retryOrEscalate(detail: RunDetail): RetryOutcome {
	const db = getRawDb();
	const now = new Date().toISOString();
	const companyId = detail.issue_company_id ?? detail.agent_company_id ?? null;
	if (!companyId || !detail.issue_id) return "noop";

	const attempts = detail.attempt_count;

	if (attempts >= MAX_RETRIES) {
		// Escalate to a different agent — CTO if current is CEO, CEO if current is CTO.
		const isCto =
			detail.agent_slug === "cto" || detail.agent_slug.startsWith("cto-");
		const escalateSlug = isCto
			? findCeoAgent(companyId)
			: findCtoAgent(companyId);
		const escalateLabel = isCto ? "ceo" : "cto";
		if (escalateSlug) {
			const escalatePlotId = `${escalateLabel}-esc-${detail.plot_id.slice(0, 20)}`;
			db.prepare(
				`INSERT OR IGNORE INTO plots
           (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
         SELECT ?, project_id, '${escalateLabel.toUpperCase()} Escalation', branch, base_branch, worktree_path, ?, ?
           FROM plots WHERE id = ?`,
			).run(escalatePlotId, now, now, detail.plot_id);

			const newRunId = crypto.randomUUID();
			db.prepare(
				`INSERT INTO runs
           (id, plot_id, agent, branch_name, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
			).run(
				newRunId,
				escalatePlotId,
				escalateSlug,
				detail.branch_name,
				now,
				now,
			);

			db.prepare(
				`UPDATE board_issues
           SET assigned_agent_id = (SELECT id FROM agent_roster WHERE slug = ? AND company_id = ? LIMIT 1),
               linked_plot_id = ?,
               updated_at = ?
         WHERE id = ?`,
			).run(escalateSlug, companyId, escalatePlotId, now, detail.issue_id);

			log.info("escalated failed issue", {
				issueId: detail.issue_id,
				targetRole: escalateLabel,
				agentSlug: escalateSlug,
				runId: newRunId,
			});
			return "escalated";
		} else {
			// No CTO — revert to backlog.
			db.prepare(
				`UPDATE board_issues SET status = 'backlog', updated_at = ? WHERE id = ?`,
			).run(now, detail.issue_id);

			addAutomationIssueComment(
				detail.issue_id,
				detail.issue_company_id ?? companyId,
				`🔺 Max retries (${MAX_RETRIES}) reached. Issue returned to backlog for manual review.`,
				"setra",
			);
			return "backlog";
		}
	}

	// Still within retry budget — create a new pending run on the same plot.
	const newRunId = crypto.randomUUID();
	db.prepare(
		`INSERT INTO runs
       (id, plot_id, agent, branch_name, status, started_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
	).run(
		newRunId,
		detail.plot_id,
		detail.agent_slug,
		detail.branch_name,
		now,
		now,
	);

	log.info("retrying failed run", {
		runId: newRunId,
		issueId: detail.issue_id,
		attempt: attempts + 1,
	});
	return "retried";
}

// ─── Main lifecycle handler ───────────────────────────────────────────────────

/**
 * Call this when a run exits — from server-runner.ts or the PTY bridge.
 * Safe to call multiple times; idempotent (run status is already set by caller).
 */
export async function onRunCompleted(
	runId: string,
	exitCode: number,
): Promise<void> {
	const detail = loadRunDetail(runId);
	if (!detail) {
		log.warn("run not found", { runId });
		return;
	}

	const companyId = detail.issue_company_id ?? detail.agent_company_id ?? null;
	const isSuccess = exitCode === 0;

	if (isSuccess) {
		await handleSuccess(detail, companyId);
		if (detail.issue_id) {
			await startIssueTestRun(detail.issue_id, {
				workspacePath: detail.worktree_path,
				requireAutoTest: true,
			});
		}
	} else {
		handleFailure(detail, exitCode, companyId);
	}

	syncAgentStatusAfterCompletion(detail);
}

async function handleSuccess(
	detail: RunDetail,
	companyId: string | null,
): Promise<void> {
	const resolvedCompanyId = detail.issue_company_id ?? companyId ?? null;
	const meta = parseRunMeta(detail);

	// Record credibility.
	recordSuccess(detail.agent_slug);
	if (resolvedCompanyId) {
		createRunReflection({
			runId: detail.run_id,
			agentSlug: detail.agent_slug,
			companyId: resolvedCompanyId,
			outcome: "success",
			issueTitle: detail.issue_title ?? undefined,
			costUsd: detail.cost_usd ?? 0,
			durationMs: getRunDurationMs(detail),
		});
	}
	if (!resolvedCompanyId) {
		await finalizeSuccess(detail, companyId, {});
		return;
	}
	if (meta.kind === "cto_review") {
		await handleReviewRunSuccess(detail, resolvedCompanyId, meta);
		return;
	}
	if (
		detail.issue_id &&
		isCeoAgent(toAgentIdentity(detail)) &&
		issueLooksComplex(detail)
	) {
		await createPlan(detail.issue_id, loadRunOutput(detail.run_id));
		return;
	}
	if (
		detail.issue_id &&
		detail.outcome !== "reassigned" &&
		isDevAgent(toAgentIdentity(detail)) &&
		(await runHasCodeChanges(detail))
	) {
		const reviewQueued = await queueCtoReview(detail, resolvedCompanyId);
		if (reviewQueued) return;
	}
	if (
		isCtoAgent(toAgentIdentity(detail)) &&
		detail.review_status === "pending_review"
	) {
		await finalizeSuccess(detail, resolvedCompanyId, {
			doneStatus: true,
			reviewStatus: "approved",
			reviewNote: "✅ CTO completed the work and approved it directly.",
		});
		return;
	}
	await finalizeSuccess(detail, resolvedCompanyId, {});
}

function handleFailure(
	detail: RunDetail,
	exitCode: number,
	companyId: string | null,
): void {
	// Record credibility.
	recordFailure(detail.agent_slug);
	const resolvedCompanyId = detail.issue_company_id ?? companyId ?? null;
	if (resolvedCompanyId) {
		createRunReflection({
			runId: detail.run_id,
			agentSlug: detail.agent_slug,
			companyId: resolvedCompanyId,
			outcome: "failed",
			issueTitle: detail.issue_title ?? undefined,
			costUsd: detail.cost_usd ?? 0,
			durationMs: getRunDurationMs(detail),
			errorMessage: detail.error_message ?? summarizeError(detail, exitCode),
		});
	}

	// Channel notification already sent by server-runner / PTY bridge.
	// Don't duplicate it here.

	// Retry or escalate (synchronous — creates a new pending run).
	const outcome = retryOrEscalate(detail);
	if (outcome === "retried" && detail.issue_id) {
		addAutomationIssueComment(
			detail.issue_id,
			resolvedCompanyId,
			`⚠️ Agent ${detail.agent_slug} encountered an error: ${summarizeError(detail, exitCode)}. Retrying...`,
			detail.agent_slug,
		);
	} else if (outcome === "escalated") {
		handleEscalation(detail, companyId);
	}

	log.info("run failed", {
		runId: detail.run_id,
		exitCode,
	});
}
