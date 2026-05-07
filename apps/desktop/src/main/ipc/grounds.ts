import * as net from "node:net";
import {
	DbGroundExecutor,
	resolveDbGroundConfig,
} from "@setra/agent-runner/tools/db-executor";
import type { DbDriver } from "@setra/agent-runner/tools/db-executor";
import { getDb, schema } from "@setra/db";
import { CreateGroundSchema, UpdateGroundSchema } from "@setra/types";
import { eq } from "drizzle-orm";
import { ipcMain } from "electron";

export function registerGroundsHandlers(): void {
	ipcMain.handle("grounds:list", () => {
		return getDb().select().from(schema.grounds).all();
	});

	ipcMain.handle("grounds:create", (_e, rawInput: unknown) => {
		const input = CreateGroundSchema.parse(rawInput);
		const db = getDb();
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		db.insert(schema.grounds)
			.values({
				id,
				name: input.name,
				host: input.host,
				port: input.port ?? 22,
				username: input.username,
				authType: input.authType,
				keyPath: input.keyPath ?? null,
				tmuxPrefix: input.tmuxPrefix ?? "setra",
				notes: input.notes ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		return db
			.select()
			.from(schema.grounds)
			.where(eq(schema.grounds.id, id))
			.get();
	});

	ipcMain.handle("grounds:update", (_e, rawInput: unknown) => {
		const { id, ...rest } = rawInput as { id: string } & Record<
			string,
			unknown
		>;
		const input = UpdateGroundSchema.parse(rest);
		const db = getDb();
		const now = new Date().toISOString();

		const updates: Partial<typeof schema.grounds.$inferInsert> = {
			updatedAt: now,
		};
		if (input.name !== undefined) updates.name = input.name;
		if (input.host !== undefined) updates.host = input.host;
		if (input.port !== undefined) updates.port = input.port;
		if (input.username !== undefined) updates.username = input.username;
		if (input.authType !== undefined) updates.authType = input.authType;
		if (input.keyPath !== undefined) updates.keyPath = input.keyPath ?? null;
		if (input.notes !== undefined) updates.notes = input.notes ?? null;

		db.update(schema.grounds)
			.set(updates)
			.where(eq(schema.grounds.id, id))
			.run();
		return db
			.select()
			.from(schema.grounds)
			.where(eq(schema.grounds.id, id))
			.get();
	});

	ipcMain.handle("grounds:delete", (_e, id: string) => {
		getDb().delete(schema.grounds).where(eq(schema.grounds.id, id)).run();
	});

	ipcMain.handle("grounds:ping", async (_e, id: string) => {
		const db = getDb();
		const ground = db
			.select()
			.from(schema.grounds)
			.where(eq(schema.grounds.id, id))
			.get();
		if (!ground) throw new Error(`Ground not found: ${id}`);

		const start = Date.now();
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection({
				host: ground.host,
				port: ground.port,
			});
			socket.once("connect", () => {
				socket.destroy();
				resolve();
			});
			socket.once("error", (err) => {
				socket.destroy();
				reject(err);
			});
			socket.setTimeout(5000, () => {
				socket.destroy();
				reject(new Error("Connection timed out"));
			});
		});
		const latencyMs = Date.now() - start;

		db.update(schema.grounds)
			.set({
				status: "connected",
				lastPingAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			})
			.where(eq(schema.grounds.id, id))
			.run();

		return { latencyMs };
	});

	// ── DB Ground handlers ─────────────────────────────────────────────────────

	ipcMain.handle("grounds:create-db", (_e, rawInput: unknown) => {
		const input = rawInput as {
			name: string;
			driver: DbDriver;
			host: string;
			port: number;
			database: string;
			user: string;
			passwordEnv: string;
			ssl: boolean;
			allowWrite: boolean;
			connectionStringEnv?: string;
		};
		const db = getDb();
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		db.insert(schema.grounds)
			.values({
				id,
				name: input.name,
				host: input.host,
				port: input.port,
				username: input.user,
				authType: "agent" as const,
				groundType: "database",
				dbDriver: input.driver,
				dbHost: input.host,
				dbPort: input.port,
				dbName: input.database,
				dbUser: input.user,
				dbPasswordEnv: input.passwordEnv,
				dbSsl: input.ssl ? 1 : 0,
				dbAllowWrite: input.allowWrite ? 1 : 0,
				dbConnectionStringEnv: input.connectionStringEnv ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		return db
			.select()
			.from(schema.grounds)
			.where(eq(schema.grounds.id, id))
			.get();
	});

	ipcMain.handle(
		"grounds:test-db-connection",
		async (_e, rawInput: unknown) => {
			const input = rawInput as {
				driver: DbDriver;
				host: string;
				port: number;
				database: string;
				user: string;
				passwordEnv?: string;
				ssl: boolean;
				allowWrite: boolean;
				connectionStringEnv?: string;
			};

			try {
				const config = resolveDbGroundConfig({
					driver: input.driver,
					host: input.host,
					port: input.port,
					database: input.database,
					user: input.user,
					...(input.passwordEnv !== undefined
						? { passwordEnvVar: input.passwordEnv }
						: {}),
					ssl: input.ssl,
					allowWrite: input.allowWrite,
					...(input.connectionStringEnv !== undefined
						? { connectionStringEnvVar: input.connectionStringEnv }
						: {}),
				});
				const executor = new DbGroundExecutor(config);
				await executor.connect();
				const schemaResult = await executor.getSchema();
				await executor.disconnect();
				return { ok: true, tablesFound: schemaResult.tables.length };
			} catch (err: unknown) {
				return { ok: false, error: (err as Error).message };
			}
		},
	);

	ipcMain.handle("grounds:get-schema", async (_e, id: string) => {
		const db = getDb();
		const ground = db
			.select()
			.from(schema.grounds)
			.where(eq(schema.grounds.id, id))
			.get();
		if (!ground) throw new Error(`Ground not found: ${id}`);
		if (ground.groundType !== "database")
			throw new Error("Not a database ground");

		const config = resolveDbGroundConfig({
			driver: ground.dbDriver as DbDriver,
			host: ground.dbHost!,
			port: ground.dbPort!,
			database: ground.dbName!,
			user: ground.dbUser!,
			...(ground.dbPasswordEnv != null
				? { passwordEnvVar: ground.dbPasswordEnv }
				: {}),
			ssl: !!ground.dbSsl,
			allowWrite: !!ground.dbAllowWrite,
			...(ground.dbConnectionStringEnv != null
				? { connectionStringEnvVar: ground.dbConnectionStringEnv }
				: {}),
		});

		const executor = new DbGroundExecutor(config);
		try {
			await executor.connect();
			const schemaResult = await executor.getSchema();
			// cache schema in DB
			db.update(schema.grounds)
				.set({
					dbSchemaCache: JSON.stringify(schemaResult),
					dbLastConnectedAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})
				.where(eq(schema.grounds.id, id))
				.run();
			return schemaResult;
		} finally {
			await executor.disconnect();
		}
	});

	ipcMain.handle(
		"grounds:run-query",
		async (_e, input: { id: string; sql: string; limit?: number }) => {
			const db = getDb();
			const ground = db
				.select()
				.from(schema.grounds)
				.where(eq(schema.grounds.id, input.id))
				.get();
			if (!ground) throw new Error(`Ground not found: ${input.id}`);
			if (ground.groundType !== "database")
				throw new Error("Not a database ground");

			const config = resolveDbGroundConfig({
				driver: ground.dbDriver as DbDriver,
				host: ground.dbHost!,
				port: ground.dbPort!,
				database: ground.dbName!,
				user: ground.dbUser!,
				...(ground.dbPasswordEnv != null
					? { passwordEnvVar: ground.dbPasswordEnv }
					: {}),
				ssl: !!ground.dbSsl,
				allowWrite: !!ground.dbAllowWrite,
				...(ground.dbConnectionStringEnv != null
					? { connectionStringEnvVar: ground.dbConnectionStringEnv }
					: {}),
			});

			const executor = new DbGroundExecutor(config);
			try {
				await executor.connect();
				return await executor.query(input.sql, input.limit ?? 100);
			} finally {
				await executor.disconnect();
			}
		},
	);
}
