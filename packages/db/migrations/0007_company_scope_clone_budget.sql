ALTER TABLE board_budget_limits ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE clone_profile ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE clone_observations ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default';
