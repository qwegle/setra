/**
 * kanban-tools.ts — MCP tool definitions and executor for the kanban board
 */

import type { McpToolDefinition } from "./db-tools.js";

export const KANBAN_TOOLS: McpToolDefinition[] = [
	{
		name: "kanban_list_boards",
		description: "List all kanban boards for the current company.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "kanban_create_card",
		description: "Create a new kanban card on a board.",
		inputSchema: {
			type: "object",
			properties: {
				boardId: { type: "string", description: "Board ID" },
				title: { type: "string", description: "Card title" },
				description: {
					type: "string",
					description: "Optional card description",
				},
				priority: {
					type: "string",
					description: "Priority: critical, high, medium, or low",
				},
				columnName: {
					type: "string",
					description:
						"Column name, e.g. 'Backlog', 'In Progress', 'Review', 'Done'",
				},
				assignee: {
					type: "string",
					description: "Agent slug to assign (optional)",
				},
				externalRef: {
					type: "string",
					description: "External reference, e.g. JIRA-123 or GH-456 (optional)",
				},
			},
			required: ["boardId", "title", "columnName"],
		},
	},
	{
		name: "kanban_move_card",
		description: "Move a card to a different column.",
		inputSchema: {
			type: "object",
			properties: {
				cardId: { type: "string", description: "Card ID" },
				toColumn: {
					type: "string",
					description: "Target column name, e.g. 'In Progress'",
				},
			},
			required: ["cardId", "toColumn"],
		},
	},
	{
		name: "kanban_update_card",
		description:
			"Update card title, description, priority, assignee, or labels.",
		inputSchema: {
			type: "object",
			properties: {
				cardId: { type: "string", description: "Card ID" },
				updates: {
					type: "string",
					description:
						"JSON object with fields to update: title, description, priority, assignee, labels, externalRef",
				},
			},
			required: ["cardId", "updates"],
		},
	},
	{
		name: "kanban_view_board",
		description: "Get the full board with all columns and cards.",
		inputSchema: {
			type: "object",
			properties: {
				boardId: { type: "string", description: "Board ID" },
			},
			required: ["boardId"],
		},
	},
];

export async function executeKanbanTool(
	toolName: string,
	params: Record<string, unknown>,
	companySlug: string,
): Promise<string> {
	const { listBoards, getBoardWithCards, createCard, moveCard, updateCard } =
		await import("@setra/db/kanban.js");

	const { getRawDb } = await import("@setra/db/client.js");

	switch (toolName) {
		case "kanban_list_boards": {
			const boards = listBoards(companySlug);
			return JSON.stringify(boards);
		}

		case "kanban_create_card": {
			const boardId = params["boardId"] as string;
			const title = params["title"] as string;
			const columnName = params["columnName"] as string;
			if (!boardId || !title || !columnName) {
				return JSON.stringify({
					error: "boardId, title, and columnName are required",
				});
			}

			const db = getRawDb();
			const colRow = db
				.prepare(
					`SELECT id FROM kanban_columns WHERE board_id = ? AND name = ?`,
				)
				.get(boardId, columnName) as { id: string } | undefined;

			if (!colRow) {
				return JSON.stringify({ error: `Column not found: ${columnName}` });
			}

			const opts: Record<string, unknown> = {
				priority:
					(params["priority"] as "critical" | "high" | "medium" | "low") ||
					"medium",
			};
			if (params["description"])
				opts.description = params["description"] as string;
			if (params["assignee"]) opts.assignee = params["assignee"] as string;
			if (params["externalRef"])
				opts.externalRef = params["externalRef"] as string;

			const card = createCard(
				boardId,
				colRow.id,
				title,
				opts as Parameters<typeof createCard>[3],
				"agent",
			);
			return JSON.stringify(card);
		}

		case "kanban_move_card": {
			const cardId = params["cardId"] as string;
			const toColumn = params["toColumn"] as string;
			if (!cardId || !toColumn) {
				return JSON.stringify({ error: "cardId and toColumn are required" });
			}

			const db = getRawDb();
			const cardRow = db
				.prepare(`SELECT board_id FROM kanban_cards WHERE id = ?`)
				.get(cardId) as { board_id: string } | undefined;

			if (!cardRow)
				return JSON.stringify({ error: `Card not found: ${cardId}` });

			const colRow = db
				.prepare(
					`SELECT id FROM kanban_columns WHERE board_id = ? AND name = ?`,
				)
				.get(cardRow.board_id, toColumn) as { id: string } | undefined;

			if (!colRow)
				return JSON.stringify({ error: `Column not found: ${toColumn}` });

			const maxPos = (
				db
					.prepare(
						`SELECT COALESCE(MAX(position), -1) as m FROM kanban_cards WHERE column_id = ?`,
					)
					.get(colRow.id) as { m: number }
			).m;

			moveCard(cardId, colRow.id, maxPos + 1);
			return JSON.stringify({ ok: true });
		}

		case "kanban_update_card": {
			const cardId = params["cardId"] as string;
			const updatesRaw = params["updates"] as string;
			if (!cardId || !updatesRaw) {
				return JSON.stringify({ error: "cardId and updates are required" });
			}

			let updates: Record<string, unknown>;
			try {
				updates = JSON.parse(updatesRaw) as Record<string, unknown>;
			} catch {
				return JSON.stringify({ error: "updates must be a valid JSON object" });
			}

			const card = updateCard(
				cardId,
				updates as Parameters<typeof updateCard>[1],
			);
			return JSON.stringify(card);
		}

		case "kanban_view_board": {
			const boardId = params["boardId"] as string;
			if (!boardId) return JSON.stringify({ error: "boardId is required" });
			const result = getBoardWithCards(boardId);
			return JSON.stringify(result);
		}

		default:
			return JSON.stringify({ error: `Unknown kanban tool: ${toolName}` });
	}
}
