/**
 * sprint-board.ts — server-rendered markdown digest of every open issue in a
 * project, grouped by SDLC lifecycle stage. Persisted as a single pinned row
 * in `team_messages` (message_kind='pinned_sprint_board') keyed by the
 * project's channel.
 *
 * The board is the closest thing the user has to a "what's everyone doing"
 * widget — re-rendered on every lifecycle event for that project plus on the
 * dispatcher tick. Worst case it's stale by ~30s.
 */

import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";
import { ensureProjectChannel, getProjectChannel } from "./channels.js";
import { LIFECYCLE_STAGES, type LifecycleStage } from "./lifecycle.js";

const STAGE_LABELS: Record<LifecycleStage, string> = {
	backlog: "📋 Backlog",
	branched: "🌿 Branched",
	committed: "💾 Committed",
	pr_open: "📤 PR Open",
	in_review: "👀 In Review",
	merged: "🔀 Merged",
	deployed: "🚀 Deployed",
	verified: "✅ Verified",
	cancelled: "❌ Cancelled",
};

// Stages worth showing on the board — verified/cancelled hide because the
// board is a "still in flight" view.
const VISIBLE_STAGES: readonly LifecycleStage[] = [
	"backlog",
	"branched",
	"committed",
	"pr_open",
	"in_review",
	"merged",
	"deployed",
];

interface IssueRow {
	id: string;
	slug: string;
	title: string;
	status: string;
	lifecycleStage: string | null;
	agentName: string | null;
}

function progressFor(stage: LifecycleStage): number {
	// 8-step pipeline; verified=100%
	const idx = LIFECYCLE_STAGES.indexOf(stage);
	if (idx < 0 || stage === "cancelled") return 0;
	return Math.round((idx / 7) * 100);
}

function bar(pct: number, width = 10): string {
	const filled = Math.round((pct / 100) * width);
	return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function projectIssues(projectId: string): IssueRow[] {
	const raw = getRawDb();
	return raw
		.prepare(
			`SELECT i.id, i.slug, i.title, i.status,
            i.lifecycle_stage AS lifecycleStage,
            COALESCE(r.display_name, '') AS agentName
       FROM board_issues i
       LEFT JOIN agent_roster r ON r.id = i.assigned_agent_id
      WHERE i.project_id = ?
        AND COALESCE(i.lifecycle_stage, 'backlog') NOT IN ('verified','cancelled')
      ORDER BY i.created_at ASC`,
		)
		.all(projectId) as IssueRow[];
}

export interface SprintBoardSnapshot {
	markdown: string;
	totals: Record<LifecycleStage, number>;
	issueCount: number;
}

export function renderSprintBoard(projectId: string): SprintBoardSnapshot {
	const raw = getRawDb();
	const project = raw
		.prepare(`SELECT id, name, slug FROM board_projects WHERE id = ?`)
		.get(projectId) as { id: string; name: string; slug: string } | undefined;

	const issues = projectIssues(projectId);
	const totals: Record<LifecycleStage, number> = {
		backlog: 0,
		branched: 0,
		committed: 0,
		pr_open: 0,
		in_review: 0,
		merged: 0,
		deployed: 0,
		verified: 0,
		cancelled: 0,
	};
	for (const i of issues) {
		const s = (i.lifecycleStage ?? "backlog") as LifecycleStage;
		if (totals[s] !== undefined) totals[s]++;
	}

	const lines: string[] = [];
	lines.push(`### 🏃 Sprint Board — ${project?.name ?? "Project"}`);
	lines.push("");
	lines.push(
		`**${issues.length} open issue${issues.length === 1 ? "" : "s"}** — updated ${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`,
	);
	lines.push("");

	for (const stage of VISIBLE_STAGES) {
		const stageIssues = issues.filter(
			(i) => (i.lifecycleStage ?? "backlog") === stage,
		);
		if (stageIssues.length === 0) continue;
		lines.push(`#### ${STAGE_LABELS[stage]} (${stageIssues.length})`);
		for (const i of stageIssues) {
			const pct = progressFor(stage);
			const who = i.agentName ? ` — _${i.agentName}_` : "";
			lines.push(`- \`${i.slug}\` ${i.title}${who}  \`${bar(pct)}\` ${pct}%`);
		}
		lines.push("");
	}

	if (issues.length === 0) {
		lines.push("_No open issues. Time to plan the next sprint._");
	}

	return { markdown: lines.join("\n"), totals, issueCount: issues.length };
}

const PINNED_KIND = "pinned_sprint_board";

/**
 * Re-render the sprint board for the given project and upsert the pinned
 * message in its channel. Idempotent — calling it 100 times in a row is
 * cheap (one UPDATE per call).
 */
export function rebuildSprintBoard(
	projectId: string,
): SprintBoardSnapshot | null {
	const raw = getRawDb();
	const project = raw
		.prepare(
			`SELECT id, name, company_id AS companyId
       FROM board_projects WHERE id = ?`,
		)
		.get(projectId) as
		| { id: string; name: string; companyId: string | null }
		| undefined;
	if (!project?.companyId) return null;

	let channel = getProjectChannel(projectId);
	if (!channel) {
		channel = ensureProjectChannel(project.companyId, projectId, project.name);
	}

	const snapshot = renderSprintBoard(projectId);

	const existing = raw
		.prepare(
			`SELECT id FROM team_messages
       WHERE channel = ? AND company_id = ? AND message_kind = ?
       ORDER BY created_at DESC LIMIT 1`,
		)
		.get(channel.slug, project.companyId, PINNED_KIND) as
		| { id: string }
		| undefined;

	const now = new Date().toISOString();
	if (existing) {
		raw
			.prepare(
				`UPDATE team_messages SET content = ?, created_at = ? WHERE id = ?`,
			)
			.run(snapshot.markdown, now, existing.id);
	} else {
		const id = crypto.randomUUID();
		const seq = Date.now();
		try {
			raw
				.prepare(
					`INSERT INTO team_messages
           (id, channel, from_agent, content, message_type, message_kind, pinned, sequence, company_id, created_at)
         VALUES (?, ?, 'system', ?, 'status', ?, 1, ?, ?, ?)`,
				)
				.run(
					id,
					channel.slug,
					snapshot.markdown,
					PINNED_KIND,
					seq,
					project.companyId,
					now,
				);
		} catch {
			// Older DBs may not have message_kind/pinned columns — fall back.
			raw
				.prepare(
					`INSERT INTO team_messages
           (id, channel, from_agent, content, message_type, sequence, company_id, created_at)
         VALUES (?, ?, 'system', ?, 'status', ?, ?, ?)`,
				)
				.run(id, channel.slug, snapshot.markdown, seq, project.companyId, now);
		}
	}

	emit("sprint:board:updated", {
		projectId,
		channel: channel.slug,
		companyId: project.companyId,
	});

	return snapshot;
}
