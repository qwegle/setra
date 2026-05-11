-- Migration 0013: task_id_ref columns + plot branching ancestry.
--
-- Adds:
--   * runs.task_id_ref          — links an agent invocation to a kanban
--                                 card / issue / external task id so the
--                                 evidence bundle and JSONL transcript
--                                 can render "which task did this run
--                                 work on" without inferring from prose.
--   * team_messages.task_id_ref — same idea for inter-agent chat:
--                                 task / handoff / approval_request rows
--                                 can carry the task they relate to.
--   * plots.branched_from_plot_id / branched_from_run_id — ancestry for
--                                 "Branch from here" forks (DeepCode
--                                 branch_session pattern, adapted to
--                                 Setra's plot-as-workspace model).
--
-- All additions are nullable so existing rows remain valid.

ALTER TABLE runs           ADD COLUMN task_id_ref TEXT;
ALTER TABLE team_messages  ADD COLUMN task_id_ref TEXT;
ALTER TABLE plots          ADD COLUMN branched_from_plot_id TEXT;
ALTER TABLE plots          ADD COLUMN branched_from_run_id  TEXT;
ALTER TABLE plots          ADD COLUMN branched_at           TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_task_id_ref          ON runs(task_id_ref);
CREATE INDEX IF NOT EXISTS idx_team_messages_task_id_ref ON team_messages(task_id_ref);
CREATE INDEX IF NOT EXISTS idx_plots_branched_from       ON plots(branched_from_plot_id);
