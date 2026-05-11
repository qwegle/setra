/**
 * resume-packets.ts - cold-start "what was I doing?" prompt assembly.
 *
 * Mirrors WUPHF's resume.go (buildResumePacket / buildResumePackets). On
 * boot, walks runs that were still active when the server died plus the
 * recent unanswered approvals queue and synthesises a per-agent text packet
 * that can be prepended to the next turn so the agent picks up where it
 * left off rather than acting on stale context.
 *
 * Staleness: anything older than RESUME_STALE_THRESHOLD_MS is dropped
 * (default 1h, matching WUPHF's staleUnansweredThreshold). Older work is
 * treated as "zombie" and silently skipped so the operator is not
 * bombarded by ghost runs after a long downtime.
 *
 * Pure builder - this file does not mutate the DB or emit SSE. The caller
 * (server bootstrap) is responsible for deciding what to do with the packet
 * (typically: log it, emit "agent:resume" SSE, or stash it on the next
 * dispatched run as a system message).
 */

import { getRawDb } from "@setra/db";

export const RESUME_STALE_THRESHOLD_MS = 60 * 60_000;

export interface ResumePacket {
	agentSlug: string;
	companyId: string | null;
	body: string;
	activeRunIds: string[];
	pendingApprovalIds: string[];
}

interface InFlightRunRow {
	runId: string;
	agentSlug: string | null;
	companyId: string | null;
	startedAt: string | null;
	updatedAt: string | null;
	issueTitle: string | null;
	worktreePath: string | null;
}

interface PendingApprovalRow {
	id: string;
	companyId: string | null;
	type: string | null;
	title: string | null;
	createdAt: string | null;
	requestedBy: string | null;
}

function isFresh(timestamp: string | null, now: number): boolean {
	if (!timestamp) return true;
	const t = Date.parse(timestamp);
	if (Number.isNaN(t)) return true;
	return now - t < RESUME_STALE_THRESHOLD_MS;
}

/**
 * Build resume packets for every agent that had in-flight work when the
 * process died, or that has an open approval addressed to them. Returns one
 * packet per agent slug; agents with nothing fresh to report are omitted.
 */
export function buildResumePackets(
	now: number = Date.now(),
	db: ReturnType<typeof getRawDb> = getRawDb(),
): ResumePacket[] {
	const runs = db
		.prepare(
			`SELECT r.id          AS runId,
                    r.agent       AS agentSlug,
                    ar.company_id AS companyId,
                    r.started_at  AS startedAt,
                    r.updated_at  AS updatedAt,
                    bi.title      AS issueTitle,
                    p.worktree_path AS worktreePath
               FROM runs r
          LEFT JOIN agent_roster ar ON ar.slug = r.agent
          LEFT JOIN plots p         ON p.id    = r.plot_id
          LEFT JOIN board_issues bi ON bi.linked_plot_id = r.plot_id
              WHERE r.status IN ('running','pending')`,
		)
		.all() as InFlightRunRow[];

	const approvals = db
		.prepare(
			`SELECT id, company_id AS companyId, type, title, created_at AS createdAt,
                    requested_by AS requestedBy
               FROM review_items
              WHERE status = 'pending'`,
		)
		.all() as PendingApprovalRow[];

	const bySlug = new Map<string, ResumePacket>();
	const ensure = (slug: string, companyId: string | null): ResumePacket => {
		const key = `${companyId ?? "_"}::${slug}`;
		const existing = bySlug.get(key);
		if (existing) return existing;
		const packet: ResumePacket = {
			agentSlug: slug,
			companyId,
			body: "",
			activeRunIds: [],
			pendingApprovalIds: [],
		};
		bySlug.set(key, packet);
		return packet;
	};

	const runsBySlug = new Map<string, InFlightRunRow[]>();
	for (const r of runs) {
		if (!r.agentSlug) continue;
		if (!isFresh(r.updatedAt ?? r.startedAt, now)) continue;
		const list = runsBySlug.get(r.agentSlug) ?? [];
		list.push(r);
		runsBySlug.set(r.agentSlug, list);
	}

	for (const [slug, list] of runsBySlug.entries()) {
		const companyId = list[0]?.companyId ?? null;
		const packet = ensure(slug, companyId);
		for (const r of list) packet.activeRunIds.push(r.runId);
		const lines: string[] = [];
		lines.push("[Session resumed - picking up where you left off]");
		lines.push("");
		lines.push("Active runs:");
		for (const r of list) {
			const title = r.issueTitle ? ` - ${r.issueTitle}` : "";
			const wt = r.worktreePath ? ` (worktree: ${r.worktreePath})` : "";
			lines.push(`  - ${r.runId}${title}${wt}`);
		}
		packet.body = lines.join("\n");
	}

	for (const a of approvals) {
		if (!isFresh(a.createdAt, now)) continue;
		// Approvals do not have an addressed-agent column, so we surface them
		// only on the lead's packet by convention. The CEO/lead slug is not
		// available here without another query, so we skip for now and let
		// the caller layer this in. We still record the id so callers can
		// react.
		const slug = a.requestedBy ?? "lead";
		const packet = ensure(slug, a.companyId);
		packet.pendingApprovalIds.push(a.id);
		const note = `Pending approval: ${a.type ?? "?"} - ${a.title ?? a.id}`;
		packet.body = packet.body
			? `${packet.body}\n${note}`
			: `[Session resumed]\n\n${note}`;
	}

	return Array.from(bySlug.values()).filter(
		(p) => p.activeRunIds.length > 0 || p.pendingApprovalIds.length > 0,
	);
}
