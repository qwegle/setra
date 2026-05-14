/**
 * fk-cascades.test.ts — verify migration 0009_fk_cascades.sql applies the
 * expected ON DELETE CASCADE / SET NULL behaviour to the four
 * ensureTables-managed parent-child tables (approvals, goals, routines,
 * routine_runs).
 *
 * The test runs the migration against a fresh in-process SQLite database
 * seeded with the parent-table stubs ensureTables would have created, plus
 * representative parent and child rows including deliberate orphans.
 *
 * Failure of any assertion indicates either:
 *   - the migration's orphan-cleanup pass missed a case;
 *   - a foreign-key declaration was lost during a rebuild;
 *   - the goals self-FK rebuild regressed back to the bug where the
 *     drop of the old goals table triggered SET NULL on the new one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = join(
	__dirname,
	"..",
	"..",
	"..",
	"..",
	"packages",
	"db",
	"migrations",
	"0009_fk_cascades.sql",
);

function freshDatabaseWithEnsureTablesStubs(): Database.Database {
	const db = new Database(":memory:");
	db.pragma("foreign_keys = ON");
	db.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE agent_roster (id TEXT PRIMARY KEY, slug TEXT, display_name TEXT);
    CREATE TABLE board_issues (id TEXT PRIMARY KEY, title TEXT);

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      requested_by_agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      payload TEXT,
      issue_id TEXT,
      issue_title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_at TEXT,
      company_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      parent_goal_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE routines (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      schedule TEXT,
      agent_id TEXT,
      prompt TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      last_triggered_at TEXT,
      next_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE routine_runs (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      output TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
	return db;
}

function applyMigration(db: Database.Database): void {
	const sql = readFileSync(MIGRATION_PATH, "utf8");
	const tx = db.transaction(() => db.exec(sql));
	tx();
}

describe("0009_fk_cascades migration", () => {
	it("removes orphan rows before adding the FK constraints", () => {
		const db = freshDatabaseWithEnsureTablesStubs();
		db.exec(`
      INSERT INTO companies (id, name) VALUES ('co1', 'Acme');
      INSERT INTO agent_roster (id, slug, display_name) VALUES ('ag1', 'dev', 'Dev');
      INSERT INTO board_issues (id, title) VALUES ('iss1', 'Bug');

      INSERT INTO approvals (id, requested_by_agent_id, agent_name, action, description, issue_id, company_id)
        VALUES ('valid', 'ag1', 'Dev', 'write_file', 'fix', 'iss1', 'co1');
      INSERT INTO approvals (id, requested_by_agent_id, agent_name, action, description, company_id)
        VALUES ('orphan-agent', 'missing', 'Ghost', 'x', 'y', 'co1');
      INSERT INTO approvals (id, requested_by_agent_id, agent_name, action, description, issue_id, company_id)
        VALUES ('orphan-issue', 'ag1', 'Dev', 'x', 'y', 'missing-issue', 'co1');
      INSERT INTO approvals (id, requested_by_agent_id, agent_name, action, description, company_id)
        VALUES ('orphan-company', 'ag1', 'Dev', 'x', 'y', 'missing-co');

      INSERT INTO goals (id, company_id, title) VALUES ('g-valid', 'co1', 'Top');
      INSERT INTO goals (id, company_id, title) VALUES ('g-orphan', 'missing-co', 'Lost');

      INSERT INTO routines (id, company_id, name, agent_id) VALUES ('r-valid', 'co1', 'A', 'ag1');
      INSERT INTO routines (id, company_id, name, agent_id) VALUES ('r-orphan-co', 'missing-co', 'B', 'ag1');

      INSERT INTO routine_runs (id, routine_id, started_at) VALUES ('rr-valid', 'r-valid', 't');
      INSERT INTO routine_runs (id, routine_id, started_at) VALUES ('rr-orphan', 'missing-routine', 't');
    `);

		applyMigration(db);

		const approvals = db.prepare("SELECT id FROM approvals ORDER BY id").all();
		expect(approvals).toEqual([{ id: "valid" }]);

		const goals = db.prepare("SELECT id FROM goals ORDER BY id").all();
		expect(goals).toEqual([{ id: "g-valid" }]);

		const routines = db.prepare("SELECT id FROM routines ORDER BY id").all();
		expect(routines).toEqual([{ id: "r-valid" }]);

		const runs = db.prepare("SELECT id FROM routine_runs ORDER BY id").all();
		expect(runs).toEqual([{ id: "rr-valid" }]);
	});

	it("preserves goals self-references across the rebuild", () => {
		const db = freshDatabaseWithEnsureTablesStubs();
		db.exec(`
      INSERT INTO companies (id, name) VALUES ('co1', 'Acme');
      INSERT INTO goals (id, company_id, title, parent_goal_id) VALUES ('root', 'co1', 'Top', NULL);
      INSERT INTO goals (id, company_id, title, parent_goal_id) VALUES ('child', 'co1', 'Sub', 'root');
      INSERT INTO goals (id, company_id, title, parent_goal_id) VALUES ('grand', 'co1', 'Sub2', 'child');
    `);

		applyMigration(db);

		const rows = db
			.prepare("SELECT id, parent_goal_id FROM goals ORDER BY id")
			.all();
		expect(rows).toEqual([
			{ id: "child", parent_goal_id: "root" },
			{ id: "grand", parent_goal_id: "child" },
			{ id: "root", parent_goal_id: null },
		]);
	});

	it("cascades approvals on agent deletion and on company deletion", () => {
		const db = freshDatabaseWithEnsureTablesStubs();
		db.exec(`
      INSERT INTO companies (id, name) VALUES ('co1', 'Acme');
      INSERT INTO agent_roster (id, slug, display_name) VALUES ('ag1', 'dev', 'Dev');
      INSERT INTO board_issues (id, title) VALUES ('iss1', 'Bug');

      INSERT INTO approvals (id, requested_by_agent_id, agent_name, action, description, issue_id, company_id)
        VALUES ('a1', 'ag1', 'Dev', 'x', 'y', 'iss1', 'co1');
    `);
		applyMigration(db);
		db.pragma("foreign_keys = ON");

		db.prepare("DELETE FROM agent_roster WHERE id = 'ag1'").run();
		expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({
			n: 0,
		});
	});

	it("cascades routines and routine_runs on company deletion, sets routine.agent_id to NULL on agent deletion", () => {
		const db = freshDatabaseWithEnsureTablesStubs();
		db.exec(`
      INSERT INTO companies (id, name) VALUES ('co1', 'Acme');
      INSERT INTO agent_roster (id, slug, display_name) VALUES ('ag1', 'dev', 'Dev');

      INSERT INTO routines (id, company_id, name, agent_id) VALUES ('r1', 'co1', 'Daily', 'ag1');
      INSERT INTO routine_runs (id, routine_id, started_at) VALUES ('rr1', 'r1', 't');
    `);
		applyMigration(db);
		db.pragma("foreign_keys = ON");

		db.prepare("DELETE FROM agent_roster WHERE id = 'ag1'").run();
		const routinesAfterAgent = db
			.prepare("SELECT id, agent_id FROM routines")
			.all();
		expect(routinesAfterAgent).toEqual([{ id: "r1", agent_id: null }]);

		db.prepare("DELETE FROM companies WHERE id = 'co1'").run();
		expect(db.prepare("SELECT COUNT(*) AS n FROM routines").get()).toEqual({
			n: 0,
		});
		expect(db.prepare("SELECT COUNT(*) AS n FROM routine_runs").get()).toEqual({
			n: 0,
		});
	});

	it("leaves no foreign-key violations after the migration", () => {
		const db = freshDatabaseWithEnsureTablesStubs();
		db.exec(`
      INSERT INTO companies (id, name) VALUES ('co1', 'Acme');
      INSERT INTO agent_roster (id, slug, display_name) VALUES ('ag1', 'dev', 'Dev');
      INSERT INTO board_issues (id, title) VALUES ('iss1', 'Bug');

      INSERT INTO approvals (id, requested_by_agent_id, agent_name, action, description, issue_id, company_id)
        VALUES ('a1', 'ag1', 'Dev', 'x', 'y', 'iss1', 'co1');
      INSERT INTO goals (id, company_id, title, parent_goal_id) VALUES ('root', 'co1', 'Top', NULL);
      INSERT INTO goals (id, company_id, title, parent_goal_id) VALUES ('child', 'co1', 'Sub', 'root');
      INSERT INTO routines (id, company_id, name, agent_id) VALUES ('r1', 'co1', 'Daily', 'ag1');
      INSERT INTO routine_runs (id, routine_id, started_at) VALUES ('rr1', 'r1', 't');
    `);

		applyMigration(db);

		const violations = db.pragma("foreign_key_check") as Array<unknown>;
		expect(violations).toEqual([]);
	});
});
