import { getDb, schema } from "@setra/db";
import { eq } from "drizzle-orm";
import { ipcMain } from "electron";

export function registerToolsHandlers(): void {
	ipcMain.handle("tools:list", () => {
		return getDb().select().from(schema.tools).all();
	});

	ipcMain.handle("tools:register", (_e, rawInput: unknown) => {
		const input = rawInput as {
			name: string;
			description?: string;
			transport: "stdio" | "http" | "sse";
			command?: string;
			args?: string[];
			url?: string;
			envVars?: Record<string, string>;
		};

		const db = getDb();
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		db.insert(schema.tools)
			.values({
				id,
				name: input.name,
				description: input.description ?? null,
				transport: input.transport,
				command: input.command ?? null,
				args: input.args ? JSON.stringify(input.args) : null,
				url: input.url ?? null,
				envVars: input.envVars ? JSON.stringify(input.envVars) : null,
				isBuiltin: false,
				isGlobal: false,
				healthStatus: "unknown",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		return db.select().from(schema.tools).where(eq(schema.tools.id, id)).get();
	});

	ipcMain.handle("tools:remove", (_e, id: string) => {
		const db = getDb();
		const tool = db
			.select()
			.from(schema.tools)
			.where(eq(schema.tools.id, id))
			.get();
		if (!tool) throw new Error(`Tool not found: ${id}`);
		if (tool.isBuiltin) throw new Error("Cannot remove built-in tools");
		db.delete(schema.tools).where(eq(schema.tools.id, id)).run();
	});

	ipcMain.handle("tools:check-health", async (_e, id: string) => {
		const db = getDb();
		const tool = db
			.select()
			.from(schema.tools)
			.where(eq(schema.tools.id, id))
			.get();
		if (!tool) throw new Error(`Tool not found: ${id}`);

		let status = "unknown";

		try {
			if (tool.transport === "http" || tool.transport === "sse") {
				// HTTP ping
				if (tool.url) {
					const res = await fetch(tool.url, {
						method: "GET",
						signal: AbortSignal.timeout(5000),
					});
					status = res.ok || res.status < 500 ? "healthy" : "error";
				}
			} else if (tool.transport === "stdio") {
				// Stdio: check if the command binary exists via which
				const { exec } = await import("node:child_process");
				const cmd = tool.command?.split(" ")[0] ?? "";
				status = await new Promise<string>((resolve) => {
					exec(
						`which ${cmd} 2>/dev/null || command -v ${cmd} 2>/dev/null`,
						(err) => {
							resolve(err ? "error" : "healthy");
						},
					);
				});
			}
		} catch {
			status = "error";
		}

		const healthStatus = status === "healthy" ? "healthy" : "error";
		db.update(schema.tools)
			.set({
				healthStatus: healthStatus as "unknown" | "healthy" | "error",
				lastHealthCheck: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(schema.tools.id, id))
			.run();

		return { status };
	});
}
