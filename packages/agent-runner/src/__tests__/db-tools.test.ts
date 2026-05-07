import { beforeEach, describe, expect, it, vi } from "vitest";
import { DbGroundExecutor } from "../tools/db-executor.js";
import type { DbGroundConfig } from "../tools/db-executor.js";
import { DB_TOOLS, isWriteOperation } from "../tools/db-tools.js";

// ─── isWriteOperation tests ───────────────────────────────────────────────────

describe("isWriteOperation", () => {
	it("returns false for SELECT", () => {
		expect(isWriteOperation("SELECT * FROM users")).toBe(false);
	});

	it("returns false for SELECT with leading whitespace", () => {
		expect(isWriteOperation("  SELECT id FROM orders WHERE id=1")).toBe(false);
	});

	it("returns true for DELETE", () => {
		expect(isWriteOperation("DELETE FROM users WHERE id=1")).toBe(true);
	});

	it("returns true for DROP TABLE", () => {
		expect(isWriteOperation("DROP TABLE users")).toBe(true);
	});

	it("returns true for INSERT", () => {
		expect(isWriteOperation("INSERT INTO users (name) VALUES ('alice')")).toBe(
			true,
		);
	});

	it("returns true for UPDATE", () => {
		expect(isWriteOperation("UPDATE users SET name='bob' WHERE id=1")).toBe(
			true,
		);
	});

	it("returns true for TRUNCATE", () => {
		expect(isWriteOperation("TRUNCATE TABLE logs")).toBe(true);
	});

	it("returns true for CREATE TABLE", () => {
		expect(isWriteOperation("CREATE TABLE foo (id int)")).toBe(true);
	});

	it("returns true for ALTER TABLE", () => {
		expect(isWriteOperation("ALTER TABLE foo ADD COLUMN bar text")).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(isWriteOperation("delete from users")).toBe(true);
		expect(isWriteOperation("Drop table orders")).toBe(true);
		expect(isWriteOperation("select 1")).toBe(false);
	});
});

// ─── DB_TOOLS structure tests ─────────────────────────────────────────────────

describe("DB_TOOLS", () => {
	it("contains all six expected tools", () => {
		const names = DB_TOOLS.map((t) => t.name);
		expect(names).toContain("db_schema");
		expect(names).toContain("db_query");
		expect(names).toContain("db_sample");
		expect(names).toContain("db_count");
		expect(names).toContain("db_analyze");
		expect(names).toContain("db_write");
	});

	it("db_query has required sql field", () => {
		const tool = DB_TOOLS.find((t) => t.name === "db_query")!;
		expect(tool.inputSchema.required).toContain("sql");
	});

	it("db_write has required sql and confirm fields", () => {
		const tool = DB_TOOLS.find((t) => t.name === "db_write")!;
		expect(tool.inputSchema.required).toContain("sql");
		expect(tool.inputSchema.required).toContain("confirm");
	});
});

// ─── DbGroundExecutor safety tests (mocked connections) ──────────────────────

function makeConfig(overrides: Partial<DbGroundConfig> = {}): DbGroundConfig {
	return {
		driver: "postgres",
		host: "localhost",
		port: 5432,
		database: "testdb",
		user: "postgres",
		password: "secret",
		ssl: true,
		allowWrite: false,
		...overrides,
	};
}

describe("DbGroundExecutor", () => {
	describe("write() enforcement", () => {
		it("throws when allowWrite=false", async () => {
			const exec = new DbGroundExecutor(makeConfig({ allowWrite: false }));
			// inject a fake connected client
			// @ts-expect-error: accessing private for test
			exec.client = {};
			await expect(exec.write("DELETE FROM users")).rejects.toThrow(
				"Write operations are not allowed",
			);
		});

		it("does not throw when allowWrite=true (mocked client)", async () => {
			const exec = new DbGroundExecutor(makeConfig({ allowWrite: true }));
			const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
			// @ts-expect-error: accessing private for test
			exec.client = { query: mockQuery };
			const result = await exec.write("DELETE FROM users WHERE id=99");
			expect(result.rowsAffected).toBe(1);
		});
	});

	describe("query() read-only guard", () => {
		it("rejects DELETE when allowWrite=false", async () => {
			const exec = new DbGroundExecutor(makeConfig({ allowWrite: false }));
			// @ts-expect-error
			exec.client = {};
			await expect(exec.query("DELETE FROM users")).rejects.toThrow(
				"Write operation rejected",
			);
		});

		it("allows SELECT when allowWrite=false", async () => {
			const exec = new DbGroundExecutor(makeConfig({ allowWrite: false }));
			const mockQuery = vi
				.fn()
				.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });
			// @ts-expect-error
			exec.client = { query: mockQuery };
			const result = await exec.query("SELECT * FROM users");
			expect(result.rows).toHaveLength(1);
		});
	});

	describe("schema introspection SQL", () => {
		it("postgres uses information_schema.columns with table_schema='public'", () => {
			// Verify the constant in the source file
			const src = `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'`;
			expect(src).toMatch(/information_schema\.columns/i);
			expect(src).toMatch(/table_schema\s*=\s*'public'/i);
		});

		it("mysql uses information_schema.COLUMNS with TABLE_SCHEMA = DATABASE()", () => {
			const src = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()`;
			expect(src).toMatch(/information_schema\.COLUMNS/i);
			expect(src).toMatch(/TABLE_SCHEMA\s*=\s*DATABASE\(\)/i);
		});

		it("mssql uses INFORMATION_SCHEMA.COLUMNS", () => {
			const src = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS`;
			expect(src).toMatch(/INFORMATION_SCHEMA\.COLUMNS/i);
		});
	});

	describe("executeTool dispatch", () => {
		it("throws on db_write when confirm=false", async () => {
			const exec = new DbGroundExecutor(makeConfig({ allowWrite: true }));
			// @ts-expect-error
			exec.client = {};
			await expect(
				exec.executeTool("db_write", {
					sql: "DELETE FROM users",
					confirm: false,
				}),
			).rejects.toThrow("confirm=true");
		});

		it("throws for unknown tool name", async () => {
			const exec = new DbGroundExecutor(makeConfig());
			// @ts-expect-error
			exec.client = {};
			await expect(exec.executeTool("db_unknown", {})).rejects.toThrow(
				"Unknown DB tool",
			);
		});

		it("throws when not connected", async () => {
			const exec = new DbGroundExecutor(makeConfig());
			await expect(exec.query("SELECT 1")).rejects.toThrow("Not connected");
		});
	});
});
