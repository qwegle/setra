-- Multi-company users + security question + invite codes.
--
-- Setra historically modelled one user per company via users.company_id NOT
-- NULL. The onboarding overhaul lets a single user join N companies and
-- discover them via LAN (mDNS), Internet (Supabase directory), or a code.
-- We keep users.company_id as the "active/primary" company for back-compat
-- with code paths that read it directly; the source of truth for membership
-- is the new user_companies join table.

-- 1. Extend users with the new profile + recovery columns.
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN security_question TEXT;
ALTER TABLE users ADD COLUMN security_answer_hash TEXT;
-- accepted_terms_at: ISO timestamp of T&C acceptance. NULL = legacy account.
ALTER TABLE users ADD COLUMN accepted_terms_at TEXT;

-- 2. user_companies: N-to-N membership with per-company role + designation.
CREATE TABLE IF NOT EXISTS user_companies (
  user_id     TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  designation TEXT,
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, company_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);

-- 3. company_invite_codes: short shareable join codes (one company, many users).
-- Distinct from company_invites (email-pinned) — these are unbound by email
-- and used in "Join via code" UX.
CREATE TABLE IF NOT EXISTS company_invite_codes (
  code        TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at  TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 0,
  uses        INTEGER NOT NULL DEFAULT 0,
  default_role TEXT NOT NULL DEFAULT 'member',
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_company ON company_invite_codes(company_id);

-- 4. Backfill: every existing user is a member of their current company.
INSERT OR IGNORE INTO user_companies (user_id, company_id, role)
SELECT id, company_id, role FROM users WHERE company_id IS NOT NULL;
