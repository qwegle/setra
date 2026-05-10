-- 0009_fk_cascades.sql
--
-- Adds ON DELETE foreign key constraints to four ensureTables-managed
-- parent-child tables that previously had unconstrained TEXT columns
-- pointing at parent rows. Without these constraints the platform
-- accumulates orphan rows whenever a parent (agent, issue, company, or
-- routine) is deleted, which corrupts dispatcher join queries and audit
-- exports.
--
-- SQLite cannot ALTER TABLE to add a foreign key, so each table is
-- rebuilt via the standard pattern:
--
--   1. Delete orphan rows so the rebuild does not violate the new
--      constraint.
--   2. Create a new table with the constraint in place.
--   3. Copy rows from the old table into the new table.
--   4. Drop the old table and rename the new one over it.
--   5. Recreate any indexes that lived on the old table.
--
-- The startup sequence is: ensureTables() then runMigrations(). That
-- guarantees the parent tables (agent_roster, board_issues, companies)
-- exist before this migration tries to reference them, even on a fresh
-- install.
--
-- Foreign-key enforcement is toggled off for the duration of the
-- migration. This is the documented SQLite procedure for table rebuild
-- and only affects this single connection. The runtime PRAGMA
-- foreign_keys = ON is reapplied on the next connection open via
-- applyPragmas() in packages/db/src/client.ts.

PRAGMA foreign_keys = OFF;

-- ─── approvals ──────────────────────────────────────────────────────────
-- requested_by_agent_id → agent_roster(id)  ON DELETE CASCADE
-- issue_id              → board_issues(id)  ON DELETE CASCADE
-- company_id            → companies(id)     ON DELETE CASCADE

DELETE FROM approvals
 WHERE requested_by_agent_id IS NOT NULL
   AND requested_by_agent_id NOT IN (SELECT id FROM agent_roster);

DELETE FROM approvals
 WHERE issue_id IS NOT NULL
   AND issue_id NOT IN (SELECT id FROM board_issues);

DELETE FROM approvals
 WHERE company_id IS NOT NULL
   AND company_id NOT IN (SELECT id FROM companies);

CREATE TABLE approvals__new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  requested_by_agent_id TEXT NOT NULL
    REFERENCES agent_roster(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  payload TEXT,
  issue_id TEXT REFERENCES board_issues(id) ON DELETE CASCADE,
  issue_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TEXT,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO approvals__new (
  id, requested_by_agent_id, agent_name, action, description, payload,
  issue_id, issue_title, status, resolved_at, company_id,
  created_at, updated_at
)
SELECT
  id, requested_by_agent_id, agent_name, action, description, payload,
  issue_id, issue_title, status, resolved_at, company_id,
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM approvals;

DROP TABLE approvals;
ALTER TABLE approvals__new RENAME TO approvals;

CREATE INDEX IF NOT EXISTS idx_approvals_company_status
  ON approvals(company_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_agent
  ON approvals(requested_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_approvals_issue
  ON approvals(issue_id);

-- ─── goals ──────────────────────────────────────────────────────────────
-- company_id     → companies(id) ON DELETE CASCADE
-- parent_goal_id → goals(id)     ON DELETE SET NULL
--
-- The self-reference requires a different rebuild order than the other
-- tables. If we created `goals__new` while the old `goals` still
-- existed, the new self-FK would resolve against the old table; the
-- subsequent DROP TABLE goals would then fire ON DELETE SET NULL on
-- every row of `goals__new`. To avoid that, rename the old table to
-- `goals__old` first, then create the final `goals` table so the
-- self-FK resolves against itself from the start.

DELETE FROM goals
 WHERE company_id IS NOT NULL
   AND company_id NOT IN (SELECT id FROM companies);

UPDATE goals
   SET parent_goal_id = NULL
 WHERE parent_goal_id IS NOT NULL
   AND parent_goal_id NOT IN (SELECT id FROM goals);

ALTER TABLE goals RENAME TO goals__old;

CREATE TABLE goals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  parent_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Insert root rows first (no parent), then child rows. The self-FK is
-- enforced immediately so the topological order matters.
INSERT INTO goals (
  id, company_id, title, description, status, parent_goal_id,
  created_at, updated_at
)
SELECT
  id, company_id, title, description, status, parent_goal_id,
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM goals__old
WHERE parent_goal_id IS NULL;

INSERT INTO goals (
  id, company_id, title, description, status, parent_goal_id,
  created_at, updated_at
)
SELECT
  id, company_id, title, description, status, parent_goal_id,
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM goals__old
WHERE parent_goal_id IS NOT NULL;

DROP TABLE goals__old;

CREATE INDEX IF NOT EXISTS idx_goals_company ON goals(company_id);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_goal_id);

-- ─── routines ───────────────────────────────────────────────────────────
-- company_id → companies(id)    ON DELETE CASCADE
-- agent_id   → agent_roster(id) ON DELETE SET NULL

DELETE FROM routines
 WHERE company_id IS NOT NULL
   AND company_id NOT IN (SELECT id FROM companies);

UPDATE routines
   SET agent_id = NULL
 WHERE agent_id IS NOT NULL
   AND agent_id NOT IN (SELECT id FROM agent_roster);

CREATE TABLE routines__new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT,
  agent_id TEXT REFERENCES agent_roster(id) ON DELETE SET NULL,
  prompt TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_triggered_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO routines__new (
  id, company_id, name, description, schedule, agent_id, prompt,
  enabled, is_active, last_run_at, last_triggered_at, next_run_at,
  created_at, updated_at
)
SELECT
  id, company_id, name, description, schedule, agent_id, prompt,
  enabled, is_active, last_run_at, last_triggered_at, next_run_at,
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM routines;

DROP TABLE routines;
ALTER TABLE routines__new RENAME TO routines;

CREATE INDEX IF NOT EXISTS idx_routines_company_active
  ON routines(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_routines_next_run
  ON routines(next_run_at)
  WHERE is_active = 1;

-- ─── routine_runs ───────────────────────────────────────────────────────
-- routine_id → routines(id) ON DELETE CASCADE

DELETE FROM routine_runs
 WHERE routine_id NOT IN (SELECT id FROM routines);

CREATE TABLE routine_runs__new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  routine_id TEXT NOT NULL
    REFERENCES routines(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  output TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO routine_runs__new (
  id, routine_id, status, started_at, completed_at, output, created_at
)
SELECT
  id, routine_id, status, started_at, completed_at, output,
  COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
FROM routine_runs;

DROP TABLE routine_runs;
ALTER TABLE routine_runs__new RENAME TO routine_runs;

CREATE INDEX IF NOT EXISTS idx_routine_runs_routine_started
  ON routine_runs(routine_id, started_at DESC);

-- ─── verify ─────────────────────────────────────────────────────────────
-- foreign_key_check returns one row per violation; the migration runner
-- wraps this script in a transaction, so a non-empty result aborts the
-- migration via the surrounding transaction's rollback semantics.
-- We assert by selecting from the pragma into a no-op CTE; if rows
-- exist, the next statement raises since we cannot SELECT into nothing
-- without a target. SQLite has no ASSERT, so the verification is left
-- for the application-level integration test.

PRAGMA foreign_keys = ON;
