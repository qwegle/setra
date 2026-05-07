/**
 * track-llm-cost.ts — Lightweight cost tracking for non-run LLM calls.
 *
 * When agents make LLM calls outside of the formal server-runner pipeline
 * (idle conversations, wake-on-comment, collaboration replies), this utility
 * records the usage and cost to the `runs` table so the dashboard stays accurate.
 */

import { getRawDb } from "@setra/db";
import { estimateCanonicalModelCost } from "./model-pricing.js";

interface OpenAIUsage {
	prompt_tokens?: number | undefined;
	completion_tokens?: number | undefined;
	total_tokens?: number | undefined;
}

interface LlmCostParams {
	agentSlug: string;
	model: string;
	usage: OpenAIUsage;
	source: "idle-converse" | "wake-reply" | "collab-reply" | "ai-chat";
	companyId: string | null | undefined;
}

function computeCost(
	model: string,
	promptTokens: number,
	completionTokens: number,
): number {
	return estimateCanonicalModelCost(model, promptTokens, completionTokens);
}

/**
 * Ensure there's a system plot for lightweight runs.
 * Returns the plot ID for the "__system" plot.
 */
function ensureSystemPlot(companyId: string | null | undefined): string {
	const db = getRawDb();
	const SYSTEM_PLOT_ID = "__system_cost_tracking";

	const existing = db
		.prepare(`SELECT id FROM plots WHERE id = ?`)
		.get(SYSTEM_PLOT_ID) as { id: string } | undefined;

	if (existing) return existing.id;

	// Need a project_id — get or create a system project
	let projectId: string | undefined;
	if (companyId) {
		const proj = db
			.prepare(`SELECT id FROM board_projects WHERE company_id = ? LIMIT 1`)
			.get(companyId) as { id: string } | undefined;
		projectId = proj?.id;
	}
	if (!projectId) {
		const proj = db.prepare(`SELECT id FROM board_projects LIMIT 1`).get() as
			| { id: string }
			| undefined;
		projectId = proj?.id;
	}
	if (!projectId) {
		// Create a minimal system project
		projectId = "__system_project";
		try {
			db.prepare(
				`INSERT OR IGNORE INTO board_projects (id, name, slug, company_id, created_at, updated_at)
 VALUES (?, 'System', 'system', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
			).run(projectId, companyId ?? "default");
		} catch {
			// May fail if table schema differs — best effort
		}
	}

	try {
		db.prepare(
			`INSERT OR IGNORE INTO plots (id, name, project_id, branch, base_branch, status, created_at, updated_at)
 VALUES (?, 'System Cost Tracking', ?, 'main', 'main', 'idle',
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
		).run(SYSTEM_PLOT_ID, projectId);
	} catch {
		// Best effort
	}

	return SYSTEM_PLOT_ID;
}

/**
 * Record an LLM call's cost and token usage in the runs table.
 * Best-effort — never throws.
 */
export function recordLlmCost(params: LlmCostParams): void {
	try {
		const db = getRawDb();
		const promptTokens = params.usage.prompt_tokens ?? 0;
		const completionTokens = params.usage.completion_tokens ?? 0;
		const costUsd = computeCost(params.model, promptTokens, completionTokens);

		const plotId = ensureSystemPlot(params.companyId);
		const runId = crypto.randomUUID();
		const now = new Date().toISOString();

		db.prepare(
			`INSERT INTO runs (id, plot_id, agent, status, cost_usd, cost_confidence,
                   prompt_tokens, completion_tokens, started_at, ended_at, updated_at)
 VALUES (?, ?, ?, 'completed', ?, 'estimated', ?, ?, ?, ?, ?)`,
		).run(
			runId,
			plotId,
			params.agentSlug,
			costUsd,
			promptTokens,
			completionTokens,
			now,
			now,
			now,
		);

		if (costUsd > 0) {
			console.log(
				`[cost] ${params.agentSlug}/${params.source}: $${costUsd.toFixed(6)} ` +
					`(${promptTokens} in / ${completionTokens} out, model=${params.model})`,
			);
		}
	} catch (err) {
		console.warn("[track-llm-cost] failed to record:", err);
	}
}
