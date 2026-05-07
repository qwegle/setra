import { getDb, runMigrations } from "@setra/db";
import {
	createBoard,
	createCard,
	getBoardWithCards,
	listBoards,
	moveCard,
} from "@setra/db/kanban.js";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useEffect, useMemo, useState } from "react";

const COMPANY_SLUG = process.env["SETRA_COMPANY_SLUG"] ?? "default";
const COLUMN_ORDER = ["Backlog", "In Progress", "Done"] as const;

type TaskCard = {
	id: string;
	title: string;
	description?: string | null;
	assignee?: string | null;
	priority: string;
};

type TaskColumn = {
	id: string;
	name: string;
	cards: TaskCard[];
};

export function TasksView(props: {
	active: boolean;
	onInputLockChange?: (locked: boolean) => void;
}) {
	const [boardId, setBoardId] = useState<string | null>(null);
	const [columns, setColumns] = useState<TaskColumn[]>([]);
	const [selectedColumn, setSelectedColumn] = useState(0);
	const [selectedCard, setSelectedCard] = useState(0);
	const [creating, setCreating] = useState(false);
	const [draft, setDraft] = useState("");
	const [showDetails, setShowDetails] = useState(false);

	const refresh = useCallback(async () => {
		await runMigrations();
		getDb();
		const board = listBoards(COMPANY_SLUG)[0] ?? null;
		if (!board) {
			setBoardId(null);
			setColumns([]);
			return;
		}
		setBoardId(board.id);
		const data = getBoardWithCards(board.id);
		const nextColumns = COLUMN_ORDER.map((name) => {
			const column = data.columns.find(
				(entry) => entry.name.toLowerCase() === name.toLowerCase(),
			);
			return {
				id: column?.id ?? `${name.toLowerCase()}-missing`,
				name,
				cards:
					column?.cards.map((card) => ({
						id: card.id,
						title: card.title,
						description: card.description,
						assignee: card.assignee,
						priority: card.priority,
					})) ?? [],
			};
		});
		setColumns(nextColumns);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		props.onInputLockChange?.(creating);
	}, [creating, props]);

	const selectedTask = useMemo(() => {
		const column = columns[selectedColumn];
		return column?.cards[selectedCard] ?? null;
	}, [columns, selectedCard, selectedColumn]);

	useInput((input, key) => {
		if (!props.active) return;

		if (creating) {
			if (key.escape) {
				setCreating(false);
				setDraft("");
				return;
			}
			if (key.return) {
				void createTask(draft);
				return;
			}
			if (key.backspace || key.delete) {
				setDraft((value) => value.slice(0, -1));
				return;
			}
			if (input && !key.ctrl && !key.meta) {
				setDraft((value) => value + input);
			}
			return;
		}

		if (key.leftArrow) {
			setSelectedColumn((value) => Math.max(0, value - 1));
			setSelectedCard(0);
			return;
		}
		if (key.rightArrow) {
			setSelectedColumn((value) => Math.min(columns.length - 1, value + 1));
			setSelectedCard(0);
			return;
		}
		if (key.upArrow) {
			setSelectedCard((value) => Math.max(0, value - 1));
			return;
		}
		if (key.downArrow) {
			const max = Math.max(0, (columns[selectedColumn]?.cards.length ?? 1) - 1);
			setSelectedCard((value) => Math.min(max, value + 1));
			return;
		}
		if (key.return) {
			setShowDetails((value) => !value);
			return;
		}
		if (input === "n") {
			setCreating(true);
			setDraft("");
			return;
		}
		if (input === "m") {
			void moveSelectedTask();
		}
	});

	async function createTask(title: string) {
		const cleanTitle = title.trim();
		if (!cleanTitle) return;
		await runMigrations();
		getDb();
		let nextBoardId = boardId;
		if (!nextBoardId) {
			nextBoardId = createBoard(
				COMPANY_SLUG,
				"Tasks",
				"Default task board",
				"tui",
			).id;
			setBoardId(nextBoardId);
		}
		const data = getBoardWithCards(nextBoardId);
		const targetName = columns[selectedColumn]?.name ?? "Backlog";
		const targetColumn = data.columns.find(
			(column) => column.name.toLowerCase() === targetName.toLowerCase(),
		);
		if (!targetColumn) return;
		createCard(
			nextBoardId,
			targetColumn.id,
			cleanTitle,
			{ priority: "medium" },
			"tui",
		);
		setCreating(false);
		setDraft("");
		await refresh();
	}

	async function moveSelectedTask() {
		const column = columns[selectedColumn];
		const task = column?.cards[selectedCard];
		if (!boardId || !column || !task) return;
		const data = getBoardWithCards(boardId);
		const currentIndex = COLUMN_ORDER.findIndex(
			(name) => name.toLowerCase() === column.name.toLowerCase(),
		);
		const nextName =
			COLUMN_ORDER[(currentIndex + 1) % COLUMN_ORDER.length] ?? "Backlog";
		const targetColumn = data.columns.find(
			(entry) => entry.name.toLowerCase() === nextName.toLowerCase(),
		);
		if (!targetColumn) return;
		moveCard(task.id, targetColumn.id, targetColumn.cards.length);
		setShowDetails(false);
		await refresh();
	}

	if (columns.length === 0) {
		return (
			<Box flexDirection="column" paddingY={1}>
				<Text color="gray">No tasks yet.</Text>
				<Text color="gray">Press n to create your first task.</Text>
				{creating && <Text color="cyan">New task: {draft || "_"}</Text>}
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width="100%">
			<Box flexDirection="row" gap={1}>
				{columns.map((column, columnIndex) => (
					<Box
						key={column.id}
						flexDirection="column"
						flexGrow={1}
						borderStyle="single"
						borderColor={
							selectedColumn === columnIndex && props.active ? "blue" : "gray"
						}
						paddingX={1}
					>
						<Text
							bold
							color={selectedColumn === columnIndex ? "blue" : "white"}
						>
							{column.name} ({column.cards.length})
						</Text>
						{column.cards.length === 0 ? (
							<Text color="gray">No tasks</Text>
						) : (
							column.cards.slice(0, 8).map((task, taskIndex) => (
								<Text
									key={task.id}
									backgroundColor={
										selectedColumn === columnIndex && selectedCard === taskIndex
											? "blue"
											: undefined
									}
									color={
										selectedColumn === columnIndex && selectedCard === taskIndex
											? "white"
											: "white"
									}
								>
									{taskIndex === selectedCard && selectedColumn === columnIndex
										? "▸ "
										: "  "}
									{task.title}
								</Text>
							))
						)}
					</Box>
				))}
			</Box>

			{creating && (
				<Box marginTop={1}>
					<Text color="cyan">New task: {draft || "_"}</Text>
				</Box>
			)}

			{showDetails && selectedTask && (
				<Box
					flexDirection="column"
					marginTop={1}
					borderStyle="single"
					borderColor="gray"
					paddingX={1}
				>
					<Text bold>{selectedTask.title}</Text>
					<Text color="gray">Priority: {selectedTask.priority}</Text>
					<Text color="gray">
						Assignee: {selectedTask.assignee ?? "unassigned"}
					</Text>
					<Text>{selectedTask.description ?? "No details yet."}</Text>
				</Box>
			)}

			<Box marginTop={1}>
				<Text color="gray">
					←/→ columns · ↑/↓ tasks · Enter details · n new · m move
				</Text>
			</Box>
		</Box>
	);
}
