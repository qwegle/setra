/**
 * agent-lifecycle.ts — manages agent_roster.status transitions.
 *
 * Status states:
 *   - 'awaiting_key' — agent was hired but no provider key was configured
 *                      at hire time. Stays here until a key is saved.
 *   - 'idle'         — ready to run, no run currently in flight.
 *   - 'running'      — at least one run is in flight (set by run dispatcher).
 *   - 'paused'       — admin-paused or budget hard_stop. paused_reason
 *                      explains why.
 *
 * When the user saves an API key in /api/settings, recheckAvailability()
 * walks every awaiting_key agent, re-runs resolveAutoAdapter, and flips it
 * to 'idle' (with a freshly-resolved adapter+model) if a provider is now
 * configured. Emits SSE so the UI updates live.
 */

import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";
import { resolveAutoAdapter } from "./resolve-auto-adapter.js";

function hasColumn(table: string, column: string): boolean {
	try {
		const rows = getRawDb()
			.prepare(`PRAGMA table_info(${table})`)
			.all() as Array<{ name: string }>;
		return rows.some((row) => row.name === column);
	} catch {
		return false;
	}
}

export type AgentStatus = "awaiting_key" | "idle" | "running" | "paused";

export interface RecheckResult {
	examined: number;
	activated: number;
	agents: Array<{
		id: string;
		slug: string;
		adapter: string;
		model: string | null;
	}>;
}

/**
 * Walk every awaiting_key agent and try to activate them now that settings
 * may have changed. Returns counts so settings POST can include a summary.
 */
export function recheckAvailability(companyId?: string | null): RecheckResult {
	const raw = getRawDb();
	const rows = (
		companyId
			? raw
					.prepare(
						`SELECT id, slug, adapter_type, model_id, company_id FROM agent_roster
          WHERE status = 'awaiting_key' AND (company_id = ? OR company_id IS NULL)`,
					)
					.all(companyId)
			: raw
					.prepare(
						`SELECT id, slug, adapter_type, model_id, company_id FROM agent_roster WHERE status = 'awaiting_key'`,
					)
					.all()
	) as Array<{
		id: string;
		slug: string;
		adapter_type: string;
		model_id: string | null;
		company_id: string | null;
	}>;

	const activated: RecheckResult["agents"] = [];

	for (const row of rows) {
		const resolved = resolveAutoAdapter(
			row.adapter_type,
			row.model_id,
			row.company_id ?? companyId ?? null,
		);
		if (resolved.adapter !== null) {
			raw
				.prepare(
					`UPDATE agent_roster
            SET status = 'idle',
                adapter_type = ?,
                model_id = COALESCE(?, model_id),
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
				)
				.run(resolved.adapter, resolved.model, row.id);
			activated.push({
				id: row.id,
				slug: row.slug,
				adapter: resolved.adapter,
				model: resolved.model,
			});
			emit("agent:status_changed", {
				agentId: row.id,
				slug: row.slug,
				status: "idle",
				adapter: resolved.adapter,
				model: resolved.model,
				reason: "key_configured",
			});
		}
	}

	return {
		examined: rows.length,
		activated: activated.length,
		agents: activated,
	};
}

/**
 * Pause an agent (sets status='paused' + a reason) and cancel any pending
 * runs. Used by budget hard_stop and admin pause.
 */
export interface PauseResult {
	agentsPaused: number;
	runsCancelled: number;
}

export function pauseAllAgents(
	reason: string,
	companyId?: string | null,
): PauseResult {
	const raw = getRawDb();
	const now = new Date().toISOString();
	const rosterScoped =
		Boolean(companyId) && hasColumn("agent_roster", "company_id");
	const runsScoped = Boolean(companyId) && hasColumn("runs", "company_id");

	const pauseInfo = raw
		.prepare(
			`UPDATE agent_roster
        SET status = 'paused',
            paused_reason = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status IN ('idle', 'running')${rosterScoped ? "\n        AND company_id = ?" : ""}`,
		)
		.run(...(rosterScoped ? [reason, companyId] : [reason]));

	const cancelInfo = raw
		.prepare(
			`UPDATE runs
        SET status = 'cancelled',
            updated_at = ?,
            ended_at  = ?
      WHERE status IN ('pending', 'running')${runsScoped ? "\n        AND company_id = ?" : ""}`,
		)
		.run(...(runsScoped ? [now, now, companyId] : [now, now]));

	emit("agent:bulk_paused", {
		reason,
		companyId: companyId ?? null,
		agentsPaused: pauseInfo.changes ?? 0,
		runsCancelled: cancelInfo.changes ?? 0,
	});

	return {
		agentsPaused: pauseInfo.changes ?? 0,
		runsCancelled: cancelInfo.changes ?? 0,
	};
}

/**
 * Unpause agents (e.g. after raising the budget cap). Sets back to idle and
 * clears paused_reason. Awaiting_key agents stay awaiting_key.
 */
export function unpauseAllAgents(companyId?: string | null): {
	agentsResumed: number;
} {
	const raw = getRawDb();
	const info = companyId
		? raw
				.prepare(
					`UPDATE agent_roster
        SET status = 'idle',
            paused_reason = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status = 'paused' AND company_id = ?`,
				)
				.run(companyId)
		: raw
				.prepare(
					`UPDATE agent_roster
        SET status = 'idle',
            paused_reason = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status = 'paused'`,
				)
				.run();
	emit("agent:bulk_resumed", {
		companyId: companyId ?? null,
		count: info.changes ?? 0,
	});
	return { agentsResumed: info.changes ?? 0 };
}
