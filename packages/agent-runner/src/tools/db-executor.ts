/**
 * DbGroundExecutor — connects to external databases on behalf of agents.
 *
 * SECURITY rules:
 *  - Passwords are NEVER stored; they are resolved from env vars at runtime.
 *  - Write operations are rejected unless allowWrite=true.
 *  - Connections time out after 2 seconds.
 *
 * DB drivers (pg, mysql2, mssql, mongodb) are optional peer dependencies
 * loaded dynamically at runtime — they are NOT required at build time.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
import { isWriteOperation } from "./db-tools.js";

export type DbDriver = "postgres" | "mysql" | "mssql" | "mongodb";

export interface DbGroundConfig {
	driver: DbDriver;
	host: string;
	port: number;
	database: string;
	user: string;
	/** Resolved from process.env at runtime — NEVER persisted. */
	password: string;
	ssl: boolean;
	allowWrite: boolean;
	/** If set, use this full connection string (from env) instead of host/port/user/pass */
	connectionString?: string | undefined;
}

export interface ColumnInfo {
	column: string;
	type: string;
	nullable: string;
}

export interface TableSchema {
	table: string;
	columns: ColumnInfo[];
}

export interface SchemaResult {
	tables: TableSchema[];
}

export interface QueryResult {
	rows: Record<string, unknown>[];
	rowCount: number;
}

export interface AnalysisResult {
	table: string;
	rowCount: number;
	columns: Array<{
		column: string;
		type: string;
		nullRate: number;
		distinctValues?: unknown[] | undefined;
	}>;
}

export interface WriteResult {
	rowsAffected: number;
}

// ─── internal connection holder ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Type-safe dynamic import helper. Returns Promise<any> so that optional
 * peer dependencies (pg, mysql2, mssql, mongodb) do not need to be present
 * at build time. The `import(expr as string)` cast bypasses module resolution.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dynImport(pkg: string): Promise<any> {
	return import(pkg as string);
}

export class DbGroundExecutor {
	private client: AnyClient = null;

	constructor(private config: DbGroundConfig) {}

	// ── connect ────────────────────────────────────────────────────────────────

