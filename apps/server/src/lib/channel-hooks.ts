/**
 * channel-hooks.ts — small helpers that drop activity messages into the
 * `team_messages` table so the Collaboration page reflects what agents are
 * doing in near real-time without needing the agents themselves to author
 * messages. Each hook is best-effort — failures are logged and swallowed.
 *
 * As of the SDLC delivery loop work, these helpers ALSO fan out to the
 * project's own `proj-<slug>` channel when the run/issue is associated with
 * a project. Posting to the company-wide #general channel is opt-in via
 * `company_settings.broadcast_to_general` — defaulting to false to keep the
 * general channel from drowning in per-project noise.
 */

import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";
import { getProjectChannel } from "./channels.js";
import { getCompanySettings } from "./company-settings.js";
import { fireOutboundWebhooks } from "./outbound-webhooks.js";
import { buildAgentStatusBlock, fanOutToSlack } from "./webhook-dispatcher.js";

type Lifecycle = "started" | "completed" | "failed";

const STARTED_PREFIX = "🚀";
const SUCCESS_PREFIX = "✅";
const FAILED_PREFIX = "❌";

function nextSequence(channel: string): number {
	const row = getRawDb()
		.prepare(
			`SELECT COALESCE(MAX(sequence), 0) AS s FROM team_messages WHERE channel = ?`,
		)
		.get(channel) as { s: number } | undefined;
	return (row?.s ?? 0) + 1;
}

interface ContextPayload {
	runId?: string;
	issueId?: string | null;
	costUsd?: number;
	error?: string;
}

function isBroadcastToGeneralEnabled(companyId: string): boolean {
	try {
		const s = getCompanySettings(companyId);
		return s["broadcast_to_general"] === true;
	} catch {
		return false;
	}
}

function lookupProjectIdForIssue(
	issueId: string | null | undefined,
): string | null {
	if (!issueId) return null;
	const row = getRawDb()
		.prepare(`SELECT project_id AS projectId FROM board_issues WHERE id = ?`)
		.get(issueId) as { projectId: string | null } | undefined;
	return row?.projectId ?? null;
}

function insertMessage(
	companyId: string,
	channel: string,
	agentSlug: string,
	content: string,
): string {
	const raw = getRawDb();
	const id =
		globalThis.crypto?.randomUUID?.() ??
		`msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const seq = nextSequence(channel);
	raw
		.prepare(
			`INSERT INTO team_messages (id, channel, from_agent, content, message_type, sequence)
     VALUES (?, ?, ?, ?, 'status', ?)`,
		)
		.run(id, channel, agentSlug, content, seq);
	try {
		raw
			.prepare(`UPDATE team_messages SET company_id = ? WHERE id = ?`)
			.run(companyId, id);
	} catch {
		/* column may be absent on legacy DBs */
	}
	emit("team:message", { id, channel, fromAgent: agentSlug, companyId });
	return id;
}

export function postChannelMessage(
	companyId: string,
	channel: string,
	agentSlug: string,
	agentDisplayName: string,
	lifecycle: Lifecycle,
	ctx: ContextPayload = {},
): void {
	try {
		const raw = getRawDb();
		let title = "";
		let prUrl: string | null = null;
		if (ctx.issueId) {
			const issue = raw
				.prepare(`SELECT title, pr_url AS prUrl FROM board_issues WHERE id = ?`)
				.get(ctx.issueId) as
				| { title: string; prUrl: string | null }
				| undefined;
			if (issue) {
				title = issue.title;
				prUrl = issue.prUrl ?? null;
			}
		}
		let prefix = STARTED_PREFIX;
		let verb = "started";
		if (lifecycle === "completed") {
			prefix = SUCCESS_PREFIX;
			verb = "finished";
		}
		if (lifecycle === "failed") {
			prefix = FAILED_PREFIX;
			verb = "failed";
		}

		const target = title
			? ` ${title}`
			: ctx.runId
				? ` run ${ctx.runId.slice(0, 8)}`
				: "";
		const tail =
			lifecycle === "completed" && prUrl
				? ` (PR: ${prUrl})`
				: lifecycle === "failed" && ctx.error
					? ` — ${ctx.error}`
					: "";
		const content = `${prefix} ${agentDisplayName} ${verb}${target}${tail}`;

		// 1. Always post to the project's own channel when we can resolve one.
		const projectId = lookupProjectIdForIssue(ctx.issueId ?? null);
		let projectChannelSlug: string | null = null;
		if (projectId) {
			const ch = getProjectChannel(projectId);
			if (ch) {
				projectChannelSlug = ch.slug;
				insertMessage(companyId, ch.slug, agentSlug, content);
			}
		}

		// 2. #general fan-out is opt-in via company_settings.broadcast_to_general.
		//    When no project channel was resolved, fall back to general so the
		//    event isn't lost entirely.
		const broadcast = isBroadcastToGeneralEnabled(companyId);
		if (!projectChannelSlug || broadcast) {
			const target = channel || "general";
			if (target !== projectChannelSlug) {
				insertMessage(companyId, target, agentSlug, content);
			}
		}

		void fanOutToSlack(
			companyId,
			buildAgentStatusBlock(agentDisplayName, lifecycle, {
				issueTitle: title || undefined,
				costUsd: ctx.costUsd,
				error: ctx.error,
				prUrl: prUrl || undefined,
			}),
		);

		void fireOutboundWebhooks(companyId, `agent.${lifecycle}`, {
			agent: agentSlug,
			agentName: agentDisplayName,
			lifecycle,
			issueTitle: title || undefined,
			runId: ctx.runId,
			issueId: ctx.issueId,
			costUsd: ctx.costUsd,
			error: ctx.error,
			prUrl: prUrl || undefined,
		});
	} catch (err) {
		console.warn(
			`[channel-hooks] failed to post ${lifecycle} for ${agentSlug}:`,
			err,
		);
	}
}

/**
 * Post a free-form message to a project's channel (and optionally #general).
 * Used by the lifecycle endpoints to announce stage transitions.
 */
export function postProjectMessage(
	companyId: string,
	projectId: string,
	agentSlug: string,
	content: string,
): void {
	try {
		const ch = getProjectChannel(projectId);
		if (ch) insertMessage(companyId, ch.slug, agentSlug, content);
		if (isBroadcastToGeneralEnabled(companyId)) {
			insertMessage(companyId, "general", agentSlug, content);
		}
	} catch (err) {
		console.warn("[channel-hooks] postProjectMessage failed:", err);
	}
}
