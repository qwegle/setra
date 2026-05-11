-- 0010_run_visibility.sql
--
-- Add visibility columns to the `runs` table so the server can persist
-- the resolved system prompt actually sent to the model and the time of
-- the first streamed chunk. The Board uses these to render run-evidence
-- bundles and time-to-first-token SLA dashboards.
--
-- Migrations are wrapped in a transaction by the migration runner; this
-- file must NOT contain its own BEGIN/COMMIT.

-- system_prompt: full prompt text (after enterprise standards, project
-- rules, integrations context, memory and clone brief have been stitched
-- in) that was passed to the model adapter.
ALTER TABLE runs ADD COLUMN system_prompt TEXT;

-- first_chunk_at: ISO-8601 timestamp of the first chunk recorded for
-- this run. NULL until the agent emits anything; once set, never
-- updated.
ALTER TABLE runs ADD COLUMN first_chunk_at TEXT;
