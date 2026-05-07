CREATE TABLE `agent_templates` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`agent` text NOT NULL,
	`model` text,
	`system_prompt` text,
	`tools` text,
	`context_inject` text,
	`estimated_cost_tier` text DEFAULT 'medium',
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_templates_name_unique` ON `agent_templates` (`name`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`content` text NOT NULL,
	`chunk_type` text DEFAULT 'output' NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_chunks_run_seq` ON `chunks` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_chunks_run_sequence` ON `chunks` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `grounds` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text NOT NULL,
	`key_path` text,
	`tmux_prefix` text DEFAULT 'setra' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_ping_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marks` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`run_id` text,
	`plot_id` text NOT NULL,
	`commit_hash` text NOT NULL,
	`branch` text NOT NULL,
	`message` text,
	`mark_type` text DEFAULT 'auto' NOT NULL,
	`files_changed` integer DEFAULT 0 NOT NULL,
	`insertions` integer DEFAULT 0 NOT NULL,
	`deletions` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_marks_plot_id` ON `marks` (`plot_id`);--> statement-breakpoint
CREATE INDEX `idx_marks_run_id` ON `marks` (`run_id`);--> statement-breakpoint
CREATE TABLE `path_runs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`path_id` text NOT NULL,
	`run_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_stage` text,
	`log` text,
	`triggered_by` text DEFAULT 'auto' NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`path_id`) REFERENCES `paths`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `paths` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`plot_id` text NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`stages` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plot_tools` (
	`plot_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`env_overrides` text,
	PRIMARY KEY(`plot_id`, `tool_id`),
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plots` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`project_id` text NOT NULL,
	`worktree_path` text,
	`branch` text NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`ground_id` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`agent_template` text,
	`description` text,
	`auto_checkpoint` integer DEFAULT true NOT NULL,
	`checkpoint_interval_s` integer DEFAULT 300 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`last_active_at` text,
	`claimed_by_session_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ground_id`) REFERENCES `grounds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_plots_project_id` ON `plots` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_plots_status` ON `plots` (`status`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`remote_url` text,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`total_runs` integer DEFAULT 0 NOT NULL,
	`last_active_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_repo_path_unique` ON `projects` (`repo_path`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`plot_id` text NOT NULL,
	`agent` text NOT NULL,
	`agent_version` text,
	`agent_binary` text,
	`agent_args` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`pty_pid` integer,
	`tmux_session` text,
	`ground_id` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`cost_confidence` text DEFAULT 'none' NOT NULL,
	`outcome` text,
	`error_message` text,
	`exit_code` integer,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ended_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ground_id`) REFERENCES `grounds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runs_plot_id` ON `runs` (`plot_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_runs_started_at` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `team_messages` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`channel` text NOT NULL,
	`from_agent` text NOT NULL,
	`to_agent` text,
	`content` text NOT NULL,
	`message_type` text DEFAULT 'task' NOT NULL,
	`sequence` integer NOT NULL,
	`read_at` text,
	`plot_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`plot_id`) REFERENCES `plots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_team_messages_channel` ON `team_messages` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_team_messages_sequence` ON `team_messages` (`sequence`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`transport` text NOT NULL,
	`command` text,
	`args` text,
	`url` text,
	`env_vars` text,
	`is_builtin` integer DEFAULT false NOT NULL,
	`is_global` integer DEFAULT false NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`last_health_check` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tools_name_unique` ON `tools` (`name`);--> statement-breakpoint
CREATE TABLE `traces` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`run_id` text,
	`project_id` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_type` text DEFAULT 'run_output' NOT NULL,
	`vector_id` text,
	`is_synthetic` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_traces_hash_project` ON `traces` (`content_hash`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_traces_project` ON `traces` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_traces_run` ON `traces` (`run_id`);