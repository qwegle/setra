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

import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import { findPriorRunPrs } from "../lib/cross-run-memory.js";
import { assembleRunBundle } from "../lib/run-bundle.js";
import { listRunChunks } from "../lib/run-chunks.js";
import { classifyRunHealth } from "../lib/run-health.js";
import { onRunCompleted } from "../lib/run-lifecycle.js";
import * as integrationsRepo from "../repositories/integrations.repo.js";

export const runsRoute = new Hono();

function resolveGitHubToken(companyId: string): string | null {
	const envToken = process.env.GITHUB_TOKEN?.trim();
	if (envToken) return envToken;
	const integration = integrationsRepo
		.listIntegrations(companyId)
		.find((row) => row.type.toLowerCase() === "github");
	if (!integration?.config) return null;
	for (const key of ["token", "accessToken", "githubToken", "pat", "apiKey"]) {
		const value = integration.config[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

function resolveRepoUrl(companyId: string): string | null {
	const integration = integrationsRepo
		.listIntegrations(companyId)
		.find((row) => row.type.toLowerCase() === "github");
	if (!integration?.config) return null;
	for (const key of ["repoUrl", "repository", "repo", "url"]) {
		const value = integration.config[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

/**
 * Tenant guard for run-scoped reads. Resolves the run's owning company
 * via the agent_roster join, then 404s if the caller's company does
 * not match. We return 404 (not 403) to avoid leaking the existence
 * of cross-tenant run ids.
 *
 * `null` callerCompanyId means the caller is in legacy/instance-token
 * mode with no company pin — we let that through, the legacy boundary
 * is handled by the auth layer.
 *
 * Returns the run's companyId on success; null if the caller is denied
 * (caller should return 404).
 */
function authorizeRunAccess(
	runId: string,
	callerCompanyId: string | null,
): { ok: true; runCompanyId: string | null } | { ok: false } {
	if (!callerCompanyId) return { ok: true, runCompanyId: null };
	const row = getRawDb()
		.prepare(
			`SELECT ar.company_id AS companyId
			   FROM runs r
		  LEFT JOIN agent_roster ar ON ar.slug = r.agent
			  WHERE r.id = ?`,
		)
		.get(runId) as { companyId: string | null } | undefined;
	if (!row) return { ok: false };
	if (row.companyId && row.companyId !== callerCompanyId) {
		return { ok: false };
	}
	return { ok: true, runCompanyId: row.companyId };
}

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
	const auth = authorizeRunAccess(runId, getCompanyId(c));
	if (!auth.ok) return c.json({ ok: false, error: "run not found" }, 404);
	try {
		const row = getRawDb()
			.prepare(
				`SELECT r.id, r.agent AS agentSlug, r.status, r.started_at AS startedAt,
                        r.first_chunk_at AS firstChunkAt, r.ended_at AS endedAt,
                        r.updated_at AS updatedAt,
                        r.system_prompt AS systemPrompt, r.exit_code AS exitCode,
                        ar.company_id AS companyId, ar.display_name AS displayName
                   FROM runs r
              LEFT JOIN agent_roster ar ON ar.slug = r.agent
                  WHERE r.id = ?`,
			)
			.get(runId) as
			| {
					status?: string | null;
					updatedAt?: string | null;
					startedAt?: string | null;
			  }
			| undefined;
		if (!row) return c.json({ ok: false, error: "run not found" }, 404);
		const health = classifyRunHealth({
			status: row.status,
			updatedAt: row.updatedAt,
			startedAt: row.startedAt,
		});
		return c.json({ ok: true, run: { ...row, health } });
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
	const auth = authorizeRunAccess(runId, getCompanyId(c));
	if (!auth.ok) return c.json({ ok: false, error: "run not found" }, 404);
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
	const auth = authorizeRunAccess(runId, getCompanyId(c));
	if (!auth.ok) return c.json({ ok: false, error: "run not found" }, 404);
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

runsRoute.get("/prior-prs", async (c) => {
	const companyId = getCompanyId(c);
	if (!companyId) {
		return c.json({ ok: false, error: "no company in scope" }, 400);
	}
	const repoUrlParam = c.req.query("repoUrl");
	const repoUrl = repoUrlParam?.trim() || resolveRepoUrl(companyId);
	if (!repoUrl) {
		return c.json(
			{
				ok: false,
				error:
					"no GitHub repository configured; pass ?repoUrl= or set integrations.github.repoUrl",
			},
			400,
		);
	}
	const token = resolveGitHubToken(companyId);
	if (!token) {
		return c.json(
			{ ok: false, error: "no GitHub token configured for this company" },
			400,
		);
	}
	const component = c.req.query("component")?.trim() || undefined;
	const limit = Number.parseInt(c.req.query("limit") ?? "25", 10);
	const stateRaw = (c.req.query("state") ?? "closed").toLowerCase();
	const state = (
		["open", "closed", "all"].includes(stateRaw) ? stateRaw : "closed"
	) as "open" | "closed" | "all";
	try {
		const prs = await findPriorRunPrs({
			repoUrl,
			token,
			...(component ? { component } : {}),
			limit: Number.isFinite(limit) ? limit : 25,
			state,
		});
		return c.json({ ok: true, prs });
	} catch (err) {
		return c.json(
			{
				ok: false,
				error: err instanceof Error ? err.message : "GitHub query failed",
			},
			502,
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
