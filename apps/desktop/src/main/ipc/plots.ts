import { getDb, schema } from "@setra/db";
import { CreatePlotSchema, UpdatePlotSchema } from "@setra/types";
import { eq } from "drizzle-orm";
import { ipcMain } from "electron";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// plots IPC handlers
// All inputs are validated with Zod before touching the database.
// ─────────────────────────────────────────────────────────────────────────────

export function registerPlotsHandlers(): void {
	// ── list plots for a project ──────────────────────────────────────────────
	ipcMain.handle("plots:list", async (_event, projectId: string) => {
		const db = getDb();
		return db
			.select()
			.from(schema.plots)
			.where(eq(schema.plots.projectId, projectId))
			.orderBy(schema.plots.updatedAt)
			.all();
	});

	// ── get a single plot ─────────────────────────────────────────────────────
	ipcMain.handle("plots:get", async (_event, id: string) => {
		const db = getDb();
		const plot = db
			.select()
			.from(schema.plots)
			.where(eq(schema.plots.id, id))
			.get();

		if (!plot) throw new Error(`Plot not found: ${id}`);
		return plot;
	});

	// ── create a new plot ─────────────────────────────────────────────────────
	ipcMain.handle("plots:create", async (_event, rawInput: unknown) => {
		const input = CreatePlotSchema.parse(rawInput);
		const db = getDb();

		const id = crypto.randomUUID();
		const branch = input.branch ?? `setra/plot-${id}`;

		const now = new Date().toISOString();
		const newPlot: typeof schema.plots.$inferInsert = {
			id,
			name: input.name,
			projectId: input.projectId,
			branch,
			baseBranch: input.baseBranch ?? "main",
			groundId: input.groundId ?? null,
			description: input.description ?? null,
			autoCheckpoint: input.autoCheckpoint ?? true,
			checkpointIntervalS: input.checkpointIntervalS ?? 300,
			agentTemplate: input.agentTemplate
				? JSON.stringify(input.agentTemplate)
				: null,
			createdAt: now,
			updatedAt: now,
		};

		db.insert(schema.plots).values(newPlot).run();

		// Auto-enable globally-enabled tools for this new plot
		const globalTools = db
			.select()
			.from(schema.tools)
			.where(eq(schema.tools.isGlobal, true))
			.all();

		for (const tool of globalTools) {
			db.insert(schema.plotTools)
				.values({ plotId: id, toolId: tool.id, enabled: true })
				.onConflictDoNothing()
				.run();
		}

		return db.select().from(schema.plots).where(eq(schema.plots.id, id)).get();
	});

	// ── update a plot ─────────────────────────────────────────────────────────
	ipcMain.handle("plots:update", async (_event, rawInput: unknown) => {
		const parsed = UpdatePlotSchema.extend({
			id: z.string().uuid(),
		}).parse(rawInput);

		const { id, ...fields } = parsed;
		const db = getDb();
		const now = new Date().toISOString();

		const updates: Partial<typeof schema.plots.$inferInsert> = {
			updatedAt: now,
		};

		if (fields.name !== undefined) updates.name = fields.name;
		if (fields.description !== undefined)
			updates.description = fields.description;
		if (fields.status !== undefined) updates.status = fields.status;
		if (fields.autoCheckpoint !== undefined)
			updates.autoCheckpoint = fields.autoCheckpoint;
		if (fields.checkpointIntervalS !== undefined)
			updates.checkpointIntervalS = fields.checkpointIntervalS;
		if (fields.groundId !== undefined) updates.groundId = fields.groundId;
		if (fields.agentTemplate !== undefined) {
			updates.agentTemplate = fields.agentTemplate
				? JSON.stringify(fields.agentTemplate)
				: null;
		}

		db.update(schema.plots).set(updates).where(eq(schema.plots.id, id)).run();

		return db.select().from(schema.plots).where(eq(schema.plots.id, id)).get();
	});

	// ── delete a plot ─────────────────────────────────────────────────────────
	ipcMain.handle("plots:delete", async (_event, id: string) => {
		const db = getDb();

		// Verify it exists first
		const plot = db
			.select()
			.from(schema.plots)
			.where(eq(schema.plots.id, id))
			.get();
		if (!plot) throw new Error(`Plot not found: ${id}`);

		// Runs and plot_tools will cascade-delete due to FK constraints
		db.delete(schema.plots).where(eq(schema.plots.id, id)).run();
	});

	// ── archive a plot (soft-delete) ──────────────────────────────────────────
	ipcMain.handle("plots:archive", async (_event, id: string) => {
		const db = getDb();
		db.update(schema.plots)
			.set({ status: "archived", updatedAt: new Date().toISOString() })
			.where(eq(schema.plots.id, id))
			.run();
	});

	// ── list tools enabled for a plot ─────────────────────────────────────────
	ipcMain.handle("plots:list-tools", async (_event, plotId: string) => {
		const db = getDb();
		return db
			.select({
				tool: schema.tools,
				enabled: schema.plotTools.enabled,
				envOverrides: schema.plotTools.envOverrides,
			})
			.from(schema.plotTools)
			.innerJoin(schema.tools, eq(schema.plotTools.toolId, schema.tools.id))
			.where(eq(schema.plotTools.plotId, plotId))
			.all();
	});

	// ── toggle a tool on/off for a plot ───────────────────────────────────────
	ipcMain.handle("plots:toggle-tool", async (_event, rawInput: unknown) => {
		const input = z
			.object({
				plotId: z.string().uuid(),
				toolId: z.string(),
				enabled: z.boolean(),
			})
			.parse(rawInput);

		const db = getDb();
		db.insert(schema.plotTools)
			.values({
				plotId: input.plotId,
				toolId: input.toolId,
				enabled: input.enabled,
			})
			.onConflictDoUpdate({
				target: [schema.plotTools.plotId, schema.plotTools.toolId],
				set: { enabled: input.enabled },
			})
			.run();
	});
}
