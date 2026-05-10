/**
 * runs.ts — lifecycle endpoint for run completion events.
 *
 * POST /api/runs/:id/completed
 *   Called by the desktop PTY bridge (pty-dispatch.ts) when a PTY-executed
 *   run exits. Triggers the autonomous lifecycle: commit, push, PR creation,
 *   credibility scoring, and retry/escalation logic.
 *
 * This route is intentionally lightweight — the heavy lifting is in
 * run-lifecycle.ts. The endpoint just validates input and fires off the handler.
 */

import { Hono } from "hono";
import { assembleRunBundle } from "../lib/run-bundle.js";
import { listRunChunks } from "../lib/run-chunks.js";
import { onRunCompleted } from "../lib/run-lifecycle.js";

export const runsRoute = new Hono();

/**
 * GET /api/runs/:id
 *
 * Returns the run header (status, agent, timestamps) plus the resolved
 * system prompt that was actually sent to the model. Used by the board
 * to render the agent activity strip header and by the evidence-bundle
 * exporter as the canonical record of "what we asked the agent to do".
 */
runsRoute.get("/:id", (c) => {
	const runId = c.req.param("id");
	if (!runId) return c.json({ ok: false, error: "missing run id" }, 400);
	try {
		// Lazy import — keeps the route file's hot path independent of
		// better-sqlite3 startup ordering during tests.
		const { getRawDb } = require("@setra/db") as typeof import("@setra/db");
		const row = getRawDb()
			.prepare(
				`SELECT r.id, r.agent AS agentSlug, r.status, r.started_at AS startedAt,
                        r.first_chunk_at AS firstChunkAt, r.ended_at AS endedAt,
                        r.system_prompt AS systemPrompt, r.exit_code AS exitCode,
                        ar.company_id AS companyId, ar.display_name AS displayName
                   FROM runs r
              LEFT JOIN agent_roster ar ON ar.slug = r.agent
                  WHERE r.id = ?`,
			)
			.get(runId);
		if (!row) return c.json({ ok: false, error: "run not found" }, 404);
		return c.json({ ok: true, run: row });
	} catch (err) {
		return c.json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "lookup failed",
			},
			500,
		);
	}
});

/**
 * GET /api/runs/:id/chunks?since=N&limit=M
 *
 * Returns chunks recorded for a run after the given sequence number.
 * Clients that cannot subscribe to SSE (or that are catching up after a
 * disconnect) use this to fetch missed activity. The response shape
 * mirrors the run:chunk SSE event payload so render code can be shared.
 */
runsRoute.get("/:id/chunks", (c) => {
	const runId = c.req.param("id");
	if (!runId) return c.json({ ok: false, error: "missing run id" }, 400);
	const since = Number.parseInt(c.req.query("since") ?? "-1", 10);
	const limit = Math.min(
		Math.max(Number.parseInt(c.req.query("limit") ?? "500", 10), 1),
		2000,
	);
	const chunks = listRunChunks(
		runId,
		Number.isFinite(since) ? since : -1,
		limit,
	);
	return c.json({ ok: true, runId, chunks });
});

/**
 * GET /api/runs/:id/bundle
 *
 * Returns the full evidence bundle for a run: header, system prompt,
 * every chunk, structured tool calls, files touched, and any artifacts
 * tied to the same issue/agent. This is the canonical "what did the
 * agent do" surface for enterprise audit, PM review, and the human
 * approval gate before commit/PR.
 */
runsRoute.get("/:id/bundle", (c) => {
	const runId = c.req.param("id");
	if (!runId) return c.json({ ok: false, error: "missing run id" }, 400);
	try {
		const bundle = assembleRunBundle(runId);
		if (!bundle) return c.json({ ok: false, error: "run not found" }, 404);
		return c.json({ ok: true, bundle });
	} catch (err) {
		return c.json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "failed to assemble bundle",
			},
			500,
		);
	}
});

runsRoute.post("/:id/completed", async (c) => {
	const runId = c.req.param("id");
	if (!runId) {
		return c.json({ ok: false, error: "missing run id" }, 400);
	}

	let exitCode = 0;
	try {
		const body = await c.req.json();
		if (typeof body.exitCode === "number") exitCode = body.exitCode;
	} catch {
		// No body or invalid JSON — treat as success (exit 0).
	}

	// Fire-and-forget — the response is immediate; lifecycle work is async.
	void onRunCompleted(runId, exitCode).catch((err) => {
		console.warn(`[runs-route] onRunCompleted failed for ${runId}:`, err);
	});

	return c.json({ ok: true, runId, exitCode });
});
