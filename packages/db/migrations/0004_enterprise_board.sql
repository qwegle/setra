-- Enterprise board: projects, issues, budget limits
CREATE TABLE IF NOT EXISTS "board_projects" (
  "id"             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "name"           TEXT NOT NULL,
  "slug"           TEXT NOT NULL,
  "description"    TEXT,
  "repo_project_id" TEXT,
  "total_cost_usd" REAL NOT NULL DEFAULT 0,
  "requirements"   TEXT NOT NULL DEFAULT '',
  "plan_status"    TEXT NOT NULL DEFAULT 'none',
  "settings_json"  TEXT NOT NULL DEFAULT '{}',
  "created_at"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_board_projects_slug" ON "board_projects" ("slug");

CREATE TABLE IF NOT EXISTS "board_issues" (
  "id"                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "project_id"        TEXT NOT NULL REFERENCES "board_projects"("id") ON DELETE CASCADE,
  "slug"              TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "description"       TEXT,
  "status"            TEXT NOT NULL DEFAULT 'backlog'
                        CHECK("status" IN ('backlog','todo','in_progress','in_review','done','cancelled')),
  "priority"          TEXT NOT NULL DEFAULT 'none'
                        CHECK("priority" IN ('none','urgent','high','medium','low')),
  "assigned_agent_id" TEXT,
  "estimated_cost_usd" REAL,
  "actual_cost_usd"   REAL NOT NULL DEFAULT 0,
  "created_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS "idx_board_issues_project" ON "board_issues" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_board_issues_status"  ON "board_issues" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_board_issues_slug" ON "board_issues" ("slug");

CREATE TABLE IF NOT EXISTS "board_budget_limits" (
  "id"             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "project_id"     TEXT REFERENCES "board_projects"("id") ON DELETE CASCADE,
  "agent_slug"     TEXT,
  "limit_usd"      REAL NOT NULL,
  "period_days"    INTEGER NOT NULL DEFAULT 30,
  "alert_percent"  INTEGER NOT NULL DEFAULT 80,
  "created_at"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Skills
CREATE TABLE IF NOT EXISTS "skills" (
  "id"           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "name"         TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "description"  TEXT NOT NULL,
  "category"     TEXT NOT NULL DEFAULT 'custom'
                   CHECK("category" IN ('code','web','security','data','custom')),
  "trigger"      TEXT NOT NULL,
  "prompt"       TEXT NOT NULL,
  "is_active"    INTEGER NOT NULL DEFAULT 1,
  "usage_count"  INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TEXT,
  "created_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_skills_slug"   ON "skills" ("slug");
CREATE INDEX        IF NOT EXISTS "idx_skills_active" ON "skills" ("is_active");

-- Wiki
CREATE TABLE IF NOT EXISTS "wiki_entries" (
  "id"          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "title"       TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "content"     TEXT NOT NULL DEFAULT '',
  "category"    TEXT NOT NULL DEFAULT 'General',
  "tags_json"   TEXT NOT NULL DEFAULT '[]',
  "author_slug" TEXT NOT NULL DEFAULT 'user',
  "created_at"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_wiki_slug"     ON "wiki_entries" ("slug");
CREATE INDEX        IF NOT EXISTS "idx_wiki_category" ON "wiki_entries" ("category");

-- Artifacts
CREATE TABLE IF NOT EXISTS "artifacts" (
  "id"           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "name"         TEXT NOT NULL,
  "type"         TEXT NOT NULL DEFAULT 'data'
                   CHECK("type" IN ('code','document','image','archive','data')),
  "mime_type"    TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes"   INTEGER NOT NULL DEFAULT 0,
  "issue_id"     TEXT,
  "issue_slug"   TEXT,
  "agent_slug"   TEXT NOT NULL,
  "description"  TEXT NOT NULL DEFAULT '',
  "content"      TEXT,
  "storage_path" TEXT,
  "created_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS "idx_artifacts_issue" ON "artifacts" ("issue_id");
CREATE INDEX IF NOT EXISTS "idx_artifacts_agent" ON "artifacts" ("agent_slug");
CREATE INDEX IF NOT EXISTS "idx_artifacts_type"  ON "artifacts" ("type");

-- Review queue
CREATE TABLE IF NOT EXISTS "review_items" (
  "id"                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "type"               TEXT NOT NULL
                         CHECK("type" IN ('approval','code_review','budget_override','security_sign_off')),
  "title"              TEXT NOT NULL,
  "description"        TEXT NOT NULL,
  "requested_by"       TEXT NOT NULL,
  "target_issue_slug"  TEXT,
  "estimated_cost_usd" REAL,
  "diff"               TEXT,
  "risk_level"         TEXT NOT NULL DEFAULT 'medium'
                         CHECK("risk_level" IN ('low','medium','high')),
  "status"             TEXT NOT NULL DEFAULT 'pending'
                         CHECK("status" IN ('pending','approved','rejected')),
  "comment"            TEXT,
  "resolved_at"        TEXT,
  "created_at"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS "idx_review_status" ON "review_items" ("status");
CREATE INDEX IF NOT EXISTS "idx_review_type"   ON "review_items" ("type");

-- Org members
CREATE TABLE IF NOT EXISTS "org_members" (
  "id"        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "name"      TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "role"      TEXT NOT NULL DEFAULT 'member'
                CHECK("role" IN ('owner','admin','member','viewer')),
  "joined_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_members_email" ON "org_members" ("email");

-- Clone agent
CREATE TABLE IF NOT EXISTS "clone_profile" (
  "id"         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "name"       TEXT NOT NULL DEFAULT 'My Clone',
  "mode"       TEXT NOT NULL DEFAULT 'training' CHECK("mode" IN ('training','locked')),
  "model_json" TEXT,
  "brief"      TEXT,
  "trained_at" TEXT,
  "locked_at"  TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS "clone_observations" (
  "id"             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "clone_id"       TEXT NOT NULL REFERENCES "clone_profile"("id") ON DELETE CASCADE,
  "source"         TEXT NOT NULL
                     CHECK("source" IN ('issue_title','issue_description','comment',
                                        'chat_message','task_description','agent_feedback',
                                        'qa_answer','vision_note')),
  "content"        TEXT NOT NULL,
  "embedding_json" TEXT,
  "weight"         REAL NOT NULL DEFAULT 1.0,
  "processed"      INTEGER NOT NULL DEFAULT 0,
  "created_at"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS "idx_ent_obs_clone"     ON "clone_observations" ("clone_id");
CREATE INDEX IF NOT EXISTS "idx_ent_obs_processed" ON "clone_observations" ("processed");

CREATE TABLE IF NOT EXISTS "clone_qa_sessions" (
  "id"          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  "clone_id"    TEXT NOT NULL REFERENCES "clone_profile"("id") ON DELETE CASCADE,
  "question"    TEXT NOT NULL,
  "aspect"      TEXT NOT NULL,
  "answer"      TEXT,
  "answered_at" TEXT,
  "created_at"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
