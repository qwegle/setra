-- Migration 0011: add tool_name to chunks and evidence/audit metadata to runs.
--
-- tool_name lets the evidence-bundle pipeline reconstruct structured
-- tool-call traces directly from the chunks table without parsing the
-- content blob. files_touched_count + tool_calls_count are denormalized
-- counters so the board can render compact "agent did X edits, Y tool
-- calls" summaries without re-aggregating the full chunk feed.

ALTER TABLE chunks ADD COLUMN tool_name TEXT;
ALTER TABLE runs   ADD COLUMN tool_calls_count INTEGER DEFAULT 0;
ALTER TABLE runs   ADD COLUMN files_touched_count INTEGER DEFAULT 0;
