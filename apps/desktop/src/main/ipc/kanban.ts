/**
 * kanban.ts — IPC handlers for the kanban board
 */

import { getRawDb } from "@setra/db/client.js";
import {
	createBoard,
	createCard,
	createColumn,
	deleteCard,
	getBoard,
	getBoardWithCards,
	listBoards,
	moveCard,
	updateCard,
} from "@setra/db/kanban.js";
import type { KanbanCard } from "@setra/db/kanban.js";
import { ipcMain } from "electron";

function getCompanySlug(): string {
	return process.env["SETRA_COMPANY_SLUG"] ?? "default";
}

export function registerKanbanHandlers(): void {
	// kanban:list-boards
	ipcMain.handle("kanban:list-boards", () => {
		return listBoards(getCompanySlug());
	});

	// kanban:create-board
	ipcMain.handle(
		"kanban:create-board",
		(_event, name: string, description = "", createdBy = "human") => {
			return createBoard(getCompanySlug(), name, description, createdBy);
		},
	);

	// kanban:get-board — full board with columns and cards
	ipcMain.handle("kanban:get-board", (_event, boardId: string) => {
		return getBoardWithCards(boardId);
	});

	// kanban:create-card
	ipcMain.handle(
		"kanban:create-card",
		(
			_event,
			boardId: string,
			columnId: string,
			title: string,
			priority: KanbanCard["priority"] = "medium",
			opts: Partial<KanbanCard> = {},
			createdBy = "human",
		) => {
			return createCard(
				boardId,
				columnId,
				title,
				{ ...opts, priority },
				createdBy,
			);
		},
	);

	// kanban:move-card
	ipcMain.handle(
		"kanban:move-card",
		(_event, cardId: string, toColumnId: string, toPosition?: number) => {
			const db = getRawDb();
			const maxPos = (
				db
					.prepare(
						`SELECT COALESCE(MAX(position), -1) as m FROM kanban_cards WHERE column_id = ?`,
					)
					.get(toColumnId) as { m: number }
			).m;
			moveCard(cardId, toColumnId, toPosition ?? maxPos + 1);
			return { ok: true };
		},
	);

	// kanban:update-card
	ipcMain.handle(
		"kanban:update-card",
		(
			_event,
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
		) => {
			return updateCard(cardId, updates);
		},
	);

	// kanban:delete-card
	ipcMain.handle("kanban:delete-card", (_event, cardId: string) => {
		deleteCard(cardId);
		return { ok: true };
	});

	// kanban:create-column
	ipcMain.handle(
		"kanban:create-column",
		(
			_event,
			boardId: string,
			name: string,
			position: number,
			color?: string,
			wipLimit?: number,
		) => {
			return createColumn(boardId, name, position, color, wipLimit);
		},
	);
}
