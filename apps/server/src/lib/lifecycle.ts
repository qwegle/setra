/**
 * lifecycle.ts — issue SDLC state machine.
 *
 * The eight-stage SDLC pipeline is the spine of the delivery loop. Each stage
 * has one or more legal forward transitions plus an always-available `cancelled`
 * terminal escape hatch. Routes call `transitionStage()` which validates the
 * jump, writes a row to `issue_lifecycle_events`, and updates `board_issues`.
 *
 * Stages are stored as text in `board_issues.lifecycle_stage`. Older rows
 * default to `backlog` via the schema ALTER COLUMN loop.
 */

import { getRawDb } from "@setra/db";
import {
	ISSUE_LIFECYCLE_STAGES,
	type IssueLifecycleStage,
	canTransitionIssueLifecycleStage,
	mapIssueLifecycleStageToStatus,
} from "@setra/domain";

export const LIFECYCLE_STAGES = ISSUE_LIFECYCLE_STAGES;
export type LifecycleStage = IssueLifecycleStage;

/**
 * Board status enum — the legacy/projection of the SDLC stage. New code
 * should treat `lifecycle_stage` as canonical and derive `status` from it
 * via `mapStageToStatus`. The PATCH /issues/:id `status` field is kept
 * functional for board drag-and-drop UX but is otherwise considered
 * non-canonical.
 */
export const ISSUE_STATUSES = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"done",
	"cancelled",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/**
 * Project a `LifecycleStage` onto the (smaller) board status enum. The
 * mapping intentionally collapses several pipeline stages onto a single
 * board column so the kanban stays comprehensible.
 */
export function mapStageToStatus(stage: LifecycleStage): IssueStatus {
	return mapIssueLifecycleStageToStatus(stage);
}

export const FORWARD_STAGES: readonly LifecycleStage[] = [
	"backlog",
	"branched",
	"committed",
	"pr_open",
	"in_review",
	"merged",
	"deployed",
	"verified",
];

export function isValidTransition(
	from: LifecycleStage | null,
	to: LifecycleStage,
): boolean {
	if (!LIFECYCLE_STAGES.includes(to)) return false;
	return canTransitionIssueLifecycleStage(from, to);
}

export interface IssueLifecycleRow {
	id: string;
	companyId: string | null;
	projectId: string;
	lifecycleStage: LifecycleStage | null;
}

export function loadLifecycle(issueId: string): IssueLifecycleRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT id, company_id AS companyId, project_id AS projectId,
                lifecycle_stage AS lifecycleStage
           FROM board_issues
          WHERE id = ?`,
			)
			.get(issueId) as IssueLifecycleRow | undefined) ?? null
	);
}

export interface TransitionOptions {
	to: LifecycleStage;
	actorType: "agent" | "human" | "system";
	actorId?: string | null;
	/**
	 * If true, skip the validation step. Used by internal git plumbing
	 * endpoints that already implicitly enforce ordering.
	 */
	force?: boolean;
}

export interface TransitionResult {
	issueId: string;
	companyId: string | null;
	fromStage: LifecycleStage | null;
	toStage: LifecycleStage;
	noop: boolean;
}

/**
 * Advance an issue's lifecycle stage. Idempotent — if the issue is already
 * at the target stage and the stage is not `committed` (which permits
 * self-loops for repeated commits), returns noop=true without writing.
 *
 * Throws on invalid transitions unless `force` is set.
 */
export function transitionStage(
	issueId: string,
	opts: TransitionOptions,
): TransitionResult {
	const raw = getRawDb();
	const row = loadLifecycle(issueId);
	if (!row) throw new Error(`issue ${issueId} not found`);

	const current = (row.lifecycleStage ?? "backlog") as LifecycleStage;

	if (current === opts.to && opts.to !== "committed") {
		return {
			issueId,
			companyId: row.companyId,
			fromStage: current,
			toStage: opts.to,
			noop: true,
		};
	}

	if (!opts.force && !isValidTransition(current, opts.to)) {
		throw new Error(
			`invalid lifecycle transition ${current} → ${opts.to} for issue ${issueId}`,
		);
	}

	const now = new Date().toISOString();
	// lifecycle_stage is canonical; keep the projected `status` synchronized
	// in the same UPDATE so board readers (which still query `status` for
	// kanban columns) never observe a divergence.
	const projectedStatus = mapStageToStatus(opts.to);

	// Wrap UPDATE + INSERT in a transaction for atomicity
	const tx = raw.transaction(() => {
		raw
			.prepare(
				`UPDATE board_issues
          SET lifecycle_stage = ?, status = ?, updated_at = ?
        WHERE id = ?
          AND company_id IS ?`,
			)
			.run(opts.to, projectedStatus, now, issueId, row.companyId);

		raw
			.prepare(
				`INSERT INTO issue_lifecycle_events
         (id, issue_id, company_id, from_stage, to_stage, actor_type, actor_id, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				crypto.randomUUID(),
				issueId,
				row.companyId,
				current,
				opts.to,
				opts.actorType,
				opts.actorId ?? null,
				now,
			);
	});
	tx();

	return {
		issueId,
		companyId: row.companyId,
		fromStage: current,
		toStage: opts.to,
		noop: false,
	};
}
