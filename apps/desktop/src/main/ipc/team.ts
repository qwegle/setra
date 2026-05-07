import { getDb, schema } from "@setra/db";
import { and, eq, gte } from "drizzle-orm";
import { ipcMain } from "electron";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Team IPC handlers — multi-agent coordination messaging
// ─────────────────────────────────────────────────────────────────────────────

export function registerTeamHandlers(): void {
	// ── list messages for a channel (cursor-based) ────────────────────────────
	ipcMain.handle("team:list-messages", async (_event, rawInput: unknown) => {
		const input = z
			.object({
				channel: z.string(),
				fromSequence: z.number().int().nonnegative().default(0),
			})
			.parse(rawInput);

		const db = getDb();
		return db
			.select()
			.from(schema.teamMessages)
			.where(
				and(
					eq(schema.teamMessages.channel, input.channel),
					gte(schema.teamMessages.sequence, input.fromSequence),
				),
			)
			.orderBy(schema.teamMessages.sequence)
			.all();
	});

	// ── send a message ────────────────────────────────────────────────────────
	ipcMain.handle("team:send-message", async (_event, rawInput: unknown) => {
		const input = z
			.object({
				channel: z.string(),
				fromAgent: z.string(),
				toAgent: z.string().optional(),
				content: z.string(),
				messageType: z
					.enum(["task", "reply", "status", "handoff", "approval_request"])
					.default("task"),
				plotId: z.string().uuid().optional(),
			})
			.parse(rawInput);

		const db = getDb();

		// Derive next sequence number for the channel
		const last = db
			.select({ sequence: schema.teamMessages.sequence })
			.from(schema.teamMessages)
			.where(eq(schema.teamMessages.channel, input.channel))
			.orderBy(schema.teamMessages.sequence)
			.all();
		const nextSequence =
			last.length > 0 ? (last[last.length - 1]?.sequence ?? 0) + 1 : 0;

		const id = crypto.randomUUID();
		const newMessage: typeof schema.teamMessages.$inferInsert = {
			id,
			channel: input.channel,
			fromAgent: input.fromAgent,
			toAgent: input.toAgent ?? null,
			content: input.content,
			messageType: input.messageType,
			sequence: nextSequence,
			plotId: input.plotId ?? null,
		};

		db.insert(schema.teamMessages).values(newMessage).run();

		return db
			.select()
			.from(schema.teamMessages)
			.where(eq(schema.teamMessages.id, id))
			.get();
	});
}
