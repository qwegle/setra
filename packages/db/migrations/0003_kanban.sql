CREATE TABLE IF NOT EXISTS kanban_boards (
  id          TEXT PRIMARY KEY,
  company_slug TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  archived    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kanban_columns (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  color      TEXT,
  wip_limit  INTEGER
);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  column_id    TEXT NOT NULL REFERENCES kanban_columns(id),
  title        TEXT NOT NULL,
  description  TEXT,
  assignee     TEXT,
  priority     TEXT CHECK(priority IN ('critical','high','medium','low')) DEFAULT 'medium',
  labels       TEXT,
  due_date     INTEGER,
  external_ref TEXT,
  position     INTEGER NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_kanban_cards_board ON kanban_cards(board_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_column ON kanban_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_assignee ON kanban_cards(assignee);
