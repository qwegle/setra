ALTER TABLE "board_issues" ADD COLUMN "parent_issue_id" TEXT REFERENCES "board_issues"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_board_issues_parent_issue" ON "board_issues" ("parent_issue_id");
