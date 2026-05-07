/**
 * setra kanban <subcommand>
 *
 * Commands:
 *   setra kanban list
 *   setra kanban board <boardId>
 *   setra kanban add-card <boardId> --title "..." --priority high --ref JIRA-123
 *   setra kanban move <cardId> --to "In Progress"
 */

import { getDb, getRawDb } from "@setra/db/client.js";
import {
	createBoard,
	createCard,
	getBoardWithCards,
	listBoards,
	moveCard,
} from "@setra/db/kanban.js";

const COMPANY_SLUG = process.env["SETRA_COMPANY_SLUG"] ?? "default";

function ensureDb(): void {
	// Initialize DB (uses default path ~/.setra/setra.db)
	getDb();
}

// ─── setra kanban list ────────────────────────────────────────────────────────

export function runKanbanList(): void {
	ensureDb();
	const boards = listBoards(COMPANY_SLUG);

	if (boards.length === 0) {
		console.log("No boards found.");
		return;
	}

	console.log(`\n${"─".repeat(60)}`);
	console.log("  KANBAN BOARDS");
	console.log(`${"─".repeat(60)}`);
	for (const b of boards) {
		const date = b.createdAt.toISOString().slice(0, 10);
		console.log(`  ${b.id.slice(0, 8)}  ${b.name.padEnd(30)}  ${date}`);
		if (b.description) console.log(`           ${b.description}`);
	}
	console.log();
}

// ─── setra kanban board ───────────────────────────────────────────────────────

export function runKanbanBoard(boardId: string): void {
	ensureDb();
	const data = getBoardWithCards(boardId);

	console.log(`\n${data.board.name}`);
	if (data.board.description) console.log(`  ${data.board.description}`);
	console.log();

	for (const col of data.columns) {
		const wipInfo = col.wipLimit != null ? ` (WIP: ${col.wipLimit})` : "";
		console.log(`  ${col.name}${wipInfo} [${col.cards.length} cards]`);
		for (const card of col.cards) {
			const ref = card.externalRef ? ` [${card.externalRef}]` : "";
			const assignee = card.assignee ? ` @${card.assignee}` : "";
			console.log(
				`    ${card.id.slice(0, 8)}  [${card.priority.toUpperCase().padEnd(8)}]  ${card.title}${ref}${assignee}`,
			);
		}
		console.log();
	}
}

// ─── setra kanban add-card ────────────────────────────────────────────────────

export function runKanbanAddCard(
	boardId: string,
	opts: {
		title: string;
		priority?: string;
		ref?: string;
		column?: string;
		assignee?: string;
	},
): void {
	ensureDb();
	if (!opts.title) {
		console.error("--title is required");
		process.exit(1);
	}

	const data = getBoardWithCards(boardId);
	const colName = opts.column ?? "Backlog";
	const col = data.columns.find(
		(c) => c.name.toLowerCase() === colName.toLowerCase(),
	);
	if (!col) {
		console.error(`Column not found: ${colName}`);
		console.error(`Available: ${data.columns.map((c) => c.name).join(", ")}`);
		process.exit(1);
	}

	const card = createCard(
		boardId,
		col.id,
		opts.title,
		{
			priority:
				(opts.priority as "critical" | "high" | "medium" | "low") ?? "medium",
			externalRef: opts.ref ?? undefined,
			assignee: opts.assignee ?? undefined,
		},
		"cli",
	);

	console.log(`Created card ${card.id.slice(0, 8)} in "${col.name}"`);
	console.log(`  Title:    ${card.title}`);
	console.log(`  Priority: ${card.priority}`);
	if (card.externalRef) console.log(`  Ref:      ${card.externalRef}`);
}

// ─── setra kanban move ────────────────────────────────────────────────────────

export function runKanbanMove(cardId: string, opts: { to: string }): void {
	ensureDb();
	if (!opts.to) {
		console.error("--to is required");
		process.exit(1);
	}

	const db = getRawDb();

	// Find card to get boardId
	const cardRow = db
		.prepare(`SELECT board_id FROM kanban_cards WHERE id = ? OR id LIKE ?`)
		.get(cardId, `${cardId}%`) as { board_id: string } | undefined;
	if (!cardRow) {
		console.error(`Card not found: ${cardId}`);
		process.exit(1);
	}

	const colRow = db
		.prepare(`SELECT id FROM kanban_columns WHERE board_id = ? AND name = ?`)
		.get(cardRow.board_id, opts.to) as { id: string } | undefined;

	if (!colRow) {
		console.error(`Column not found: ${opts.to}`);
		process.exit(1);
	}

	const maxPos = (
		db
			.prepare(
				`SELECT COALESCE(MAX(position), -1) as m FROM kanban_cards WHERE column_id = ?`,
			)
			.get(colRow.id) as { m: number }
	).m;

	moveCard(cardId, colRow.id, maxPos + 1);
	console.log(`Moved card to "${opts.to}"`);
}
