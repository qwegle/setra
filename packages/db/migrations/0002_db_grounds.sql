-- Migration 0002: Database grounds support
ALTER TABLE grounds ADD COLUMN `ground_type` text DEFAULT 'local' NOT NULL;
ALTER TABLE grounds ADD COLUMN `db_driver` text;        -- 'postgres'|'mysql'|'mssql'|'mongodb'
ALTER TABLE grounds ADD COLUMN `db_host` text;
ALTER TABLE grounds ADD COLUMN `db_port` integer;
ALTER TABLE grounds ADD COLUMN `db_name` text;
ALTER TABLE grounds ADD COLUMN `db_user` text;
ALTER TABLE grounds ADD COLUMN `db_password_env` text;  -- env var name, NOT the password itself
ALTER TABLE grounds ADD COLUMN `db_ssl` integer DEFAULT 1 NOT NULL;  -- 1=require, 0=disable
ALTER TABLE grounds ADD COLUMN `db_allow_write` integer DEFAULT 0 NOT NULL;
ALTER TABLE grounds ADD COLUMN `db_connection_string_env` text;  -- alternative: full DSN in env var
ALTER TABLE grounds ADD COLUMN `db_schema_cache` text;           -- JSON, refreshed on connect
ALTER TABLE grounds ADD COLUMN `db_last_connected_at` text;

CREATE INDEX IF NOT EXISTS `idx_grounds_type` ON `grounds` (`ground_type`);
