import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	MouseSensor,
	TouchSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	AlertCircle,
	Ban,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Circle,
	Eye,
	Loader2,
	Minus,
	XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { Agent, Issue, IssueStatus } from "../lib/api";
import { cn } from "../lib/utils";

interface KanbanBoardProps {
	issues: Issue[];
	agents?: Agent[] | undefined;
	liveIssueIds?: Set<string> | undefined;
	onUpdateIssue: (id: string, data: Partial<Issue>) => void;
	onIssueClick: (id: string) => void;
}

const BOARD_STATUSES = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"blocked",
	"done",
	"cancelled",
] as const;

type BoardStatus = (typeof BOARD_STATUSES)[number];

const COLUMN_LABELS: Record<BoardStatus, string> = {
	backlog: "Backlog",
	todo: "Todo",
	in_progress: "In Progress",
	in_review: "In Review",
	blocked: "Blocked",
	done: "Done",
	cancelled: "Cancelled",
};

export function StatusIcon({
	status,
	className,
}: { status: string; className?: string }) {
	const config: Record<string, { icon: React.ElementType; color: string }> = {
		backlog: { icon: Circle, color: "text-muted-foreground/40" },
		todo: { icon: Circle, color: "text-muted-foreground" },
		in_progress: { icon: Loader2, color: "text-setra-400" },
		in_review: { icon: Eye, color: "text-purple-400" },
		blocked: { icon: Ban, color: "text-yellow-400" },
		done: { icon: CheckCircle2, color: "text-green-400" },
		cancelled: { icon: XCircle, color: "text-muted-foreground/40" },
	};
	const entry = config[status] ??
		config["backlog"] ?? { icon: Circle, color: "text-muted-foreground/40" };
	const { icon: Icon, color } = entry;
	return <Icon className={cn("w-3.5 h-3.5", color, className)} />;
}

export function PriorityIcon({
	priority,
	className,
}: { priority: string; className?: string }) {
	const config: Record<string, { icon: React.ElementType; color: string }> = {
		urgent: { icon: AlertCircle, color: "text-red-400" },
		high: { icon: ChevronUp, color: "text-orange-400" },
		medium: { icon: Minus, color: "text-yellow-400" },
		low: { icon: ChevronDown, color: "text-muted-foreground" },
		none: { icon: Minus, color: "text-muted-foreground/40" },
	};
	const entry = config[priority] ??
		config["none"] ?? { icon: Minus, color: "text-muted-foreground/40" };
	const { icon: Icon, color } = entry;
	return <Icon className={cn("w-3.5 h-3.5", color, className)} />;
}

function AgentAvatar({ name }: { name: string }) {
	const initials = name.slice(0, 2).toUpperCase();
	return (
		<div className="w-[28px] h-[28px] rounded-full bg-setra-600 flex items-center justify-center shrink-0">
			<span className="text-[10px] font-mono font-medium text-[#2b2418]">
				{initials}
			</span>
		</div>
	);
}

interface KanbanCardProps {
	issue: Issue;
	agents?: Agent[] | undefined;
	liveIssueIds?: Set<string> | undefined;
	onClick?: () => void;
	isOverlay?: boolean;
	isDragging?: boolean;
}

function KanbanCard({
	issue,
	agents,
	liveIssueIds,
	onClick,
	isOverlay,
	isDragging,
}: KanbanCardProps) {
	const agent = issue.assignedAgentId
		? agents?.find((a) => a.id === issue.assignedAgentId)
		: null;
	const isLive = liveIssueIds?.has(issue.id) ?? false;
	const identifier = issue.identifier ?? issue.slug;

	return (
		<div
			onClick={onClick}
			className={cn(
				"rounded-md border border-border/50 bg-card p-2.5 cursor-grab transition-all",
				isOverlay && "shadow-2xl ring-2 ring-setra-500/40 cursor-grabbing",
				isDragging && "opacity-30",
				!isOverlay && !isDragging && "hover:shadow-md hover:border-border/80",
			)}
		>
			{/* Header row */}
			<div className="flex items-center gap-1.5 mb-1.5">
				<span className="text-[10px] font-mono text-muted-foreground/60 leading-none">
					{identifier}
				</span>
				{isLive && (
					<span className="w-1.5 h-1.5 rounded-full bg-setra-400 animate-pulse shrink-0" />
				)}
			</div>

			{/* Title */}
			<p className="text-xs leading-snug line-clamp-2 text-foreground mb-2">
				{issue.title}
			</p>

			{/* Footer */}
			<div className="flex items-center justify-between">
				<PriorityIcon priority={issue.priority} />
				{agent ? (
					<AgentAvatar name={agent.slug} />
				) : issue.assignedAgentId ? (
					<AgentAvatar name={issue.assignedAgentId} />
				) : null}
			</div>
		</div>
	);
}

