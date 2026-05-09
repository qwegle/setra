/**
 * collaboration.repo.ts — Repository for team_messages (collaboration channel)
 */

import { getRawDb } from "@setra/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChannelMessageRow {
	id: string;
	agentSlug: string;
	channel: string;
	body: string;
	threadId: string | null;
	createdAt: string;
	messageKind: string | null;
	pinned: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function listChannels(companyId: string | undefined | null): string[] {
	const rows = (
		companyId
			? getRawDb()
					.prepare(
						`SELECT DISTINCT channel FROM team_messages
            WHERE company_id = ?
            ORDER BY channel`,
					)
					.all(companyId)
			: getRawDb()
					.prepare(
						`SELECT DISTINCT channel FROM team_messages ORDER BY channel`,
					)
					.all()
	) as Array<{ channel: string }>;

	const list = rows.map((r) => r.channel).filter(Boolean);
	if (!list.includes("general")) list.unshift("general");
	return list;
}

export function listMessages(
	companyId: string | undefined | null,
	channel: string,
	limit: number,
	hideLifecycle = true,
): ChannelMessageRow[] {
	// Filter out run lifecycle noise: "🚀 X started run" / "✅ X finished run" / "❌ X failed"
	// These are automatically posted by channel-hooks and clutter the conversation view.
	const lifecycleFilter = hideLifecycle
		? ` AND content NOT LIKE '🚀 %' AND content NOT LIKE '✅ %' AND content NOT LIKE '❌ %'`
		: "";
	const rows = (
		companyId
			? getRawDb()
					.prepare(
						`SELECT id, from_agent AS agentSlug, channel, content AS body,
                  plot_id AS threadId, created_at AS createdAt,
                  message_kind AS messageKind, COALESCE(pinned, 0) AS pinned
             FROM team_messages
            WHERE channel = ? AND (company_id = ?)${lifecycleFilter}
            ORDER BY created_at DESC
            LIMIT ?`,
					)
					.all(channel, companyId, limit)
			: getRawDb()
					.prepare(
						`SELECT id, from_agent AS agentSlug, channel, content AS body,
                  plot_id AS threadId, created_at AS createdAt,
                  message_kind AS messageKind, COALESCE(pinned, 0) AS pinned
             FROM team_messages
            WHERE channel = ?${lifecycleFilter}
            ORDER BY created_at DESC
            LIMIT ?`,
					)
					.all(channel, limit)
	) as ChannelMessageRow[];

	return rows.reverse(); // oldest first for display
}

export function createMessage(params: {
	channel: string;
	content: string;
	fromAgent: string;
	companyId: string | undefined | null;
}): { id: string; createdAt: string } {
	const id = crypto.randomUUID();
	const sequence = Date.now();
	const now = new Date().toISOString();

	getRawDb()
		.prepare(
			`INSERT INTO team_messages (id, plot_id, from_agent, channel, content, sequence, company_id, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			params.fromAgent,
			params.channel,
			params.content,
			sequence,
			params.companyId ?? null,
			now,
		);

	return { id, createdAt: now };
}

export function insertAutomatedReply(params: {
	channelId: string;
	reply: string;
	companyId: string | undefined | null;
	fromAgent: string;
}): void {
	const id = crypto.randomUUID();
	const sequence = Date.now();
	const now = new Date().toISOString();

	getRawDb()
		.prepare(
			`INSERT INTO team_messages (id, plot_id, from_agent, channel, content, sequence, company_id, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			params.fromAgent,
			params.channelId,
			params.reply,
			sequence,
			params.companyId ?? null,
			now,
		);
}
