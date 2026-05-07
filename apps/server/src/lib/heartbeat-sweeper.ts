/**
 * Heartbeat sweeper — safety net for crashed agent processes.
 *
 * Periodically scans `runs` rows still in `running` or `pending` status whose
 * `updated_at` heartbeat is older than `staleAfterMs`. Any such run is marked
 * `failed` with an explanatory error_message. The owning agent in
 * `agent_roster` (matched by slug == runs.agent) is flipped back to `idle`
 * so the orchestrator can pick up new work.
 *
 * NOTE: the `runs` table exposes `ended_at` (not `completed_at`) for its
 * terminal timestamp — see packages/db/src/schema/index.ts. We deliberately
 * reuse that column rather than ALTER-ing the schema.
 */
import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";

export interface SweeperOptions {
	intervalMs?: number;
	staleAfterMs?: number;
}

export interface SweeperHandle {
	stop: () => void;
	isRunning: () => boolean;
}

interface StaleRow {
	id: string;
	agent: string | null;
	plot_id: string | null;
	updated_at: string | null;
}

export interface SweepResult {
	failedRunIds: string[];
}

/**
 * Run a single sweep pass against the supplied raw better-sqlite3 handle.
 * Exported for unit testing — production code uses startHeartbeatSweeper().
 */
export function sweepOnce(
	db: ReturnType<typeof getRawDb>,
	staleAfterMs: number = 5 * 60_000,
	now: number = Date.now(),
): SweepResult {
	const rows = db
		.prepare(
			`SELECT id, agent, plot_id, updated_at FROM runs WHERE status IN ('running','pending')`,
		)
		.all() as StaleRow[];

	const stale = rows.filter((r) => {
		if (!r.updated_at) return false;
		const t = Date.parse(r.updated_at);
		if (Number.isNaN(t)) return false;
		return now - t > staleAfterMs;
	});

	if (stale.length === 0) return { failedRunIds: [] };

	const failTs = new Date(now).toISOString();
	const failStmt = db.prepare(
		`UPDATE runs
        SET status        = 'failed',
            ended_at      = ?,
            error_message = 'heartbeat timeout — process appears to have died',
            updated_at    = ?
      WHERE id = ?
        AND status IN ('running','pending')`,
	);
	const idleStmt = db.prepare(
		`UPDATE agent_roster SET status = 'idle' WHERE slug = ? AND status = 'running'`,
	);
	const activeByAgentStmt = db.prepare(
		`SELECT COUNT(*) AS c FROM runs WHERE agent = ? AND status IN ('running','pending')`,
	);

	const failedRunIds: string[] = [];
	const tx = db.transaction((items: StaleRow[]) => {
		for (const r of items) {
			const res = failStmt.run(failTs, failTs, r.id);
			if (res.changes > 0) {
				failedRunIds.push(r.id);
				if (r.agent) {
					try {
						const active = activeByAgentStmt.get(r.agent) as
							| { c: number }
							| undefined;
						if ((active?.c ?? 0) === 0) idleStmt.run(r.agent);
					} catch {
						/* roster table may be absent in tests */
					}
				}
			}
		}
	});
	tx(stale);

	for (const r of stale) {
		if (!failedRunIds.includes(r.id)) continue;
		try {
			emit("agent:heartbeat-failed", {
				runId: r.id,
				agent: r.agent,
				plotId: r.plot_id,
				reason: "heartbeat timeout",
			});
		} catch {
			/* SSE not yet wired up in test envs */
		}
	}

	return { failedRunIds };
}

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function startHeartbeatSweeper(
	opts: SweeperOptions = {},
): SweeperHandle {
	const intervalMs = opts.intervalMs ?? 60_000;
	const staleAfterMs = opts.staleAfterMs ?? 5 * 60_000;

	if (_timer) stopHeartbeatSweeper();
	_running = true;

	const tick = () => {
		if (!_running) return;
		try {
			sweepOnce(getRawDb(), staleAfterMs);
		} catch (err) {
			console.error("[heartbeat-sweeper] sweep failed:", err);
		}
	};

	_timer = setInterval(tick, intervalMs);
	if (typeof (_timer as { unref?: () => void }).unref === "function") {
		(_timer as { unref: () => void }).unref();
	}

	return {
		stop: stopHeartbeatSweeper,
		isRunning: () => _running,
	};
}

export function stopHeartbeatSweeper(): void {
	if (_timer) clearInterval(_timer);
	_timer = null;
	_running = false;
}