function DraggableCard({
	issue,
	agents,
	liveIssueIds,
	onIssueClick,
	activeId,
}: {
	issue: Issue;
	agents?: Agent[] | undefined;
	liveIssueIds?: Set<string> | undefined;
	onIssueClick: (id: string) => void;
	activeId: string | null;
}) {
	const { attributes, listeners, setNodeRef, transform } = useDraggable({
		id: issue.id,
	});

	const style = transform
		? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
		: undefined;

	return (
		<div ref={setNodeRef} style={style} {...listeners} {...attributes}>
			<KanbanCard
				issue={issue}
				agents={agents}
				liveIssueIds={liveIssueIds}
				onClick={() => onIssueClick(issue.id)}
				isDragging={activeId === issue.id}
			/>
		</div>
	);
}

function KanbanColumn({
	status,
	issues,
	agents,
	liveIssueIds,
	onIssueClick,
	activeId,
}: {
	status: BoardStatus;
	issues: Issue[];
	agents?: Agent[] | undefined;
	liveIssueIds?: Set<string> | undefined;
	onIssueClick: (id: string) => void;
	activeId: string | null;
}) {
	const isEmpty = issues.length === 0;
	const { setNodeRef, isOver } = useDroppable({ id: `col-${status}` });

	if (isEmpty) {
		return (
			<div
				ref={setNodeRef}
				className={cn(
					"flex flex-col items-center justify-start pt-3 rounded-xl border border-border/40 transition-colors min-w-[48px] w-[48px] shrink-0",
					isOver ? "bg-setra-600/10 border-setra-600/40" : "bg-card/30",
				)}
				style={{ minHeight: 120 }}
			>
				<span
					className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 writing-mode-vertical"
					style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
				>
					{COLUMN_LABELS[status]}
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
			{/* Column header */}
			<div className="flex items-center gap-2 px-1 mb-2">
				<StatusIcon status={status} />
				<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{COLUMN_LABELS[status]}
				</span>
				<span className="text-xs text-muted-foreground/50 tabular-nums ml-auto">
					{issues.length}
				</span>
			</div>

			{/* Drop zone */}
			<div
				ref={setNodeRef}
				className={cn(
					"flex-1 space-y-2 rounded-xl p-2 transition-colors min-h-[60px]",
					isOver
						? "bg-setra-600/10 border border-setra-600/30"
						: "border border-transparent",
				)}
			>
				{issues.map((issue) => (
					<DraggableCard
						key={issue.id}
						issue={issue}
						agents={agents}
						liveIssueIds={liveIssueIds}
						onIssueClick={onIssueClick}
						activeId={activeId}
					/>
				))}
			</div>
		</div>
	);
}

export function KanbanBoard({
	issues,
	agents,
	liveIssueIds,
	onUpdateIssue,
	onIssueClick,
}: KanbanBoardProps) {
	const [activeId, setActiveId] = useState<string | null>(null);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 250, tolerance: 5 },
		}),
	);

	const activeIssue = activeId ? issues.find((i) => i.id === activeId) : null;

	const handleDragStart = useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	}, []);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			setActiveId(null);
			const { active, over } = event;
			if (!over) return;

			const draggedId = active.id as string;
			let targetStatus: IssueStatus | null = null;

			// Dropped on a column droppable
			const overId = over.id as string;
			if (overId.startsWith("col-")) {
				targetStatus = overId.slice(4) as IssueStatus;
			} else {
				// Dropped on another card — use that card's status
				const targetIssue = issues.find((i) => i.id === overId);
				if (targetIssue) targetStatus = targetIssue.status;
			}

			if (targetStatus) {
				const dragged = issues.find((i) => i.id === draggedId);
				if (dragged && dragged.status !== targetStatus) {
					onUpdateIssue(draggedId, { status: targetStatus });
				}
			}
		},
		[issues, onUpdateIssue],
	);

	return (
		<DndContext
			sensors={sensors}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
		>
			<div className="flex gap-3 overflow-x-auto p-4 flex-1 items-start">
				{BOARD_STATUSES.map((status) => (
					<KanbanColumn
						key={status}
						status={status}
						issues={issues.filter((i) => (i.status as string) === status)}
						agents={agents}
						liveIssueIds={liveIssueIds}
						onIssueClick={onIssueClick}
						activeId={activeId}
					/>
				))}
			</div>

			<DragOverlay dropAnimation={null}>
				{activeIssue ? (
					<KanbanCard
						issue={activeIssue}
						agents={agents}
						liveIssueIds={liveIssueIds}
						isOverlay
					/>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
