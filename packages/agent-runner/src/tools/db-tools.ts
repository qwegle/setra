/**
 * MCP tool definitions for DB grounds.
 * Agents running on a database ground receive these tools.
 */

export interface McpToolDefinition {
	name: string;
	description: string;
	inputSchema: {
		type: string;
		properties: Record<string, { type: string; description?: string }>;
		required?: string[];
	};
}

export const DB_TOOLS: McpToolDefinition[] = [
	{
		name: "db_schema",
		description:
			"Get the full schema of the connected database: tables, columns, types, indexes, foreign keys",
		inputSchema: {
			type: "object",
			properties: {
				table_filter: {
					type: "string",
					description:
						"Optional: filter to specific tables matching this pattern",
				},
			},
		},
	},
	{
		name: "db_query",
		description:
			"Run a SELECT query on the database. Only SELECT queries are allowed by default.",
		inputSchema: {
			type: "object",
			properties: {
				sql: { type: "string", description: "The SQL SELECT query to run" },
				limit: {
					type: "number",
					description: "Max rows to return (default 100, max 1000)",
				},
			},
			required: ["sql"],
		},
	},
	{
		name: "db_sample",
		description: "Get a sample of rows from a table (SELECT * LIMIT n)",
		inputSchema: {
			type: "object",
			properties: {
				table: { type: "string" },
				limit: { type: "number", description: "default 10" },
			},
			required: ["table"],
		},
	},
	{
		name: "db_count",
		description: "Count rows in a table, optionally with a WHERE clause",
		inputSchema: {
			type: "object",
			properties: {
				table: { type: "string" },
				where: {
					type: "string",
					description: "Optional WHERE clause (without WHERE keyword)",
				},
			},
			required: ["table"],
		},
	},
	{
		name: "db_analyze",
		description:
			"Analyze a table: row count, column stats, null rates, distinct values for low-cardinality columns",
		inputSchema: {
			type: "object",
			properties: {
				table: { type: "string" },
			},
			required: ["table"],
		},
	},
	{
		name: "db_write",
		description:
			"Run INSERT/UPDATE/DELETE (only available if ground has allowWrite: true)",
		inputSchema: {
			type: "object",
			properties: {
				sql: { type: "string" },
				confirm: {
					type: "boolean",
					description: "Must be true to execute",
				},
			},
			required: ["sql", "confirm"],
		},
	},
];

/**
 * Returns true when the given SQL starts with a write/DDL keyword.
 * Used to enforce read-only safety on DB grounds.
 */
export function isWriteOperation(sql: string): boolean {
	return /^\s*(insert|update|delete|drop|truncate|create|alter)/i.test(sql);
}
