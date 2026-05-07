/**
 * kanban.ts — SQLite-backed kanban board CRUD
 *
 * Uses the better-sqlite3 synchronous API via getRawDb().
 * All IDs are crypto.randomUUID().
 */

import { getRawDb } from "./client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface KanbanBoard {
	id: string;
	companySlug: string;
	name: string;
	description: string | null;
	createdBy: string;
	createdAt: Date;
	archived: boolean;
}

export interface KanbanColumn {
	id: string;
	boardId: string;
	name: string;
	position: number;
	color?: string | null;
	wipLimit?: number | null;
}

export interface KanbanCard {
	id: string;
	boardId: string;
	columnId: string;
	title: string;
	description?: string | null;
	assignee?: string | null;
	priority: "critical" | "high" | "medium" | "low";
	labels: string[];
	dueDate?: Date | null;
	externalRef?: string | null;
	position: number;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mappers
// ─────────────────────────────────────────────────────────────────────────────

interface BoardRow {
	id: string;
	company_slug: string;
	name: string;
	description: string | null;
	created_by: string;
	created_at: number;
	archived: number;
}

interface ColumnRow {
	id: string;
	board_id: string;
	name: string;
	position: number;
	color: string | null;
	wip_limit: number | null;
}

interface CardRow {
	id: string;
	board_id: string;
	column_id: string;
	title: string;
	description: string | null;
	assignee: string | null;
	priority: string;
	labels: string | null;
	due_date: number | null;
	external_ref: string | null;
	position: number;
	created_by: string;
	created_at: number;
	updated_at: number;
}

function mapBoard(row: BoardRow): KanbanBoard {
	return {
		id: row.id,
		companySlug: row.company_slug,
		name: row.name,
		description: row.description,
		createdBy: row.created_by,
		createdAt: new Date(row.created_at * 1000),
		archived: row.archived === 1,
	};
}

function mapColumn(row: ColumnRow): KanbanColumn {
	return {
		id: row.id,
		boardId: row.board_id,
		name: row.name,
		position: row.position,
		color: row.color,
		wipLimit: row.wip_limit,
	};
}

function mapCard(row: CardRow): KanbanCard {
	let labels: string[] = [];
	try {
		labels = JSON.parse(row.labels ?? "[]") as string[];
	} catch {
		labels = [];
	}
	return {
		id: row.id,
		boardId: row.board_id,
		columnId: row.column_id,
		title: row.title,
		description: row.description,
		assignee: row.assignee,
		priority: row.priority as KanbanCard["priority"],
		labels,
		dueDate: row.due_date ? new Date(row.due_date * 1000) : null,
		externalRef: row.external_ref,
		position: row.position,
		createdBy: row.created_by,
		createdAt: new Date(row.created_at * 1000),
		updatedAt: new Date(row.updated_at * 1000),
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration helper — ensure tables exist
// ─────────────────────────────────────────────────────────────────────────────

function ensureTables(): void {
	const db = getRawDb();
	db.exec(`
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
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Board operations
// ─────────────────────────────────────────────────────────────────────────────

export function createBoard(
	companySlug: string,
	name: string,
	description: string,
	createdBy: string,
): KanbanBoard {
	ensureTables();
	const db = getRawDb();
	const id = crypto.randomUUID();
	db.prepare(
		`INSERT INTO kanban_boards (id, company_slug, name, description, created_by) VALUES (?, ?, ?, ?, ?)`,
	).run(id, companySlug, name, description || null, createdBy);

	// Create default columns
	const defaultCols = ["Backlog", "In Progress", "Review", "Done"];
	for (let i = 0; i < defaultCols.length; i++) {
		createColumn(id, defaultCols[i]!, i);
	}

	return getBoard(id)!;
}

export function getBoard(boardId: string): KanbanBoard | null {
	ensureTables();
	const db = getRawDb();
	const row = db
		.prepare(`SELECT * FROM kanban_boards WHERE id = ?`)
		.get(boardId) as BoardRow | undefined;
	return row ? mapBoard(row) : null;
}

export function listBoards(companySlug: string): KanbanBoard[] {
	ensureTables();
	const db = getRawDb();
	const rows = db
		.prepare(
			`SELECT * FROM kanban_boards WHERE company_slug = ? AND archived = 0 ORDER BY created_at DESC`,
		)
		.all(companySlug) as BoardRow[];
	return rows.map(mapBoard);
}

// ─────────────────────────────────────────────────────────────────────────────
// Column operations
// ─────────────────────────────────────────────────────────────────────────────

export function createColumn(
	boardId: string,
	name: string,
	position: number,
	color?: string,
	wipLimit?: number,
): KanbanColumn {
	ensureTables();
	const db = getRawDb();
	const id = crypto.randomUUID();
	db.prepare(
		`INSERT INTO kanban_columns (id, board_id, name, position, color, wip_limit) VALUES (?, ?, ?, ?, ?, ?)`,
	).run(id, boardId, name, position, color ?? null, wipLimit ?? null);

	return db
		.prepare(`SELECT * FROM kanban_columns WHERE id = ?`)
		.get(id) as KanbanColumn;
}

function getColumnsForBoard(boardId: string): KanbanColumn[] {
	ensureTables();
	const db = getRawDb();
	const rows = db
		.prepare(
			`SELECT * FROM kanban_columns WHERE board_id = ? ORDER BY position ASC`,
		)
		.all(boardId) as ColumnRow[];
	return rows.map(mapColumn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Card operations
// ─────────────────────────────────────────────────────────────────────────────

export function createCard(
	boardId: string,
	columnId: string,
	title: string,
	opts: Partial<KanbanCard>,
	createdBy: string,
): KanbanCard {
	ensureTables();
	const db = getRawDb();
	const id = crypto.randomUUID();

	// Determine next position in column
	const maxPos = (
		db
			.prepare(
				`SELECT COALESCE(MAX(position), -1) as m FROM kanban_cards WHERE column_id = ?`,
			)
			.get(columnId) as { m: number }
	).m;

	db.prepare(
		`INSERT INTO kanban_cards (id, board_id, column_id, title, description, assignee, priority, labels, due_date, external_ref, position, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		id,
		boardId,
		columnId,
		title,
		opts.description ?? null,
		opts.assignee ?? null,
		opts.priority ?? "medium",
		JSON.stringify(opts.labels ?? []),
		opts.dueDate ? Math.floor(opts.dueDate.getTime() / 1000) : null,
		opts.externalRef ?? null,
		maxPos + 1,
		createdBy,
	);

	const row = db
		.prepare(`SELECT * FROM kanban_cards WHERE id = ?`)
		.get(id) as CardRow;
	return mapCard(row);
}

export function moveCard(
	cardId: string,
	toColumnId: string,
	toPosition: number,
): void {
	ensureTables();
	const db = getRawDb();
	db.prepare(
		`UPDATE kanban_cards SET column_id = ?, position = ?, updated_at = unixepoch() WHERE id = ?`,
	).run(toColumnId, toPosition, cardId);
}

export function updateCard(
	cardId: string,
	updates: Partial<
		Pick<
			KanbanCard,
			| "title"
			| "description"
			| "assignee"
			| "priority"
			| "labels"
			| "dueDate"
			| "externalRef"
		>
	>,
): KanbanCard {
	ensureTables();
	const db = getRawDb();
	const setParts: string[] = ["updated_at = unixepoch()"];
	const values: unknown[] = [];

	if (updates.title !== undefined) {
		setParts.push("title = ?");
		values.push(updates.title);
	}
	if (updates.description !== undefined) {
		setParts.push("description = ?");
		values.push(updates.description);
	}
	if (updates.assignee !== undefined) {
		setParts.push("assignee = ?");
		values.push(updates.assignee);
	}
	if (updates.priority !== undefined) {
		setParts.push("priority = ?");
		values.push(updates.priority);
	}
	if (updates.labels !== undefined) {
		setParts.push("labels = ?");
		values.push(JSON.stringify(updates.labels));
	}
	if (updates.dueDate !== undefined) {
		setParts.push("due_date = ?");
		values.push(
			updates.dueDate ? Math.floor(updates.dueDate.getTime() / 1000) : null,
		);
	}
	if (updates.externalRef !== undefined) {
		setParts.push("external_ref = ?");
		values.push(updates.externalRef);
	}

	values.push(cardId);
	db.prepare(`UPDATE kanban_cards SET ${setParts.join(", ")} WHERE id = ?`).run(
		...values,
	);

	const row = db
		.prepare(`SELECT * FROM kanban_cards WHERE id = ?`)
		.get(cardId) as CardRow;
	return mapCard(row);
}

export function deleteCard(cardId: string): void {
	ensureTables();
	const db = getRawDb();
	db.prepare(`DELETE FROM kanban_cards WHERE id = ?`).run(cardId);
}

export function getBoardWithCards(boardId: string): {
	board: KanbanBoard;
	columns: Array<KanbanColumn & { cards: KanbanCard[] }>;
} {
	ensureTables();
	const board = getBoard(boardId);
	if (!board) throw new Error(`Board not found: ${boardId}`);

	const columns = getColumnsForBoard(boardId);
	const db = getRawDb();

	const columnsWithCards = columns.map((col) => {
		const cardRows = db
			.prepare(
				`SELECT * FROM kanban_cards WHERE column_id = ? ORDER BY position ASC`,
			)
			.all(col.id) as CardRow[];
		return { ...col, cards: cardRows.map(mapCard) };
	});

	return { board, columns: columnsWithCards };
}
