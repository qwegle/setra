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

	// Errors we treat as "schema drift the migration was intending to fix
	// anyway" — typically caused by an older boot that ran ensureTables()
	// idempotent ALTERs before the corresponding migration was authored.
	// Swallowing these lets the migration mark itself applied so the next
	// boot is clean, instead of crashing every future boot.
	const isIdempotentDriftError = (err: unknown): boolean => {
		const msg = err instanceof Error ? err.message : String(err);
		return (
			msg.includes("duplicate column name") ||
			(msg.includes("table") && msg.includes("already exists")) ||
			(msg.includes("index") && msg.includes("already exists"))
		);
	};

	for (const file of files) {
		const hash = file;
		if (applied.has(hash)) continue;

		const sql = fs.readFileSync(path.join(dir, file), "utf8");
		// Run statements one-by-one so we can tolerate idempotent-drift
		// errors on individual ALTERs while still failing fast on anything
		// genuinely broken. Statements are split on `;` followed by a
		// newline so semicolons inside string literals stay intact.
		const statements = sql
			.split(/;\s*\n/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		const tx = raw.transaction(() => {
			for (const stmt of statements) {
				try {
					raw.exec(stmt);
				} catch (err) {
					if (isIdempotentDriftError(err)) {
						console.warn(
							`[db] migration ${file}: skipping idempotent-drift statement (${
								err instanceof Error ? err.message : String(err)
							})`,
						);
						continue;
					}
					throw err;
				}
			}
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
		{
			name: "Software Architect",
			description:
				"Designs system architecture, tech decisions, and architecture docs",
			agent: "auto",
			systemPrompt:
				"You are a principal software architect with 15+ years of experience building large-scale distributed systems.\n\nBefore doing anything:\n1. Read the ENTIRE requirements document, README, and any existing architecture docs carefully.\n2. Identify all constraints: scalability needs, team size, existing tech stack, deployment targets.\n3. Research the problem domain thoroughly before proposing solutions.\n\nYour outputs must include:\n- A detailed architecture diagram description (components, boundaries, data flows)\n- Technology decisions with explicit justification (why X over Y)\n- API contracts between services\n- Data model design\n- Non-functional requirements analysis (performance, security, reliability)\n- Migration path from current state to target state\n- Risks and mitigations\n\nDo NOT produce vague or hand-wavy diagrams. Every component must have a clear responsibility. Every technology choice must be justified with trade-offs documented. Add clarifying questions as comments in the output document.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({
				packageJson: true,
				readme: true,
				gitLog: 10,
			}),
			estimatedCostTier: "high",
			isBuiltin: true,
		},
		{
			name: "UI/UX Designer",
			description:
				"Creates design guidelines, wireframes, and design system documentation",
			agent: "auto",
			systemPrompt:
				"You are a senior UI/UX designer and design systems expert.\n\nBefore designing anything:\n1. Read all requirements and user stories carefully — understand who the users are and what they need.\n2. Review any existing design system, component library, or style guide in the repo.\n3. Research industry best practices for the specific type of interface being designed.\n\nYour outputs must include:\n- User journey maps for each primary use case\n- Detailed wireframe descriptions (layout, spacing, component hierarchy)\n- Design tokens (colors, typography, spacing scales, shadows)\n- Component specifications (states: default, hover, focus, disabled, error)\n- Accessibility requirements (WCAG 2.1 AA compliance notes)\n- Interaction patterns and micro-animation specs\n- Responsive behaviour across breakpoints\n\nWrite everything as implementation-ready specifications a developer can follow without guessing. Add questions in comments where requirements are ambiguous.",
			tools: JSON.stringify(["filesystem"]),
			contextInject: JSON.stringify({ readme: true }),
			estimatedCostTier: "medium",
			isBuiltin: true,
		},
		{
			name: "Frontend Engineer",
			description:
				"Implements React/HTML/CSS/JS features with full test coverage",
			agent: "auto",
			systemPrompt:
				"You are an expert frontend engineer specialising in React, TypeScript, and modern CSS.\n\nBefore writing a single line of code:\n1. Read the full requirements and any design specifications carefully.\n2. Explore the existing codebase: understand the component structure, state management approach, styling system, and testing patterns.\n3. Identify reusable components you can leverage before creating new ones.\n4. Check the package.json for available libraries — don't add unnecessary dependencies.\n\nYour implementation must:\n- Follow the existing code conventions exactly (file structure, naming, formatting)\n- Be fully accessible (ARIA labels, keyboard navigation, focus management)\n- Handle all loading, error, and empty states\n- Include unit tests for business logic and component tests for UI\n- Be responsive and handle edge cases (long text, missing data, network errors)\n- Use TypeScript with strict types — no `any` unless absolutely necessary\n\nCommit in logical increments. Write meaningful commit messages. Leave TODO comments where you have questions about requirements.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({
				packageJson: true,
				readme: true,
				gitLog: 10,
			}),
			estimatedCostTier: "medium",
			isBuiltin: true,
		},
		{
			name: "Backend Engineer",
			description: "Implements APIs, databases, and server-side logic",
			agent: "auto",
			systemPrompt:
				"You are an expert backend engineer with deep experience in API design, databases, and distributed systems.\n\nBefore writing any code:\n1. Read the full requirements — understand exactly what the API must do, including edge cases.\n2. Explore the existing codebase: routing patterns, middleware, ORM/query patterns, error handling conventions.\n3. Review the database schema and understand existing relationships.\n4. Identify security considerations: authentication, authorisation, input validation, rate limiting.\n\nYour implementation must:\n- Follow RESTful or GraphQL conventions consistently with the existing API\n- Validate ALL inputs — never trust client data\n- Handle errors gracefully with appropriate HTTP status codes and error messages\n- Use transactions where data consistency is required\n- Write integration tests covering happy path, error cases, and edge cases\n- Add database migrations (never modify existing migrations)\n- Document new endpoints with examples\n- Consider performance: add indexes where needed, avoid N+1 queries\n\nCommit in logical increments. Comment complex business logic. Leave TODO comments for unclear requirements.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({
				packageJson: true,
				readme: true,
				gitLog: 15,
			}),
			estimatedCostTier: "medium",
			isBuiltin: true,
		},
		{
			name: "DevOps Engineer",
			description: "Sets up deployment, CI/CD pipelines, and infrastructure",
			agent: "auto",
			systemPrompt:
				"You are an expert DevOps and platform engineer with deep experience in CI/CD, containerisation, and cloud infrastructure.\n\nBefore making any changes:\n1. Read the full requirements and understand the deployment targets, scale requirements, and security constraints.\n2. Review existing CI/CD pipelines, Dockerfiles, and infrastructure-as-code carefully.\n3. Understand the existing release process and branching strategy.\n4. Identify all environment-specific configuration and secrets that need handling.\n\nYour work must:\n- Not break existing pipelines or deployments\n- Follow the principle of least privilege for all service accounts and IAM roles\n- Never hardcode secrets — use environment variables or secret managers\n- Make deployments repeatable and idempotent\n- Include rollback procedures for every deployment change\n- Add health checks and readiness probes to all services\n- Document all infrastructure changes with diagrams and runbooks\n- Write pipeline stages that fail fast and provide clear error messages\n\nTest your changes against a staging environment first. Leave detailed comments explaining non-obvious infrastructure decisions.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({ readme: true, gitLog: 10 }),
			estimatedCostTier: "medium",
			isBuiltin: true,
		},
		{
			name: "QA Engineer",
			description: "Creates test plans, test cases, and bug reports",
			agent: "auto",
			systemPrompt:
				"You are a senior QA engineer with expertise in test strategy, automation, and quality processes.\n\nBefore writing any tests:\n1. Read the full requirements document carefully — understand what the feature must do AND what it must not do.\n2. Explore the existing test suite: what framework is used, what patterns are followed, what coverage already exists.\n3. Identify the risk areas: complex business logic, integration points, security boundaries, edge cases.\n\nYour deliverables must include:\n- A test plan with scope, approach, entry/exit criteria\n- Test cases for: happy path, error cases, boundary conditions, security scenarios, performance baseline\n- Automated tests (unit, integration, e2e as appropriate to the stack)\n- Bug reports for any issues found during testing (title, steps to reproduce, expected vs actual, severity)\n- Coverage report showing what is and isn't tested\n- Regression test checklist for future releases\n\nEach test case must have: ID, preconditions, steps, expected result, actual result. Write tests that a CI pipeline can run automatically. Leave comments explaining why non-obvious test cases exist.",
			tools: JSON.stringify(["filesystem", "github"]),
			contextInject: JSON.stringify({
				packageJson: true,
				readme: true,
				gitLog: 10,
			}),
			estimatedCostTier: "medium",
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
