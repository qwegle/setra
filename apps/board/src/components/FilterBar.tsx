import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	Agent,
	IssuePriority,
	IssueStatus,
	LifecycleStage,
	Project,
} from "../lib/api";
import { cn } from "../lib/utils";

export interface FilterState {
	status: IssueStatus[];
	priority: IssuePriority[];
	assignedAgentId: string | null;
	projectId: string | null;
	labels: string[];
	search: string;
	lifecycle: LifecycleStage[];
}

export const EMPTY_FILTERS: FilterState = {
	status: [],
	priority: [],
	assignedAgentId: null,
	projectId: null,
	labels: [],
	search: "",
	lifecycle: [],
};

export function isFiltersActive(f: FilterState): boolean {
	return (
		f.status.length > 0 ||
		f.priority.length > 0 ||
		f.assignedAgentId !== null ||
		f.projectId !== null ||
		f.labels.length > 0 ||
		f.lifecycle.length > 0 ||
		f.search.trim() !== ""
	);
}

interface FilterBarProps {
	filters: FilterState;
	onChange: (f: FilterState) => void;
	agents?: Agent[] | undefined;
	projects?: Project[] | undefined;
	className?: string;
}

const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
	{ value: "backlog", label: "Backlog" },
	{ value: "todo", label: "Todo" },
	{ value: "in_progress", label: "In Progress" },
	{ value: "in_review", label: "In Review" },
	{ value: "blocked", label: "Blocked" },
	{ value: "done", label: "Done" },
	{ value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS: { value: IssuePriority; label: string }[] = [
	{ value: "urgent", label: "Urgent" },
	{ value: "high", label: "High" },
	{ value: "medium", label: "Medium" },
	{ value: "low", label: "Low" },
	{ value: "none", label: "None" },
];

const LIFECYCLE_OPTIONS: { value: LifecycleStage; label: string }[] = [
	{ value: "backlog", label: "Backlog" },
	{ value: "branched", label: "Branched" },
	{ value: "committed", label: "Committed" },
	{ value: "pr_open", label: "PR Open" },
	{ value: "in_review", label: "In Review" },
	{ value: "merged", label: "Merged" },
	{ value: "deployed", label: "Deployed" },
	{ value: "verified", label: "Verified" },
	{ value: "cancelled", label: "Cancelled" },
];

function Popover({
	trigger,
	children,
	className,
}: {
	trigger: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handler(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		}
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, []);

	return (
		<div ref={ref} className="relative">
			<div onClick={() => setOpen((v) => !v)}>{trigger}</div>
			{open && (
				<div
					className={cn(
						"absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-lg border border-border/50 bg-card shadow-xl py-1",
						className,
					)}
				>
					{children}
				</div>
			)}
		</div>
	);
}

function StatusFilter({
	filters,
	onChange,
}: { filters: FilterState; onChange: (f: FilterState) => void }) {
	const active = filters.status.length > 0;

	function toggle(v: IssueStatus) {
		const next = filters.status.includes(v)
			? filters.status.filter((s) => s !== v)
			: [...filters.status, v];
		onChange({ ...filters, status: next });
	}

	const trigger = active ? (
		<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-setra-600/15 border border-setra-600/30 text-setra-300 text-xs cursor-pointer hover:bg-setra-600/25 transition-colors">
			<span>
				Status:{" "}
				{filters.status
					.map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label)
					.join(", ")}
			</span>
			<X
				className="w-3 h-3 shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onChange({ ...filters, status: [] });
				}}
			/>
		</div>
	) : (
		<div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted-foreground text-xs cursor-pointer hover:bg-muted/50 border border-border/40 transition-colors">
			Status <ChevronDown className="w-3 h-3" />
		</div>
	);

	return (
		<Popover trigger={trigger}>
			{STATUS_OPTIONS.map((opt) => (
				<button
					key={opt.value}
					onClick={() => toggle(opt.value)}
					className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
				>
					<div
						className={cn(
							"w-3.5 h-3.5 rounded border border-border/60 shrink-0 flex items-center justify-center",
							filters.status.includes(opt.value) &&
								"bg-setra-600 border-setra-500",
						)}
					>
						{filters.status.includes(opt.value) && (
							<div className="w-1.5 h-1.5 rounded-sm bg-white" />
						)}
					</div>
					{opt.label}
				</button>
			))}
		</Popover>
	);
}

