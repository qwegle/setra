import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import type { Goal } from "../lib/api";
import { cn } from "../lib/utils";

interface GoalTreeProps {
	goals: Goal[];
	depth?: number;
	onStatusChange?: (id: string, status: Goal["status"]) => void;
	onAddChild?: (parentId: string) => void;
}

const STATUS_DOT: Record<Goal["status"], string> = {
	no_status: "bg-muted-foreground/40",
	on_track: "bg-accent-green",
	at_risk: "bg-accent-yellow",
	off_track: "bg-accent-red",
	done: "bg-setra-400",
};

const STATUS_LABEL: Record<Goal["status"], string> = {
	no_status: "No status",
	on_track: "On track",
	at_risk: "At risk",
	off_track: "Off track",
	done: "Done",
};

const STATUS_BADGE: Record<Goal["status"], string> = {
	no_status: "bg-muted/40 text-muted-foreground",
	on_track: "bg-accent-green/15 text-accent-green",
	at_risk: "bg-accent-yellow/15 text-accent-yellow",
	off_track: "bg-accent-red/15 text-accent-red",
	done: "bg-setra-600/15 text-setra-300",
};

const STATUSES: Goal["status"][] = [
	"no_status",
	"on_track",
	"at_risk",
	"off_track",
	"done",
];

function GoalNode({
	goal,
	depth,
	onStatusChange,
	onAddChild,
}: {
	goal: Goal;
	depth: number;
	onStatusChange?: (id: string, status: Goal["status"]) => void;
	onAddChild?: (parentId: string) => void;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [showStatusMenu, setShowStatusMenu] = useState(false);
	const hasChildren = goal.children && goal.children.length > 0;

	return (
		<div>
			<div
				className="group flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors cursor-default"
				style={{ paddingLeft: `${8 + depth * 20}px` }}
			>
				{/* Expand/collapse toggle */}
				<button
					onClick={() => hasChildren && setCollapsed((v) => !v)}
					className={cn(
						"w-4 h-4 shrink-0 flex items-center justify-center text-muted-foreground/50",
						hasChildren
							? "hover:text-foreground transition-colors"
							: "opacity-0 pointer-events-none",
					)}
				>
					{collapsed ? (
						<ChevronRight className="w-3.5 h-3.5" />
					) : (
						<ChevronDown className="w-3.5 h-3.5" />
					)}
				</button>

				{/* Status dot with dropdown */}
				<div className="relative">
					<button
						onClick={() => setShowStatusMenu((v) => !v)}
						className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform hover:scale-125"
						style={{ background: "transparent" }}
						title={STATUS_LABEL[goal.status]}
					>
						<span
							className={cn(
								"block w-2.5 h-2.5 rounded-full",
								STATUS_DOT[goal.status],
							)}
						/>
					</button>
					{showStatusMenu && (
						<div className="absolute z-20 left-0 top-5 bg-card border border-border/50 rounded-lg shadow-xl p-1 min-w-[140px]">
							{STATUSES.map((s) => (
								<button
									key={s}
									onClick={() => {
										onStatusChange?.(goal.id, s);
										setShowStatusMenu(false);
									}}
									className={cn(
										"flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-muted/50 transition-colors",
										goal.status === s
											? "font-medium text-foreground"
											: "text-muted-foreground",
									)}
								>
									<span
										className={cn(
											"w-2 h-2 rounded-full shrink-0",
											STATUS_DOT[s],
										)}
									/>
									{STATUS_LABEL[s]}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Title */}
				<span className="flex-1 text-sm text-foreground truncate">
					{goal.title}
				</span>

				{/* Status badge */}
				<span
					className={cn(
						"px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0",
						STATUS_BADGE[goal.status],
					)}
				>
					{STATUS_LABEL[goal.status]}
				</span>

				{/* Hover actions */}
				<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
					{onAddChild && (
						<button
							onClick={() => onAddChild(goal.id)}
							className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
						>
							<Plus className="w-3 h-3" />
							Add sub-goal
						</button>
					)}
					<button className="p-1 text-muted-foreground/50 hover:text-foreground rounded transition-colors">
						<MoreHorizontal className="w-3.5 h-3.5" />
					</button>
				</div>
			</div>

			{/* Children */}
			{hasChildren && !collapsed && (
				<div className="relative">
					<div
						className="absolute top-0 bottom-0 border-l border-border/50"
						style={{ left: `${16 + depth * 20}px` }}
					/>
					<GoalTree
						goals={goal.children!}
						depth={depth + 1}
						{...(onStatusChange ? { onStatusChange } : {})}
						{...(onAddChild ? { onAddChild } : {})}
					/>
				</div>
			)}
		</div>
	);
}

export function GoalTree({
	goals,
	depth = 0,
	onStatusChange,
	onAddChild,
}: GoalTreeProps) {
	return (
		<div className="space-y-0.5">
			{goals.map((goal) => (
				<GoalNode
					key={goal.id}
					goal={goal}
					depth={depth}
					{...(onStatusChange ? { onStatusChange } : {})}
					{...(onAddChild ? { onAddChild } : {})}
				/>
			))}
		</div>
	);
}
