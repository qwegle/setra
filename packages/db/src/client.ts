import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index.js";

export type { Database as BetterSQLite3Database };

// Resolve the native addon correctly whether inside ASAR or unpacked
const require = createRequire(import.meta.url);

export interface DbClientOptions {
	/** Absolute path to the SQLite file. Defaults to ~/.setra/setra.db */
	dbPath?: string;
	/** Enable verbose SQL logging (development only) */
	verbose?: boolean;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _raw: InstanceType<typeof Database> | null = null;

/**
 * Returns the singleton Drizzle ORM client backed by better-sqlite3.
 * Call once at app startup with options; subsequent calls return the cached instance.
 */
export function getDb(options: DbClientOptions = {}) {
	if (_db) return _db;

	const dbPath = options.dbPath ?? resolveDefaultDbPath();

	const sqlite = new Database(dbPath, {
		verbose: options.verbose ? (msg) => console.debug("[db]", msg) : undefined,
	});

	applyPragmas(sqlite);
	registerCustomFunctions(sqlite);

	_raw = sqlite;
	_db = drizzle(sqlite, { schema });

	return _db;
}

/** Direct access to the underlying better-sqlite3 instance (for migrations, etc.) */
export function getRawDb(): InstanceType<typeof Database> {
	if (!_raw) throw new Error("DB not initialised — call getDb() first");
	return _raw;
}

/** Close the database connection. Call on app quit. */
export function closeDb(): void {
	if (_raw) {
		_raw.close();
		_raw = null;
		_db = null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Pragmas — applied once at connection open
// ─────────────────────────────────────────────────────────────────────────────

function applyPragmas(db: InstanceType<typeof Database>): void {
	// WAL mode: safe for concurrent readers, faster writes
	db.pragma("journal_mode = WAL");
	// Enforce FK constraints — SQLite doesn't enforce them by default
	db.pragma("foreign_keys = ON");
	// Normal sync is safe with WAL and faster than FULL
	db.pragma("synchronous = NORMAL");
	// 64MB page cache
	db.pragma("cache_size = -65536");
	// Enable memory-mapped I/O for large reads (128MB)
	db.pragma("mmap_size = 134217728");
	// Auto-vacuum in incremental mode
	db.pragma("auto_vacuum = INCREMENTAL");
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom SQL functions
// ─────────────────────────────────────────────────────────────────────────────

function registerCustomFunctions(db: InstanceType<typeof Database>): void {
	// uuid_v4() — generate a random UUID in SQL expressions
	db.function("uuid_v4", () => crypto.randomUUID());
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration runner — runs all pending SQL migration files in order
// ─────────────────────────────────────────────────────────────────────────────

export async function runMigrations(migrationsDir?: string): Promise<void> {
	const raw = getRawDb();
	const fs = await import("node:fs");
	const dir = migrationsDir ?? resolveDefaultMigrationsPath();

	// Bootstrap the drizzle bookkeeping table so we can record which files ran.
	raw.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

	const applied = new Set<string>(
		(
			raw.prepare("SELECT hash FROM __drizzle_migrations").all() as {
				hash: string;
			}[]
		).map((r) => r.hash),
	);

	const files = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

	for (const file of files) {
		const hash = file;
		if (applied.has(hash)) continue;

		const sql = fs.readFileSync(path.join(dir, file), "utf8");
		// better-sqlite3's .exec() handles multiple statements separated by `;`,
		// unlike drizzle's migrator which requires `--> statement-breakpoint`
		// markers and breaks on multi-statement files without them.
		const tx = raw.transaction(() => {
			raw.exec(sql);
			raw
				.prepare(
					"INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
				)
				.run(hash, Date.now());
		});
		try {
			tx();
			console.log(`[db] migration applied: ${file}`);
		} catch (err) {
			console.error(`[db] migration failed: ${file}`, err);
			throw err;
		}
	}

	console.log("[db] migrations applied");
}

// ─────────────────────────────────────────────────────────────────────────────
// Default path helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveDefaultDbPath(): string {
	const { homedir } = require("node:os") as typeof import("node:os");
	return path.join(homedir(), ".setra", "setra.db");
}

function resolveDefaultMigrationsPath(): string {
	// When bundled by electron-vite, __dirname and import.meta.url may point to
	// the bundle output dir. We try multiple candidate paths in order.
	const candidates = [
		// electron-vite dev: process.cwd() is the monorepo root
		path.join(process.cwd(), "packages", "db", "migrations"),
		// electron-vite dev when cwd is apps/desktop
		path.join(process.cwd(), "..", "..", "packages", "db", "migrations"),
		// Packaged app / tsup build output: migrations alongside dist/
		path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations"),
		// Original: relative to this file via import.meta.url
		path.join(
			path.dirname(new URL(import.meta.url).pathname),
			"..",
			"migrations",
		),
	];
	for (const c of candidates) {
		try {
			const { existsSync } = require("node:fs") as typeof import("node:fs");
			if (existsSync(path.join(c, "meta", "_journal.json"))) return c;
		} catch {}
	}
	return candidates[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed built-in data — idempotent, safe to call on every start
// ─────────────────────────────────────────────────────────────────────────────

export function seedBuiltins(): void {
	const db = getDb();

	// Insert setra-core MCP tool if not present
	db.insert(schema.tools)
		.values({
			id: "setra-core",
			name: "setra-core",
			description:
				"Built-in setra MCP server: memory_search, git_context, workspace_info, session_cost",
			transport: "stdio",
			command: "setra-mcp",
			args: "[]",
			isBuiltin: true,
			isGlobal: true,
		})
		.onConflictDoNothing()
		.run();

	// Default app settings
	const defaults: Array<[string, string]> = [
		["default_agent", "auto"],
		["theme", "dark"],
		["telemetry_enabled", "false"],
		["memory_enabled", "true"],
		["team_mode_enabled", "false"],
		["default_checkpoint_interval_s", "300"],
		["terminal_font_family", "Monaspace Neon, Geist Mono, monospace"],
		["terminal_font_size", "14"],
	];

	for (const [key, value] of defaults) {
		db.insert(schema.appSettings)
			.values({ key, value })
			.onConflictDoNothing()
			.run();
	}

	// Built-in agent templates
	const builtinTemplates: Array<typeof schema.agentTemplates.$inferInsert> = [
		{
			name: "Feature Builder",
			description: "Builds new features end-to-end with tests",
			agent: "auto",
			systemPrompt:
				"You are an expert software engineer. Build the requested feature completely, including tests. Commit your work in logical increments. Do not ask for permission to write code.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({
				packageJson: true,
				readme: true,
				gitLog: 20,
			}),
			estimatedCostTier: "medium",
			isBuiltin: true,
		},
		{
			name: "Bug Hunter",
			description: "Finds and fixes bugs, adds regression tests",
			agent: "auto",
			systemPrompt:
				"You are an expert debugger. Reproduce the bug, understand the root cause, fix it, and add a regression test. Show your reasoning before changing code.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({
				packageJson: true,
				readme: true,
				gitLog: 10,
			}),
			estimatedCostTier: "low",
			isBuiltin: true,
		},
		{
			name: "Code Reviewer",
			description: "Reviews a diff and leaves structured feedback",
			agent: "auto",
			systemPrompt:
				"You are a senior engineer doing a thorough code review. Focus on correctness, security, and performance. Be direct. Suggest specific improvements, not vague complaints.",
			tools: JSON.stringify(["filesystem"]),
			contextInject: JSON.stringify({ packageJson: true, gitLog: 5 }),
			estimatedCostTier: "low",
			isBuiltin: true,
		},
	];

	for (const template of builtinTemplates) {
		db.insert(schema.agentTemplates)
			.values(template)
			.onConflictDoNothing()
			.run();
	}
}

export { schema };
export type DrizzleDb = ReturnType<typeof getDb>;

// ─── Ticket Analytics ────────────────────────────────────────────────────────

export interface PlotTokenSummary {
	plot_id: string;
	plot_name: string;
	ticket: string | null;
	issue_type: string | null;
	labels: string; // JSON array
	total_cost_usd: number;
	run_count: number;
	total_prompt_tokens: number;
	total_completion_tokens: number;
	total_cache_read_tokens: number;
	total_tokens: number;
	total_cost_usd_runs: number;
	first_run_at: string | null;
	last_run_at: string | null;
	duration_minutes: number | null;
}

export interface IssueTypeAnalytics {
	issue_type: string | null;
	ticket_count: number;
	avg_cost_usd: number;
	avg_tokens: number;
	avg_runs: number;
	avg_duration_min: number;
	total_cost_usd: number;
}

/** Token cost breakdown for a single Jira/GitHub ticket (by external_ref). */
export function getTicketTokenSummary(
	externalRef: string,
): PlotTokenSummary | null {
	const raw = getRawDb();
	return raw
		.prepare(`SELECT * FROM v_plot_token_summary WHERE ticket = ?`)
		.get(externalRef) as PlotTokenSummary | null;
}

/** All tickets, ordered by total token cost descending. */
export function getAllTicketSummaries(limit = 100): PlotTokenSummary[] {
	const raw = getRawDb();
	return raw
		.prepare(
			`SELECT * FROM v_plot_token_summary ORDER BY total_tokens DESC LIMIT ?`,
		)
		.all(limit) as PlotTokenSummary[];
}

/** Analytics grouped by issue_type — answers "which type costs most?". */
export function getIssueTypeAnalytics(): IssueTypeAnalytics[] {
	const raw = getRawDb();
	return raw
		.prepare(`SELECT * FROM v_issue_type_analytics`)
		.all() as IssueTypeAnalytics[];
}

/** Top N most expensive tickets in a project. */
export function getTopCostlyTickets(
	projectId: string,
	limit = 20,
): PlotTokenSummary[] {
	const raw = getRawDb();
	return raw
		.prepare(`
    SELECT s.*
    FROM v_plot_token_summary s
    JOIN plots p ON p.id = s.plot_id
    WHERE p.project_id = ?
    ORDER BY s.total_tokens DESC
    LIMIT ?
  `)
		.all(projectId, limit) as PlotTokenSummary[];
}