function PriorityFilter({
	filters,
	onChange,
}: { filters: FilterState; onChange: (f: FilterState) => void }) {
	const active = filters.priority.length > 0;

	function toggle(v: IssuePriority) {
		const next = filters.priority.includes(v)
			? filters.priority.filter((p) => p !== v)
			: [...filters.priority, v];
		onChange({ ...filters, priority: next });
	}

	const trigger = active ? (
		<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-setra-600/15 border border-setra-600/30 text-setra-300 text-xs cursor-pointer hover:bg-setra-600/25 transition-colors">
			<span>
				Priority:{" "}
				{filters.priority
					.map((p) => PRIORITY_OPTIONS.find((o) => o.value === p)?.label)
					.join(", ")}
			</span>
			<X
				className="w-3 h-3 shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onChange({ ...filters, priority: [] });
				}}
			/>
		</div>
	) : (
		<div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted-foreground text-xs cursor-pointer hover:bg-muted/50 border border-border/40 transition-colors">
			Priority <ChevronDown className="w-3 h-3" />
		</div>
	);

	return (
		<Popover trigger={trigger}>
			{PRIORITY_OPTIONS.map((opt) => (
				<button
					key={opt.value}
					onClick={() => toggle(opt.value)}
					className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
				>
					<div
						className={cn(
							"w-3.5 h-3.5 rounded border border-border/60 shrink-0 flex items-center justify-center",
							filters.priority.includes(opt.value) &&
								"bg-setra-600 border-setra-500",
						)}
					>
						{filters.priority.includes(opt.value) && (
							<div className="w-1.5 h-1.5 rounded-sm bg-white" />
						)}
					</div>
					{opt.label}
				</button>
			))}
		</Popover>
	);
}

function AssigneeFilter({
	filters,
	onChange,
	agents = [],
}: {
	filters: FilterState;
	onChange: (f: FilterState) => void;
	agents?: Agent[];
}) {
	const active = filters.assignedAgentId !== null;
	const selected = active
		? agents.find((a) => a.id === filters.assignedAgentId)
		: null;
	const label = selected ? selected.slug : "Assignee";

	const trigger = active ? (
		<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-setra-600/15 border border-setra-600/30 text-setra-300 text-xs cursor-pointer hover:bg-setra-600/25 transition-colors">
			<span>Assignee: {label}</span>
			<X
				className="w-3 h-3 shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onChange({ ...filters, assignedAgentId: null });
				}}
			/>
		</div>
	) : (
		<div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted-foreground text-xs cursor-pointer hover:bg-muted/50 border border-border/40 transition-colors">
			Assignee <ChevronDown className="w-3 h-3" />
		</div>
	);

	return (
		<Popover trigger={trigger}>
			<button
				onClick={() => onChange({ ...filters, assignedAgentId: null })}
				className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors text-muted-foreground"
			>
				Unassigned
			</button>
			{agents.map((agent) => (
				<button
					key={agent.id}
					onClick={() => onChange({ ...filters, assignedAgentId: agent.id })}
					className={cn(
						"flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors",
						filters.assignedAgentId === agent.id && "text-setra-300",
					)}
				>
					<div
						className={cn(
							"w-1.5 h-1.5 rounded-full shrink-0",
							agent.status === "running"
								? "bg-accent-green"
								: agent.status === "error"
									? "bg-accent-red"
									: "bg-muted-foreground/40",
						)}
					/>
					{agent.slug}
				</button>
			))}
		</Popover>
	);
}

function ProjectFilter({
	filters,
	onChange,
	projects = [],
}: {
	filters: FilterState;
	onChange: (f: FilterState) => void;
	projects?: Project[];
}) {
	const active = filters.projectId !== null;
	const selected = active
		? projects.find((p) => p.id === filters.projectId)
		: null;

	const trigger = active ? (
		<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-setra-600/15 border border-setra-600/30 text-setra-300 text-xs cursor-pointer hover:bg-setra-600/25 transition-colors">
			<span>Project: {selected?.name ?? filters.projectId}</span>
			<X
				className="w-3 h-3 shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onChange({ ...filters, projectId: null });
				}}
			/>
		</div>
	) : (
		<div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted-foreground text-xs cursor-pointer hover:bg-muted/50 border border-border/40 transition-colors">
			Project <ChevronDown className="w-3 h-3" />
		</div>
	);

	return (
		<Popover trigger={trigger}>
			{projects.map((project) => (
				<button
					key={project.id}
					onClick={() => onChange({ ...filters, projectId: project.id })}
					className={cn(
						"flex w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors",
						filters.projectId === project.id && "text-setra-300",
					)}
				>
					{project.name}
				</button>
			))}
		</Popover>
	);
}

