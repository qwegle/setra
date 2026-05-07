/**
 * gossip.ts — cross-agent knowledge sharing (wuphf pattern).
 *
 * Agents publish "insights" they discover (patterns, useful configs, lessons
 * learned) to a shared pool.  Other agents query the pool by topic and receive
 * a scored list.  A safety filter rejects any insight that looks like an
 * instruction injection attempt.
 *
 * Storage: `agent_insights` table (server-local, company-scoped).
 * The traces table was not suitable because it requires a NOT NULL project_id;
 * insights are company-wide, not project-scoped.
 */

import { getRawDb } from "@setra/db";

// ─── Internal row type ────────────────────────────────────────────────────────

interface InsightRow {
	id: string;
	company_id: string;
	source_agent: string;
	content: string;
	context: string;
	tags: string;
	credibility: number;
	use_count: number;
	created_at: string;
}

// ─── Safety: anti-prompt-injection filter ─────────────────────────────────────

const INJECTION_PHRASES = [
	"ignore previous instructions",
	"you are now",
	"skip security",
	"override:",
	"system:",
	"approve all",
	"disregard",
	"forget your instructions",
	"new instructions",
	"act as if",
];

function isPromptInjection(text: string): boolean {
	const lower = text.toLowerCase();
	return INJECTION_PHRASES.some((phrase) => lower.includes(phrase));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Publish an insight to the shared knowledge pool.
 * Silently drops the insight if it fails the injection safety check.
 */
export function publishInsight(
	agentSlug: string,
	companyId: string,
	insight: string,
	context: string,
	tags: string[],
): void {
	if (isPromptInjection(insight) || isPromptInjection(context)) {
		// Emit a warning to stderr but never throw — publishing must never crash
		// the calling agent's task loop.
		console.warn(
			`[gossip] Rejected insight from ${agentSlug}: possible prompt injection`,
		);
		return;
	}

	const id = crypto.randomUUID();
	getRawDb()
		.prepare(
			`INSERT OR IGNORE INTO agent_insights
         (id, company_id, source_agent, content, context, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(id, companyId, agentSlug, insight, context, JSON.stringify(tags));
}

/**
 * Query insights relevant to a topic for a given agent.
 *
 * Scoring heuristic:
 *   base = credibility (0–1, default 0.5)
 *   +0.1 for each matching tag
 *   +0.05 × use_count (capped at 0.3) — popular insights float up
 *   −0.2 if the insight is older than 30 days (staleness penalty)
 *
 * Excludes the calling agent's own insights.
 * Returns insights with a decision annotation:
 *   score ≥ 0.7  → 'adopt'
 *   score ≥ 0.4  → 'test'
 *   score <  0.4 → 'reject'
 */
export function queryInsights(
	agentSlug: string,
	companyId: string,
	topic: string,
	limit = 10,
): Array<{
	content: string;
	sourceAgent: string;
	score: number;
	decision: "adopt" | "test" | "reject";
}> {
	const rows = getRawDb()
		.prepare(
			`SELECT * FROM agent_insights
       WHERE company_id = ?
         AND source_agent != ?
       ORDER BY credibility DESC, use_count DESC, created_at DESC
       LIMIT 100`,
		)
		.all(companyId, agentSlug) as InsightRow[];

	const topicLower = topic.toLowerCase();
	const topicTokens = topicLower.split(/\s+/).filter(Boolean);
	const now = Date.now();

	const scored = rows.map((row) => {
		let score = row.credibility;

		// Tag match bonus
		let tags: string[] = [];
		try {
			tags = JSON.parse(row.tags) as string[];
		} catch {
			/* ignore */
		}
		for (const tag of tags) {
			if (topicLower.includes(tag.toLowerCase())) score += 0.1;
		}

		// Topic token match in content/context
		const combined = `${row.content} ${row.context}`.toLowerCase();
		for (const token of topicTokens) {
			if (token.length > 3 && combined.includes(token)) score += 0.05;
		}

		// Popularity bonus (capped)
		score += Math.min(row.use_count * 0.05, 0.3);

		// Staleness penalty (> 30 days)
		const ageMs = now - Date.parse(row.created_at);
		if (ageMs > 30 * 24 * 60 * 60 * 1000) score -= 0.2;

		score = Math.max(0, Math.min(1, score));

		const decision: "adopt" | "test" | "reject" =
			score >= 0.7 ? "adopt" : score >= 0.4 ? "test" : "reject";

		return {
			content: row.content,
			sourceAgent: row.source_agent,
			score,
			decision,
		};
	});

	// Sort by score desc, take top `limit` non-rejected unless nothing else
	const useful = scored.filter((s) => s.decision !== "reject");
	const result = (useful.length > 0 ? useful : scored)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	// Increment use_count for returned insights (best-effort, fire-and-forget)
	try {
		for (const item of result) {
			getRawDb()
				.prepare(
					`UPDATE agent_insights
           SET use_count = use_count + 1
         WHERE company_id = ? AND source_agent != ? AND content = ?`,
				)
				.run(companyId, agentSlug, item.content);
		}
	} catch {
		/* non-critical */
	}

	return result;
}
