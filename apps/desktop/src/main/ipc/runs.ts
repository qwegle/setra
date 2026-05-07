import { getDb, schema } from "@setra/db";
import { CreateRunSchema } from "@setra/types";
import { and, desc, eq, gte } from "drizzle-orm";
import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Runs IPC handlers
// ─────────────────────────────────────────────────────────────────────────────

export function registerRunsHandlers(): void {
	// ── list runs for a plot ──────────────────────────────────────────────────
	ipcMain.handle("runs:list", async (_event, plotId: string) => {
		const db = getDb();
		return db
			.select()
			.from(schema.runs)
			.where(eq(schema.runs.plotId, plotId))
			.orderBy(desc(schema.runs.startedAt))
			.limit(100)
			.all();
	});

	// ── get a single run ──────────────────────────────────────────────────────
	ipcMain.handle("runs:get", async (_event, id: string) => {
		const db = getDb();
		const run = db
			.select()
			.from(schema.runs)
			.where(eq(schema.runs.id, id))
			.get();

		if (!run) throw new Error(`Run not found: ${id}`);
		return run;
	});

	// ── create a new run ──────────────────────────────────────────────────────
	ipcMain.handle("runs:create", async (_event, rawInput: unknown) => {
		const input = CreateRunSchema.parse(rawInput);
		const db = getDb();

		// Verify the plot exists
		const plot = db
			.select()
			.from(schema.plots)
			.where(eq(schema.plots.id, input.plotId))
			.get();

		if (!plot) throw new Error(`Plot not found: ${input.plotId}`);

		// Only one run can be active per plot at a time
		const activeRun = db
			.select()
			.from(schema.runs)
			.where(eq(schema.runs.plotId, input.plotId))
			.all()
			.find((r) => r.status === "running" || r.status === "pending");

		if (activeRun) {
			throw new Error(
				`Plot ${input.plotId} already has an active run: ${activeRun.id}`,
			);
		}

		const id = crypto.randomUUID();
		const tmuxSession = `setra-${input.plotId}`;
		const now = new Date().toISOString();

		const newRun: typeof schema.runs.$inferInsert = {
			id,
			plotId: input.plotId,
			agent: input.agent,
			agentVersion: input.agentVersion ?? null,
			agentBinary: input.agentBinary ?? null,
			agentArgs: input.agentArgs ? JSON.stringify(input.agentArgs) : null,
			groundId: input.groundId ?? plot.groundId ?? null,
			tmuxSession,
			startedAt: now,
			updatedAt: now,
		};

		db.insert(schema.runs).values(newRun).run();

		// Update the plot's last active timestamp
		db.update(schema.plots)
			.set({
				status: "running",
				lastActiveAt: now,
				updatedAt: now,
			})
			.where(eq(schema.plots.id, input.plotId))
			.run();

		// Notify all renderer windows about the plot status change
		broadcastToWindows("plots:status-changed", input.plotId, "running");

		return db.select().from(schema.runs).where(eq(schema.runs.id, id)).get();
	});

	// ── cancel a run ──────────────────────────────────────────────────────────
	ipcMain.handle("runs:cancel", async (_event, id: string) => {
		const db = getDb();
		const run = db
			.select()
			.from(schema.runs)
			.where(eq(schema.runs.id, id))
			.get();

		if (!run) throw new Error(`Run not found: ${id}`);
		if (run.status !== "running" && run.status !== "pending") {
			throw new Error(`Run ${id} is not active (status: ${run.status})`);
		}

		const now = new Date().toISOString();
		db.update(schema.runs)
			.set({ status: "cancelled", endedAt: now, updatedAt: now })
			.where(eq(schema.runs.id, id))
			.run();

		// Reset the plot status back to idle
		db.update(schema.plots)
			.set({ status: "idle", updatedAt: now })
			.where(eq(schema.plots.id, run.plotId))
			.run();

		broadcastToWindows("plots:status-changed", run.plotId, "idle");
	});

	// ── get terminal output chunks for a run ──────────────────────────────────
	ipcMain.handle("runs:get-chunks", async (_event, rawInput: unknown) => {
		const input = z
			.object({
				runId: z.string().uuid(),
				fromSequence: z.number().int().nonnegative().default(0),
				limit: z.number().int().min(1).max(10000).default(5000),
			})
			.parse(rawInput);

		const db = getDb();

		// Efficient range query using the compound index on (run_id, sequence)
		return db
			.select()
			.from(schema.chunks)
			.where(
				and(
					eq(schema.chunks.runId, input.runId),
					gte(schema.chunks.sequence, input.fromSequence),
				),
			)
			.orderBy(schema.chunks.sequence)
			.limit(input.limit)
			.all();
	});

	// ── record a cost update from PTY output parsing ──────────────────────────
	ipcMain.handle("runs:update-cost", async (_event, rawInput: unknown) => {
		const input = z
			.object({
				runId: z.string().uuid(),
				costUsd: z.number().nonnegative(),
				promptTokens: z.number().int().nonnegative().optional(),
				completionTokens: z.number().int().nonnegative().optional(),
				cacheReadTokens: z.number().int().nonnegative().optional(),
				cacheWriteTokens: z.number().int().nonnegative().optional(),
				confidence: z.enum(["high", "low"]),
			})
			.parse(rawInput);

		const db = getDb();
		const now = new Date().toISOString();

		const updates: Partial<typeof schema.runs.$inferInsert> = {
			costUsd: input.costUsd,
			costConfidence: input.confidence,
			updatedAt: now,
		};
		if (input.promptTokens !== undefined)
			updates.promptTokens = input.promptTokens;
		if (input.completionTokens !== undefined)
			updates.completionTokens = input.completionTokens;
		if (input.cacheReadTokens !== undefined)
			updates.cacheReadTokens = input.cacheReadTokens;
		if (input.cacheWriteTokens !== undefined)
			updates.cacheWriteTokens = input.cacheWriteTokens;

		db.update(schema.runs)
			.set(updates)
			.where(eq(schema.runs.id, input.runId))
			.run();

		// Broadcast the cost update to the renderer so the ledger updates live
		broadcastToWindows("runs:cost-update", input.runId, input.costUsd);

		// ── Budget auto-pause ─────────────────────────────────────────────────
		// Read per-run limit from app_settings. If exceeded, cancel the run.
		try {
			const limitRow = db
				.select()
				.from(schema.appSettings)
				.where(eq(schema.appSettings.key, "run_limit_usd"))
				.get();
			const limitUsd = limitRow ? Number.parseFloat(limitRow.value) : 0;
			if (limitUsd > 0 && input.costUsd >= limitUsd) {
				// Auto-cancel: update run status, kill PTY
				const run = db
					.select()
					.from(schema.runs)
					.where(eq(schema.runs.id, input.runId))
					.get();
				if (run && run.status === "running") {
					db.update(schema.runs)
						.set({
							status: "cancelled",
							errorMessage: `Budget cap $${limitUsd.toFixed(2)} reached`,
							updatedAt: now,
						})
						.where(eq(schema.runs.id, input.runId))
						.run();
					if (run.plotId) {
						db.update(schema.plots)
							.set({ status: "idle" })
							.where(eq(schema.plots.id, run.plotId))
							.run();
						broadcastToWindows("plots:status-changed", run.plotId, "idle");
					}
					broadcastToWindows("runs:budget-exceeded", input.runId, limitUsd);
				}
			}
		} catch {
			/* non-fatal */
		}
	});

	// ── mark a run as completed ───────────────────────────────────────────────
	ipcMain.handle("runs:complete", async (_event, rawInput: unknown) => {
		const input = z
			.object({
				runId: z.string().uuid(),
				exitCode: z.number().int(),
				outcome: z.enum(["success", "partial", "failed"]).optional(),
				errorMessage: z.string().optional(),
			})
			.parse(rawInput);

		const db = getDb();
		const run = db
			.select()
			.from(schema.runs)
			.where(eq(schema.runs.id, input.runId))
			.get();

		if (!run) throw new Error(`Run not found: ${input.runId}`);

		const now = new Date().toISOString();
		const status = input.exitCode === 0 ? "completed" : "failed";
		const outcome =
			input.outcome ?? (input.exitCode === 0 ? "success" : "failed");

		db.update(schema.runs)
			.set({
				status,
				outcome,
				exitCode: input.exitCode,
				errorMessage: input.errorMessage ?? null,
				endedAt: now,
				updatedAt: now,
			})
			.where(eq(schema.runs.id, input.runId))
			.run();

		// Reset plot status
		db.update(schema.plots)
			.set({ status: "idle", updatedAt: now })
			.where(eq(schema.plots.id, run.plotId))
			.run();

		broadcastToWindows("plots:status-changed", run.plotId, "idle");
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: send an event to all renderer windows
// ─────────────────────────────────────────────────────────────────────────────
function broadcastToWindows(channel: string, ...args: unknown[]): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	}
}
