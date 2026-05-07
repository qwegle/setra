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
import { onRunCompleted } from "../lib/run-lifecycle.js";

export const runsRoute = new Hono();

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
