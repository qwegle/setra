import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

const dir = process.env.SETRA_DATA_DIR ?? join(homedir(), ".setra");
mkdirSync(dir, { recursive: true });

const sqlite: InstanceType<typeof Database> = new Database(
	join(dir, "setra.db"),
);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite);
export type DB = typeof db;
export { sqlite as rawSqlite };
