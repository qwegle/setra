/**
 * plots.ts — plot-level admin endpoints.
 *
 * Routes:
 *   POST /api/plots/:id/branch
 *     Body / query: { fromRunId?: string, name?: string }
 *     Forks an existing plot at the given run. Creates a new plot row
 *     with branched_from_plot_id / branched_from_run_id / branched_at
 *     populated; the worktree itself is not created here (the dispatcher
 *     will lazily create it on the next run, same as for any new plot).
 *
 *   GET /api/plots/:id/transcript.jsonl
 *     Streams the read-only JSONL projection of the plot's run + chunk
 *     + team_message activity, written by transcript-exporter.ts. 404 if
 *     no activity has been recorded yet.
 *
 * Both endpoints are tenant-isolated via company_id on the project that
 * owns the plot.
 */

import { existsSync, statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { getCompanyId } from "../lib/company-scope.js";
import { createLogger } from "../lib/logger.js";
import { transcriptPathForPlot } from "../lib/transcript-exporter.js";

const log = createLogger("plots-route");

export const plotsRoute = new Hono();

interface PlotRow {
	id: string;
	name: string;
	project_id: string;
	branch: string;
	base_branch: string;
	ground_id: string | null;
	status: string;
	agent_template: string | null;
	description: string | null;
	auto_checkpoint: number;
	checkpoint_interval_s: number;
}

interface ProjectRow {
	id: string;
	company_id: string | null;
}

/**
 * Returns the plot iff it belongs to a project owned by the caller's
 * company. Returns null otherwise — handlers must convert to 404 to
 * avoid leaking existence across tenants.
 */
function findPlotForCompany(plotId: string, companyId: string): PlotRow | null {
	const raw = getRawDb();
	const plot = raw.prepare(`SELECT * FROM plots WHERE id = ?`).get(plotId) as
		| PlotRow
		| undefined;
	if (!plot) return null;
	const project = raw
		.prepare(`SELECT id, company_id FROM projects WHERE id = ?`)
		.get(plot.project_id) as ProjectRow | undefined;
	if (!project) return null;
	// Legacy projects may have null company_id — fall through (no cross-tenant
	// leak risk, the row is unowned).
	if (project.company_id && project.company_id !== companyId) return null;
	return plot;
}

plotsRoute.post("/:id/branch", async (c) => {
	const sourceId = c.req.param("id");
	const companyId = getCompanyId(c);
	const plot = findPlotForCompany(sourceId, companyId);
	if (!plot) return c.json({ error: "plot not found" }, 404);

	let body: Record<string, unknown> = {};
	try {
		body = (await c.req.json()) as Record<string, unknown>;
	} catch {
		// allow empty body
	}
	const fromRunId =
		typeof body.fromRunId === "string"
			? body.fromRunId
			: (c.req.query("fromRunId") ?? null);
	const requestedName =
		typeof body.name === "string" && body.name.trim()
			? body.name.trim()
			: `${plot.name} (branch)`;

	const raw = getRawDb();

	let branchedFromRunId: string | null = null;
	let baseBranch = plot.base_branch;
	if (fromRunId) {
		const run = raw
			.prepare(
				`SELECT id, plot_id, branch_name FROM runs WHERE id = ? AND plot_id = ?`,
			)
			.get(fromRunId, plot.id) as
			| { id: string; plot_id: string; branch_name: string | null }
			| undefined;
		if (!run) return c.json({ error: "fromRunId not in plot" }, 400);
		branchedFromRunId = run.id;
		// Prefer the mark recorded right before this run completed so
		// the new plot starts from a known-good checkpoint.
		const mark = raw
			.prepare(
				`SELECT commit_hash FROM marks
                 WHERE run_id = ?
              ORDER BY created_at DESC
                 LIMIT 1`,
			)
			.get(fromRunId) as { commit_hash: string } | undefined;
		if (mark?.commit_hash) baseBranch = mark.commit_hash;
	}

	const newId = crypto.randomUUID();
	const now = new Date().toISOString();
	const newBranch = `setra/plot-${newId}`;

	try {
		raw
			.prepare(
				`INSERT INTO plots
                 (id, name, project_id, branch, base_branch, ground_id, status,
                  agent_template, description, auto_checkpoint, checkpoint_interval_s,
                  branched_from_plot_id, branched_from_run_id, branched_at,
                  created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				newId,
				requestedName,
				plot.project_id,
				newBranch,
				baseBranch,
				plot.ground_id,
				plot.agent_template,
				plot.description,
				plot.auto_checkpoint,
				plot.checkpoint_interval_s,
				plot.id,
				branchedFromRunId,
				now,
				now,
				now,
			);
	} catch (err) {
		log.warn("plot branch insert failed", {
			sourcePlot: plot.id,
			error: err instanceof Error ? err.message : String(err),
		});
		return c.json({ error: "branch failed" }, 500);
	}

	return c.json(
		{
			id: newId,
			name: requestedName,
			projectId: plot.project_id,
			branch: newBranch,
			baseBranch,
			branchedFromPlotId: plot.id,
			branchedFromRunId,
			branchedAt: now,
			status: "idle",
		},
		201,
	);
});

plotsRoute.get("/:id/transcript.jsonl", (c) => {
	const plotId = c.req.param("id");
	const companyId = getCompanyId(c);
	const plot = findPlotForCompany(plotId, companyId);
	if (!plot) return c.json({ error: "plot not found" }, 404);

	const file = transcriptPathForPlot(plot.id);
	if (!existsSync(file)) {
		return c.json({ error: "transcript not yet recorded" }, 404);
	}

	const size = statSync(file).size;
	c.header("Content-Type", "application/x-ndjson");
	c.header(
		"Content-Disposition",
		`inline; filename="plot-${plot.id}-transcript.jsonl"`,
	);
	c.header("Content-Length", String(size));
	return stream(c, async (s) => {
		const fileStream = createReadStream(file, { encoding: "utf8" });
		for await (const chunk of fileStream) await s.write(chunk as string);
	});
});
