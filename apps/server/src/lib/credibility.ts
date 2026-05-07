/**
 * credibility.ts — Bayesian agent credibility scoring.
 *
 * Credibility is a 0-1 score computed as a smoothed success rate.
 * Insights (gossip, shared knowledge) are scored by a weighted combination of
 * credibility, relevance, and freshness — used by the autonomous loop to decide
 * whether to adopt, test, or reject observations from other agents.
 */

import { getRawDb } from "@setra/db";

export interface AgentScore {
	agentSlug: string;
	successes: number;
	failures: number;
	credibility: number; // 0–1, Bayesian-smoothed
}

// ─── Bayesian credibility ─────────────────────────────────────────────────────

/**
 * Compute credibility score with a Laplace-style prior of 5 virtual successes
 * on each side. This prevents a brand-new agent (0 runs) from having 0 score,
 * and a single-failure agent from bottoming out immediately.
 *
 * Formula: (successes + prior) / (successes + failures + 2 * prior)
 */
export function computeCredibility(
	successes: number,
	failures: number,
): number {
	const prior = 5;
	return (successes + prior) / (successes + failures + prior * 2);
}

// ─── Insight scoring (gossip adoption) ───────────────────────────────────────

/**
 * Score an insight for adoption using the wuphf pattern:
 *   total = 0.4 * credibility + 0.4 * relevance + 0.2 * freshness
 *
 * @param credibility  0–1 agent credibility score
 * @param relevance    0–1 semantic relevance of the insight
 * @param freshnessMs  epoch-ms timestamp when the insight was created
 */
export function scoreInsight(
	credibility: number,
	relevance: number,
	freshnessMs: number,
): { score: number; decision: "adopt" | "test" | "reject" } {
	const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
	const freshness = Math.exp(
		(-Math.LN2 * (Date.now() - freshnessMs)) / HALF_LIFE_MS,
	);
	const score = 0.4 * credibility + 0.4 * relevance + 0.2 * freshness;
	return {
		score,
		decision: score >= 0.7 ? "adopt" : score >= 0.4 ? "test" : "reject",
	};
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

/** Ensure the agent_scores row exists, then increment the success counter. */
export function recordSuccess(agentSlug: string): void {
	try {
		const db = getRawDb();
		const now = new Date().toISOString();
		db.prepare(
			`INSERT INTO agent_scores (agent_slug, successes, failures, last_updated)
         VALUES (?, 1, 0, ?)
         ON CONFLICT(agent_slug) DO UPDATE
           SET successes = successes + 1,
               last_updated = excluded.last_updated`,
		).run(agentSlug, now);
	} catch (err) {
		console.warn("[credibility] recordSuccess failed:", err);
	}
}

/** Ensure the agent_scores row exists, then increment the failure counter. */
export function recordFailure(agentSlug: string): void {
	try {
		const db = getRawDb();
		const now = new Date().toISOString();
		db.prepare(
			`INSERT INTO agent_scores (agent_slug, successes, failures, last_updated)
         VALUES (?, 0, 1, ?)
         ON CONFLICT(agent_slug) DO UPDATE
           SET failures = failures + 1,
               last_updated = excluded.last_updated`,
		).run(agentSlug, now);
	} catch (err) {
		console.warn("[credibility] recordFailure failed:", err);
	}
}

/** Load an agent's score row and compute its live credibility. */
export function getAgentScore(agentSlug: string): AgentScore {
	const db = getRawDb();
	const row = db
		.prepare(
			`SELECT agent_slug, successes, failures
         FROM agent_scores WHERE agent_slug = ?`,
		)
		.get(agentSlug) as
		| { agent_slug: string; successes: number; failures: number }
		| undefined;

	const successes = row?.successes ?? 0;
	const failures = row?.failures ?? 0;
	return {
		agentSlug,
		successes,
		failures,
		credibility: computeCredibility(successes, failures),
	};
}
