import { getDb, schema } from "@setra/db";
import chalk from "chalk";

interface ConnectOptions {
	host: string;
	username: string;
	port: number;
	keyPath?: string;
}

interface DbConnectOptions {
	driver: "postgres" | "mysql" | "mssql" | "mongodb";
	host: string;
	port?: number;
	database: string;
	user: string;
	passwordEnv: string;
	name: string;
	ssl?: boolean;
	allowWrite?: boolean;
	connectionStringEnv?: string;
}

const DEFAULT_DB_PORTS: Record<string, number> = {
	postgres: 5432,
	mysql: 3306,
	mssql: 1433,
	mongodb: 27017,
};

export async function connectCommand(opts: ConnectOptions): Promise<void> {
	let db;
	try {
		db = getDb();
	} catch {
		console.error(chalk.red("No setra database. Run: setra init"));
		process.exit(1);
	}

	// Check if this ground already exists
	const existing = db
		.select()
		.from(schema.grounds)
		.all()
		.find(
			(g) =>
				g.host === opts.host &&
				g.username === opts.username &&
				g.port === opts.port,
		);

	if (existing) {
		console.log(
			chalk.yellow(
				`Ground already registered: ${existing.name} (${existing.id.substring(0, 8)})`,
			),
		);
		return;
	}

	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const name = `${opts.username}@${opts.host}`;

	db.insert(schema.grounds)
		.values({
			id,
			name,
			host: opts.host,
			port: opts.port,
			username: opts.username,
			authType: opts.keyPath ? "key" : "agent",
			keyPath: opts.keyPath ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	console.log(chalk.green(`✓ Ground registered: ${name}`));
	console.log(chalk.gray(`  id:   ${id}`));
	console.log(chalk.gray(`  host: ${opts.host}:${opts.port}`));
	console.log(
		chalk.gray(
			`  auth: ${opts.keyPath ? "key (" + opts.keyPath + ")" : "ssh-agent"}`,
		),
	);
	console.log();
	console.log(
		chalk.gray("Use this ground when creating plots in the desktop app."),
	);
}

export async function connectDbCommand(opts: DbConnectOptions): Promise<void> {
	let db;
	try {
		db = getDb();
	} catch {
		console.error(chalk.red("No setra database. Run: setra init"));
		process.exit(1);
	}

	const port = opts.port ?? DEFAULT_DB_PORTS[opts.driver] ?? 5432;

	// Check for duplicate
	const existing = db
		.select()
		.from(schema.grounds)
		.all()
		.find(
			(g) =>
				g.groundType === "database" &&
				g.dbDriver === opts.driver &&
				g.dbHost === opts.host &&
				g.dbPort === port &&
				g.dbName === opts.database,
		);

	if (existing) {
		console.log(
			chalk.yellow(
				`DB ground already registered: ${existing.name} (${existing.id.substring(0, 8)})`,
			),
		);
		return;
	}

	// Validate password env var is set
	if (!opts.connectionStringEnv && !process.env[opts.passwordEnv]) {
		console.warn(
			chalk.yellow(
				`Warning: env var ${opts.passwordEnv} is not currently set. Make sure it is set at runtime.`,
			),
		);
	}

	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	db.insert(schema.grounds)
		.values({
			id,
			name: opts.name,
			host: opts.host,
			port,
			username: opts.user,
			authType: "agent" as const,
			groundType: "database",
			dbDriver: opts.driver,
			dbHost: opts.host,
			dbPort: port,
			dbName: opts.database,
			dbUser: opts.user,
			dbPasswordEnv: opts.passwordEnv,
			dbSsl: opts.ssl !== false ? 1 : 0,
			dbAllowWrite: opts.allowWrite ? 1 : 0,
			dbConnectionStringEnv: opts.connectionStringEnv ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	console.log(chalk.green(`✓ DB ground registered: ${opts.name}`));
	console.log(chalk.gray(`  id:       ${id}`));
	console.log(chalk.gray(`  driver:   ${opts.driver}`));
	console.log(chalk.gray(`  host:     ${opts.host}:${port}`));
	console.log(chalk.gray(`  database: ${opts.database}`));
	console.log(chalk.gray(`  user:     ${opts.user}`));
	console.log(
		chalk.gray(
			`  password: resolved from env var "${opts.passwordEnv}" at runtime`,
		),
	);
	console.log(
		chalk.gray(`  ssl:      ${opts.ssl !== false ? "require" : "disabled"}`),
	);
	console.log(
		chalk.gray(`  writes:   ${opts.allowWrite ? "allowed" : "read-only"}`),
	);
	console.log();
	console.log(
		chalk.gray("Use this ground when creating plots in the desktop app."),
	);
}
