/**
 * run-health.ts — heartbeat-age classifier for active runs.
 *
 * Mirrors WUPHF's activity watchdog (broker_streams.go). Translates the gap
 * between "now" and a run's last `updated_at` heartbeat into one of four
 * health buckets, so the board can render a yellow/amber/red indicator
 * before the heartbeat-sweeper actually kills the run.
 *
 * Thresholds match WUPHF's defaults:
 *   - active   : last heartbeat within 90s
 *   - stuck    : 90s..5m  (silently struggling; show a warning chip)
 *   - stalled  : 5m..10m  (likely zombie; show an error chip but keep alive)
 *   - dead     : >10m     (heartbeat-sweeper is about to fail this run)
 *
 * Terminal statuses (success / failed / cancelled / blocked) always map to
 * `done` regardless of timestamps.
 */

export type RunHealth = "active" | "stuck" | "stalled" | "dead" | "done";

export const RUN_HEALTH_STUCK_MS = 90_000;
export const RUN_HEALTH_STALLED_MS = 5 * 60_000;
export const RUN_HEALTH_DEAD_MS = 10 * 60_000;

const TERMINAL_STATUSES = new Set([
	"success",
	"completed",
	"failed",
	"cancelled",
	"canceled",
	"blocked",
]);

export interface RunHealthInput {
	status: string | null | undefined;
	updatedAt?: string | null | undefined;
	startedAt?: string | null | undefined;
}

/**
 * Classify a run's health from its status + last heartbeat. Pure function;
 * exported separately so callers (REST handlers, SSE payload builders, the
 * board UI via copy-paste) can compute consistently.
 */
export function classifyRunHealth(
	input: RunHealthInput,
	now: number = Date.now(),
): RunHealth {
	const status = (input.status ?? "").toLowerCase();
	if (TERMINAL_STATUSES.has(status)) return "done";

	const heartbeat = input.updatedAt ?? input.startedAt ?? null;
	if (!heartbeat) return "active";
	const t = Date.parse(heartbeat);
	if (Number.isNaN(t)) return "active";

	const age = now - t;
	if (age >= RUN_HEALTH_DEAD_MS) return "dead";
	if (age >= RUN_HEALTH_STALLED_MS) return "stalled";
	if (age >= RUN_HEALTH_STUCK_MS) return "stuck";
	return "active";
}
