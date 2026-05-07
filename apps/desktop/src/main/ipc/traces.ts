import { getDb, schema } from "@setra/db";
import { desc, eq, like, or } from "drizzle-orm";
import { ipcMain } from "electron";

export function registerTracesHandlers(): void {
	ipcMain.handle("traces:list", (_e, projectId: string) => {
		const db = getDb();
		if (projectId) {
			return db
				.select()
				.from(schema.traces)
				.where(eq(schema.traces.projectId, projectId))
				.orderBy(desc(schema.traces.createdAt))
				.limit(100)
				.all();
		}
		return db
			.select()
			.from(schema.traces)
			.orderBy(desc(schema.traces.createdAt))
			.limit(100)
			.all();
	});

	ipcMain.handle("traces:search", (_e, rawInput: unknown) => {
		const input = rawInput as {
			query: string;
			limit?: number;
			projectId?: string;
		};
		const db = getDb();
		const limit = input.limit ?? 20;
		const terms = input.query
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => `%${t}%`);

		// Simple LIKE search across content — Phase 1 before sqlite-vec
		const whereClause =
			terms.length > 0
				? or(...terms.map((t) => like(schema.traces.content, t)))
				: undefined;

		const rows = db
			.select()
			.from(schema.traces)
			.where(whereClause)
			.orderBy(desc(schema.traces.createdAt))
			.limit(limit)
			.all();

		// Attach a naive similarity score based on how many terms matched
		return rows.map((row) => {
			const matchCount = terms.filter((t) =>
				row.content.toLowerCase().includes(t.slice(1, -1).toLowerCase()),
			).length;
			const similarity = terms.length > 0 ? matchCount / terms.length : 1;
			return { ...row, similarity };
		});
	});

	ipcMain.handle("traces:delete", (_e, id: string) => {
		getDb().delete(schema.traces).where(eq(schema.traces.id, id)).run();
	});
}
