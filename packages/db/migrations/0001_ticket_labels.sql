-- Migration 0001: Ticket labels + external references
-- Enables per-ticket token analytics (Jira, GitHub Issues, Linear, etc.)

-- Add external_ref to plots: stores "JIRA-1234", "GH-456", "LINEAR-789"
ALTER TABLE plots ADD COLUMN `external_ref` text;
ALTER TABLE plots ADD COLUMN `labels` text DEFAULT '[]' NOT NULL; -- JSON array of strings
ALTER TABLE plots ADD COLUMN `issue_type` text; -- 'bug' | 'feature' | 'refactor' | 'docs' | 'infra' | 'hotfix'

-- Add cache tokens breakdown to projects rollup
ALTER TABLE projects ADD COLUMN `total_prompt_tokens` integer DEFAULT 0 NOT NULL;
ALTER TABLE projects ADD COLUMN `total_completion_tokens` integer DEFAULT 0 NOT NULL;
ALTER TABLE projects ADD COLUMN `total_cache_read_tokens` integer DEFAULT 0 NOT NULL;

-- Index for fast ticket lookups
CREATE INDEX IF NOT EXISTS `idx_plots_external_ref` ON `plots` (`external_ref`);
CREATE INDEX IF NOT EXISTS `idx_plots_issue_type` ON `plots` (`issue_type`);

-- Token analytics view: per-plot rollup (one row per Jira ticket / plot)
CREATE VIEW IF NOT EXISTS `v_plot_token_summary` AS
SELECT
  p.id               AS plot_id,
  p.name             AS plot_name,
  p.external_ref     AS ticket,
  p.issue_type,
  p.labels,
  p.total_cost_usd,
  COUNT(r.id)                       AS run_count,
  SUM(r.prompt_tokens)              AS total_prompt_tokens,
  SUM(r.completion_tokens)          AS total_completion_tokens,
  SUM(r.cache_read_tokens)          AS total_cache_read_tokens,
  SUM(r.prompt_tokens + r.completion_tokens + r.cache_read_tokens) AS total_tokens,
  SUM(r.cost_usd)                   AS total_cost_usd_runs,
  MIN(r.started_at)                 AS first_run_at,
  MAX(r.ended_at)                   AS last_run_at,
  ROUND(
    (julianday(MAX(r.ended_at)) - julianday(MIN(r.started_at))) * 24 * 60,
    1
  )                                  AS duration_minutes
FROM plots p
LEFT JOIN runs r ON r.plot_id = p.id
GROUP BY p.id;

-- Analytics view: group by issue_type — answers "which type takes most tokens?"
CREATE VIEW IF NOT EXISTS `v_issue_type_analytics` AS
SELECT
  issue_type,
  COUNT(*)                          AS ticket_count,
  ROUND(AVG(total_cost_usd_runs),4) AS avg_cost_usd,
  ROUND(AVG(total_tokens),0)        AS avg_tokens,
  ROUND(AVG(run_count),1)           AS avg_runs,
  ROUND(AVG(duration_minutes),1)    AS avg_duration_min,
  SUM(total_cost_usd_runs)          AS total_cost_usd
FROM v_plot_token_summary
WHERE issue_type IS NOT NULL
GROUP BY issue_type
ORDER BY avg_tokens DESC;