	async connect(): Promise<void> {
		const {
			driver,
			host,
			port,
			database,
			user,
			password,
			ssl,
			connectionString,
		} = this.config;

		if (driver === "postgres") {
			const pg = await dynImport("pg").catch(() => {
				throw new Error("pg not installed. Run: npm install pg");
			});
			const { Client } = pg as {
				Client: new (opts: Record<string, unknown>) => AnyClient;
			};
			const client = new Client({
				host,
				port,
				database,
				user,
				password,
				ssl: ssl ? { rejectUnauthorized: false } : false,
				connectionString,
				connectionTimeoutMillis: 2000,
			});
			await client.connect();
			this.client = client;
			return;
		}

		if (driver === "mysql") {
			const mysql = (await dynImport("mysql2/promise").catch(() => {
				throw new Error("mysql2 not installed. Run: npm install mysql2");
			})) as { createConnection: (...args: unknown[]) => Promise<AnyClient> };
			const conn = await Promise.race([
				mysql.createConnection({
					host,
					port,
					database,
					user,
					password,
					ssl: ssl ? {} : undefined,
					uri: connectionString,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Connection timed out (2s)")),
						2000,
					),
				),
			]);
			this.client = conn;
			return;
		}

		if (driver === "mssql") {
			const mssql = (await dynImport("mssql").catch(() => {
				throw new Error("mssql not installed. Run: npm install mssql");
			})) as { connect: (...args: unknown[]) => Promise<AnyClient> };
			const pool = await Promise.race([
				mssql.connect({
					server: host,
					port,
					database,
					user,
					password,
					options: { encrypt: ssl, trustServerCertificate: !ssl },
					connectionTimeout: 2000,
				}),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Connection timed out (2s)")),
						2000,
					),
				),
			]);
			this.client = pool;
			return;
		}

		if (driver === "mongodb") {
			// Dynamic import — mongodb is an optional peer dependency.
			const mongodb = (await dynImport("mongodb").catch(() => {
				throw new Error("mongodb not installed. Run: npm install mongodb");
			})) as {
				MongoClient: new (
					uri: string,
					opts?: Record<string, unknown>,
				) => AnyClient;
			};
			const uri =
				connectionString ??
				`mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?ssl=${ssl ? "true" : "false"}`;
			const mongoClient = new mongodb.MongoClient(uri, {
				serverSelectionTimeoutMS: 2000,
			});
			await mongoClient.connect();
			this.client = mongoClient;
			return;
		}

		throw new Error(`Unsupported driver: ${driver as string}`);
	}

	// ── disconnect ─────────────────────────────────────────────────────────────

	async disconnect(): Promise<void> {
		if (!this.client) return;
		try {
			if (this.config.driver === "postgres") await this.client.end();
			else if (this.config.driver === "mysql") await this.client.end();
			else if (this.config.driver === "mssql") await this.client.close();
			else if (this.config.driver === "mongodb") await this.client.close();
		} finally {
			this.client = null;
		}
	}

	// ── schema introspection ───────────────────────────────────────────────────

	async getSchema(tableFilter?: string): Promise<SchemaResult> {
		this.assertConnected();

		if (this.config.driver === "postgres") {
			const filterClause = tableFilter ? `AND table_name ILIKE $1` : "";
			const params = tableFilter ? [`%${tableFilter}%`] : [];
			const res = await this.client.query(
				`SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' ${filterClause}
         ORDER BY table_name, ordinal_position`,
				params,
			);
			return this.rowsToSchema(
				res.rows,
				"table_name",
				"column_name",
				"data_type",
				"is_nullable",
			);
		}

		if (this.config.driver === "mysql") {
			const filterClause = tableFilter ? `AND TABLE_NAME LIKE ?` : "";
			const params = tableFilter ? [`%${tableFilter}%`] : [];
			const [rows] = await this.client.execute(
				`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() ${filterClause}
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
				params,
			);
			return this.rowsToSchema(
				rows as Record<string, unknown>[],
				"TABLE_NAME",
				"COLUMN_NAME",
				"DATA_TYPE",
				"IS_NULLABLE",
			);
		}

		if (this.config.driver === "mssql") {
			const filterClause = tableFilter ? `AND TABLE_NAME LIKE @filter` : "";
			const req = this.client.request();
			if (tableFilter) req.input("filter", `%${tableFilter}%`);
			const result = await req.query(
				`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE 1=1 ${filterClause}
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
			);
			return this.rowsToSchema(
				result.recordset as Record<string, unknown>[],
				"TABLE_NAME",
				"COLUMN_NAME",
				"DATA_TYPE",
				"IS_NULLABLE",
			);
		}

		if (this.config.driver === "mongodb") {
			const db = this.client.db(this.config.database);
			const collections: string[] = await db
				.listCollections()
				.toArray()
				.then((cols: Array<{ name: string }>) => cols.map((c) => c.name));
			const tables: TableSchema[] = [];
			for (const col of collections) {
				if (
					tableFilter &&
					!col.toLowerCase().includes(tableFilter.toLowerCase())
				)
					continue;
				const sample = await db.collection(col).findOne();
				const columns: ColumnInfo[] = sample
					? Object.keys(sample).map((k) => ({
							column: k,
							type: typeof sample[k],
							nullable: "YES",
						}))
					: [];
				tables.push({ table: col, columns });
			}
			return { tables };
		}

		throw new Error(`Unsupported driver: ${this.config.driver}`);
	}

	// ── query ──────────────────────────────────────────────────────────────────

	async query(sql: string, limit = 100): Promise<QueryResult> {
		this.assertConnected();
		if (!this.config.allowWrite && isWriteOperation(sql)) {
			throw new Error(
				"Write operation rejected: this ground is read-only. Set allowWrite=true to permit writes.",
			);
		}

		const cap = Math.min(limit, 1000);

		if (this.config.driver === "postgres") {
			const res = await this.client.query(
				`SELECT * FROM (${sql}) _q LIMIT ${cap}`,
			);
			return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
		}

		if (this.config.driver === "mysql") {
			const [rows] = await this.client.execute(
				`SELECT * FROM (${sql}) _q LIMIT ${cap}`,
			);
			const arr = rows as Record<string, unknown>[];
			return { rows: arr, rowCount: arr.length };
		}

		if (this.config.driver === "mssql") {
			const result = await this.client
				.request()
				.query(`SELECT TOP ${cap} * FROM (${sql}) _q`);
			return {
				rows: result.recordset as Record<string, unknown>[],
				rowCount: result.rowsAffected[0] ?? result.recordset.length,
			};
		}

		if (this.config.driver === "mongodb") {
			// MongoDB: expect a JSON-like query object string or collection.find() notation
			throw new Error(
				"Use db_sample or db_count for MongoDB. Raw SQL not supported on MongoDB grounds.",
			);
		}

		throw new Error(`Unsupported driver: ${this.config.driver}`);
	}

	// ── sample ─────────────────────────────────────────────────────────────────

	async sample(table: string, limit = 10): Promise<QueryResult> {
		this.assertConnected();
		const cap = Math.min(limit, 1000);

		if (this.config.driver === "postgres") {
			const res = await this.client.query(
				`SELECT * FROM ${this.quoteIdentifier(table)} LIMIT $1`,
				[cap],
			);
			return { rows: res.rows, rowCount: res.rows.length };
		}

		if (this.config.driver === "mysql") {
			const [rows] = await this.client.execute(
				`SELECT * FROM \`${table}\` LIMIT ?`,
				[cap],
			);
			const arr = rows as Record<string, unknown>[];
			return { rows: arr, rowCount: arr.length };
		}

		if (this.config.driver === "mssql") {
			const result = await this.client
				.request()
				.query(`SELECT TOP ${cap} * FROM [${table}]`);
			return {
				rows: result.recordset as Record<string, unknown>[],
				rowCount: result.recordset.length,
			};
		}

		if (this.config.driver === "mongodb") {
			const db = this.client.db(this.config.database);
			const docs = await db.collection(table).find({}).limit(cap).toArray();
			return { rows: docs as Record<string, unknown>[], rowCount: docs.length };
		}

		throw new Error(`Unsupported driver: ${this.config.driver}`);
	}

	// ── count ──────────────────────────────────────────────────────────────────

	async count(table: string, where?: string): Promise<number> {
		this.assertConnected();

		if (this.config.driver === "postgres") {
			const whereClause = where ? `WHERE ${where}` : "";
			const res = await this.client.query(
				`SELECT COUNT(*) AS n FROM ${this.quoteIdentifier(table)} ${whereClause}`,
			);
			return Number(res.rows[0]?.n ?? 0);
		}

		if (this.config.driver === "mysql") {
			const whereClause = where ? `WHERE ${where}` : "";
			const [rows] = await this.client.execute(
				`SELECT COUNT(*) AS n FROM \`${table}\` ${whereClause}`,
			);
			const typedRows = rows as Array<{ n: number }>;
			return Number((typedRows[0] as { n: number } | undefined)?.n ?? 0);
		}

		if (this.config.driver === "mssql") {
			const whereClause = where ? `WHERE ${where}` : "";
			const result = await this.client
				.request()
				.query(`SELECT COUNT(*) AS n FROM [${table}] ${whereClause}`);
			return Number(result.recordset[0]?.n ?? 0);
		}

		if (this.config.driver === "mongodb") {
			const db = this.client.db(this.config.database);
			return await db.collection(table).countDocuments();
		}

		throw new Error(`Unsupported driver: ${this.config.driver}`);
	}

	// ── analyze ────────────────────────────────────────────────────────────────

	async analyze(table: string): Promise<AnalysisResult> {
		this.assertConnected();
		const schema = await this.getSchema(table);
		const tableSchema = schema.tables.find((t) => t.table === table);
		const rowCount = await this.count(table);

		if (!tableSchema) {
			return { table, rowCount, columns: [] };
		}

		const columns = await Promise.all(
			tableSchema.columns.map(async (col) => {
				let nullRate = 0;
				let distinctValues: unknown[] | undefined = undefined;

				try {
					if (this.config.driver === "mongodb") {
						return { column: col.column, type: col.type, nullRate: 0 };
					}

					// null rate
					if (rowCount > 0) {
						const nullCount = await this.countNulls(table, col.column);
						nullRate = nullCount / rowCount;
					}

					// distinct values for low-cardinality columns (only when distinct <= 20)
					const distinct = await this.countDistinct(table, col.column);
					if (distinct > 0 && distinct <= 20) {
						distinctValues = await this.getDistinctValues(table, col.column);
					}
				} catch {
					// Non-fatal — skip stats for this column
				}

				const entry: {
					column: string;
					type: string;
					nullRate: number;
					distinctValues?: unknown[] | undefined;
				} = {
					column: col.column,
					type: col.type,
					nullRate,
				};
				if (distinctValues !== undefined) {
					entry.distinctValues = distinctValues;
				}
				return entry;
			}),
		);

		return { table, rowCount, columns };
	}

	// ── write ──────────────────────────────────────────────────────────────────

	async write(sql: string): Promise<WriteResult> {
		if (!this.config.allowWrite) {
			throw new Error(
				"Write operations are not allowed on this ground. Set allowWrite=true when configuring the DB ground.",
			);
		}
		this.assertConnected();

		if (this.config.driver === "postgres") {
			const res = await this.client.query(sql);
			return { rowsAffected: res.rowCount ?? 0 };
		}

		if (this.config.driver === "mysql") {
			const [result] = await this.client.execute(sql);
			return {
				rowsAffected: (result as { affectedRows?: number }).affectedRows ?? 0,
			};
		}

		if (this.config.driver === "mssql") {
			const result = await this.client.request().query(sql);
			return { rowsAffected: result.rowsAffected[0] ?? 0 };
		}

		if (this.config.driver === "mongodb") {
			throw new Error(
				"Use the MongoDB driver API directly for write operations on MongoDB grounds.",
			);
		}

		throw new Error(`Unsupported driver: ${this.config.driver}`);
	}

	// ── executeTool (MCP dispatch) ─────────────────────────────────────────────

	async executeTool(
		name: string,
		input: Record<string, unknown>,
	): Promise<string> {
		switch (name) {
			case "db_schema": {
				const result = await this.getSchema(
					input["table_filter"] as string | undefined,
				);
				return JSON.stringify(result, null, 2);
			}

			case "db_query": {
				if (!input["sql"] || typeof input["sql"] !== "string") {
					throw new Error("db_query requires 'sql' parameter");
				}
				const result = await this.query(
					input["sql"],
					(input["limit"] as number | undefined) ?? 100,
				);
				return JSON.stringify(result, null, 2);
			}

			case "db_sample": {
				if (!input["table"] || typeof input["table"] !== "string") {
					throw new Error("db_sample requires 'table' parameter");
				}
				const result = await this.sample(
					input["table"],
					(input["limit"] as number | undefined) ?? 10,
				);
				return JSON.stringify(result, null, 2);
			}

			case "db_count": {
				if (!input["table"] || typeof input["table"] !== "string") {
					throw new Error("db_count requires 'table' parameter");
				}
				const n = await this.count(
					input["table"],
					input["where"] as string | undefined,
				);
				return JSON.stringify({ count: n });
			}

			case "db_analyze": {
				if (!input["table"] || typeof input["table"] !== "string") {
					throw new Error("db_analyze requires 'table' parameter");
				}
				const result = await this.analyze(input["table"]);
				return JSON.stringify(result, null, 2);
			}

			case "db_write": {
				if (!input["sql"] || typeof input["sql"] !== "string") {
					throw new Error("db_write requires 'sql' parameter");
				}
				if (input["confirm"] !== true) {
					throw new Error("db_write requires confirm=true to execute");
				}
				const result = await this.write(input["sql"]);
				return JSON.stringify(result);
			}

			default:
				throw new Error(`Unknown DB tool: ${name}`);
		}
	}

	// ── private helpers ────────────────────────────────────────────────────────

	private assertConnected(): void {
		if (!this.client) {
			throw new Error("Not connected. Call connect() first.");
		}
	}

	private quoteIdentifier(name: string): string {
		return `"${name.replace(/"/g, '""')}"`;
	}

	private rowsToSchema(
		rows: Record<string, unknown>[],
		tableKey: string,
		columnKey: string,
		typeKey: string,
		nullableKey: string,
	): SchemaResult {
		const tableMap = new Map<string, ColumnInfo[]>();
		for (const row of rows) {
			const table = String(row[tableKey]);
			if (!tableMap.has(table)) tableMap.set(table, []);
			tableMap.get(table)!.push({
				column: String(row[columnKey]),
				type: String(row[typeKey]),
				nullable: String(row[nullableKey]),
			});
		}
		return {
			tables: Array.from(tableMap.entries()).map(([table, columns]) => ({
				table,
				columns,
			})),
		};
	}

	private async countNulls(table: string, column: string): Promise<number> {
		if (this.config.driver === "postgres") {
			const res = await this.client.query(
				`SELECT COUNT(*) AS n FROM ${this.quoteIdentifier(table)} WHERE ${this.quoteIdentifier(column)} IS NULL`,
			);
			return Number(res.rows[0]?.n ?? 0);
		}
		if (this.config.driver === "mysql") {
			const [rows] = await this.client.execute(
				`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` IS NULL`,
			);
			const typedRows = rows as Array<{ n: number }>;
			return Number((typedRows[0] as { n: number } | undefined)?.n ?? 0);
		}
		if (this.config.driver === "mssql") {
			const result = await this.client
				.request()
				.query(
					`SELECT COUNT(*) AS n FROM [${table}] WHERE [${column}] IS NULL`,
				);
			return Number(result.recordset[0]?.n ?? 0);
		}
		return 0;
	}

	private async countDistinct(table: string, column: string): Promise<number> {
		if (this.config.driver === "postgres") {
			const res = await this.client.query(
				`SELECT COUNT(DISTINCT ${this.quoteIdentifier(column)}) AS n FROM ${this.quoteIdentifier(table)}`,
			);
			return Number(res.rows[0]?.n ?? 0);
		}
		if (this.config.driver === "mysql") {
			const [rows] = await this.client.execute(
				`SELECT COUNT(DISTINCT \`${column}\`) AS n FROM \`${table}\``,
			);
			const typedRows = rows as Array<{ n: number }>;
			return Number((typedRows[0] as { n: number } | undefined)?.n ?? 0);
		}
		if (this.config.driver === "mssql") {
			const result = await this.client
				.request()
				.query(`SELECT COUNT(DISTINCT [${column}]) AS n FROM [${table}]`);
			return Number(result.recordset[0]?.n ?? 0);
		}
		return 0;
	}

	private async getDistinctValues(
		table: string,
		column: string,
	): Promise<unknown[]> {
		if (this.config.driver === "postgres") {
			const res = await this.client.query(
				`SELECT DISTINCT ${this.quoteIdentifier(column)} AS v FROM ${this.quoteIdentifier(table)} ORDER BY 1 LIMIT 20`,
			);
			return res.rows.map((r: Record<string, unknown>) => r["v"]);
		}
		if (this.config.driver === "mysql") {
			const [rows] = await this.client.execute(
				`SELECT DISTINCT \`${column}\` AS v FROM \`${table}\` ORDER BY 1 LIMIT 20`,
			);
			return (rows as Array<{ v: unknown }>).map((r) => r.v);
		}
		if (this.config.driver === "mssql") {
			const result = await this.client
				.request()
				.query(
					`SELECT DISTINCT TOP 20 [${column}] AS v FROM [${table}] ORDER BY 1`,
				);
			return result.recordset.map((r: { v: unknown }) => r.v);
		}
		return [];
	}
}

/**
 * Build a DbGroundConfig, resolving the password from env at call time.
 * Throws if the required env var is not set.
 */
export function resolveDbGroundConfig(opts: {
	driver: DbDriver;
	host: string;
	port: number;
	database: string;
	user: string;
	passwordEnvVar?: string;
	ssl: boolean;
	allowWrite: boolean;
	connectionStringEnvVar?: string;
}): DbGroundConfig {
	let password = "";
	let connectionString: string | undefined;

	if (opts.connectionStringEnvVar) {
		connectionString = process.env[opts.connectionStringEnvVar];
		if (!connectionString) {
			throw new Error(
				`DB connection string env var not set: ${opts.connectionStringEnvVar}`,
			);
		}
	} else if (opts.passwordEnvVar) {
		password = process.env[opts.passwordEnvVar] ?? "";
		if (!password) {
			throw new Error(`DB password env var not set: ${opts.passwordEnvVar}`);
		}
	}

	const base = {
		driver: opts.driver,
		host: opts.host,
		port: opts.port,
		database: opts.database,
		user: opts.user,
		password,
		ssl: opts.ssl,
		allowWrite: opts.allowWrite,
	};

	if (connectionString !== undefined) {
		return { ...base, connectionString };
	}
	return base;
}
