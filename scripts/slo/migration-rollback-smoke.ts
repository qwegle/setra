import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	closeDb,
	getDb,
	getRawDb,
	runMigrations,
} from "../../packages/db/src/client.ts";

async function main() {
	const root = process.cwd();
	const workDir = mkdtempSync(path.join(tmpdir(), "setra-migration-smoke-"));
	const dbPath = path.join(workDir, "setra.db");
	const backupPath = path.join(workDir, "setra.backup.db");
	const migrationsDir = path.join(root, "packages", "db", "migrations");

	try {
		getDb({ dbPath, verbose: false });
		await runMigrations(migrationsDir);
		const raw = getRawDb();

		raw.exec(`
      CREATE TABLE IF NOT EXISTS __rollback_probe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        marker TEXT NOT NULL
      );
    `);
		raw
			.prepare("INSERT INTO __rollback_probe (marker) VALUES (?)")
			.run("baseline");

		closeDb();
		copyFileSync(dbPath, backupPath);

		getDb({ dbPath, verbose: false });
		const raw2 = getRawDb();
		raw2
			.prepare("INSERT INTO __rollback_probe (marker) VALUES (?)")
			.run("dirty-after-backup");
		closeDb();

		copyFileSync(backupPath, dbPath);

		getDb({ dbPath, verbose: false });
		const raw3 = getRawDb();
		const migrationCount = raw3
			.prepare("SELECT COUNT(*) AS c FROM __drizzle_migrations")
			.get() as { c: number };
		const probeCount = raw3
			.prepare("SELECT COUNT(*) AS c FROM __rollback_probe")
			.get() as { c: number };

		if (migrationCount.c <= 0) {
			throw new Error("No migrations found after restore");
		}
		if (probeCount.c !== 1) {
			throw new Error(
				`Rollback restore failed: expected probe row count 1, got ${probeCount.c}`,
			);
		}

		console.log("migration-rollback-smoke: PASS");
	} finally {
		try {
			closeDb();
		} catch {
			/* noop */
		}
		rmSync(workDir, { recursive: true, force: true });
	}
}

void main().catch((err) => {
	console.error("migration-rollback-smoke: FAIL");
	console.error(err);
	process.exit(1);
});