function LabelsFilter({
	filters,
	onChange,
}: { filters: FilterState; onChange: (f: FilterState) => void }) {
	const [inputVal, setInputVal] = useState("");
	const active = filters.labels.length > 0;

	function addLabel(label: string) {
		const trimmed = label.trim();
		if (!trimmed || filters.labels.includes(trimmed)) return;
		onChange({ ...filters, labels: [...filters.labels, trimmed] });
		setInputVal("");
	}

	function removeLabel(label: string) {
		onChange({ ...filters, labels: filters.labels.filter((l) => l !== label) });
	}

	const trigger = active ? (
		<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-setra-600/15 border border-setra-600/30 text-setra-300 text-xs cursor-pointer hover:bg-setra-600/25 transition-colors">
			<span>Labels: {filters.labels.join(", ")}</span>
			<X
				className="w-3 h-3 shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onChange({ ...filters, labels: [] });
				}}
			/>
		</div>
	) : (
		<div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted-foreground text-xs cursor-pointer hover:bg-muted/50 border border-border/40 transition-colors">
			Labels <ChevronDown className="w-3 h-3" />
		</div>
	);

	return (
		<Popover trigger={trigger} className="min-w-[200px]">
			<div className="px-3 py-2 border-b border-border/40">
				<input
					value={inputVal}
					onChange={(e) => setInputVal(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === ",") {
							e.preventDefault();
							addLabel(inputVal);
						}
					}}
					placeholder="Add label, press Enter"
					className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
				/>
			</div>
			{filters.labels.length > 0 && (
				<div className="px-3 py-2 flex flex-wrap gap-1">
					{filters.labels.map((l) => (
						<span
							key={l}
							className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-muted/50 border border-border/40 text-[10px] text-muted-foreground"
						>
							{l}
							<button
								onClick={() => removeLabel(l)}
								className="hover:text-foreground ml-0.5"
							>
								<X className="w-2.5 h-2.5" />
							</button>
						</span>
					))}
				</div>
			)}
		</Popover>
	);
}

function LifecycleFilter({
	filters,
	onChange,
}: { filters: FilterState; onChange: (f: FilterState) => void }) {
	const active = filters.lifecycle.length > 0;

	function toggle(v: LifecycleStage) {
		const next = filters.lifecycle.includes(v)
			? filters.lifecycle.filter((s) => s !== v)
			: [...filters.lifecycle, v];
		onChange({ ...filters, lifecycle: next });
	}

	const trigger = active ? (
		<div className="flex items-center gap-1 px-2 py-1 rounded-md bg-setra-600/15 border border-setra-600/30 text-setra-300 text-xs cursor-pointer hover:bg-setra-600/25 transition-colors">
			<span>
				Lifecycle:{" "}
				{filters.lifecycle
					.map((s) => LIFECYCLE_OPTIONS.find((o) => o.value === s)?.label)
					.join(", ")}
			</span>
			<X
				className="w-3 h-3 shrink-0 hover:text-foreground"
				onClick={(e) => {
					e.stopPropagation();
					onChange({ ...filters, lifecycle: [] });
				}}
			/>
		</div>
	) : (
		<div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-muted-foreground text-xs cursor-pointer hover:bg-muted/50 border border-border/40 transition-colors">
			Lifecycle <ChevronDown className="w-3 h-3" />
		</div>
	);

	return (
		<Popover trigger={trigger}>
			{LIFECYCLE_OPTIONS.map((opt) => (
				<button
					key={opt.value}
					onClick={() => toggle(opt.value)}
					className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
				>
					<div
						className={cn(
							"w-3.5 h-3.5 rounded border border-border/60 shrink-0 flex items-center justify-center",
							filters.lifecycle.includes(opt.value) &&
								"bg-setra-600 border-setra-500",
						)}
					>
						{filters.lifecycle.includes(opt.value) && (
							<div className="w-1.5 h-1.5 rounded-sm bg-white" />
						)}
					</div>
					{opt.label}
				</button>
			))}
		</Popover>
	);
}

export function FilterBar({
	filters,
	onChange,
	agents,
	projects,
	className,
}: FilterBarProps) {
	const anyActive = isFiltersActive(filters);

	return (
		<div className={cn("flex items-center gap-2 flex-wrap", className)}>
			{/* Search */}
			<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/40 bg-muted/20 text-xs min-w-[160px]">
				<Search className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
				<input
					value={filters.search}
					onChange={(e) => onChange({ ...filters, search: e.target.value })}
					placeholder="Search issues..."
					className="bg-transparent outline-none placeholder:text-muted-foreground/40 text-foreground w-full"
				/>
				{filters.search && (
					<button onClick={() => onChange({ ...filters, search: "" })}>
						<X className="w-3 h-3 text-muted-foreground/50 hover:text-foreground" />
					</button>
				)}
			</div>

			<StatusFilter filters={filters} onChange={onChange} />
			<PriorityFilter filters={filters} onChange={onChange} />
			<LifecycleFilter filters={filters} onChange={onChange} />
			<AssigneeFilter
				filters={filters}
				onChange={onChange}
				agents={agents ?? []}
			/>
			<ProjectFilter
				filters={filters}
				onChange={onChange}
				projects={projects ?? []}
			/>
			<LabelsFilter filters={filters} onChange={onChange} />

			{anyActive && (
				<button
					onClick={() => onChange(EMPTY_FILTERS)}
					className="ml-auto text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
				>
					Clear all
				</button>
			)}
		</div>
	);
}
