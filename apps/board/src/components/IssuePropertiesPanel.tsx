import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import type {
	Agent,
	Issue,
	IssuePriority,
	IssueStatus,
	Project,
} from "../lib/api";
import { cn } from "../lib/utils";
import { PriorityIcon, StatusIcon } from "./KanbanBoard";

interface Props {
	issue: Issue;
	agents?: Agent[];
	projects?: Project[];
	onUpdate: (data: Partial<Issue>) => void;
	onRunTests?: () => void;
	isRunningTests?: boolean;
	onClose: () => void;
	isOpen: boolean;
}

const STATUS_OPTIONS: IssueStatus[] = [
	"backlog",
	"todo",
	"in_progress",
	"in_review",
	"blocked",
	"done",
	"cancelled",
];

const STATUS_LABELS: Record<IssueStatus, string> = {
	backlog: "Backlog",
	todo: "Todo",
	in_progress: "In Progress",
	in_review: "In Review",
	blocked: "Blocked",
	done: "Done",
	cancelled: "Cancelled",
};

const PRIORITY_OPTIONS: IssuePriority[] = [
	"urgent",
	"high",
	"medium",
	"low",
	"none",
];
const PRIORITY_LABELS: Record<IssuePriority, string> = {
	urgent: "Urgent",
	high: "High",
	medium: "Medium",
	low: "Low",
	none: "None",
};

function PropertyRow({
	label,
	children,
}: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1 py-2.5 border-b border-border/30 last:border-0">
			<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
				{label}
			</span>
			<div className="text-sm text-foreground">{children}</div>
		</div>
	);
}

function InlineDropdown({
	trigger,
	children,
}: {
	trigger: React.ReactNode;
	children: (close: () => void) => React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	function close() {
		setOpen(false);
	}

	return (
		<div ref={ref} className="relative">
			<div onClick={() => setOpen((v) => !v)} className="cursor-pointer">
				{trigger}
			</div>
			<AnimatePresence>
				{open && (
					<motion.div
						initial={{ opacity: 0, y: -4 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -4 }}
						transition={{ duration: 0.1 }}
						className="absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-lg border border-border/50 bg-card shadow-xl py-1"
					>
						{children(close)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function IssuePropertiesPanel({
	issue,
	agents = [],
	projects = [],
	onUpdate,
	onRunTests,
	isRunningTests = false,
	onClose,
	isOpen,
}: Props) {
	const [labelInput, setLabelInput] = useState("");

	const parsedLabels = (() => {
		try {
			const parsed = JSON.parse(issue.labels || "[]");
			return Array.isArray(parsed)
				? parsed.filter((label): label is string => typeof label === "string")
				: [];
		} catch {
			return (
				issue.labels
					?.split(",")
					.map((l) => l.trim())
					.filter(Boolean) ?? []
			);
		}
	})();
	const assignedAgent = agents.find(
		(agent) => agent.id === issue.assignedAgentId,
	);
	const assignedAgentName = assignedAgent
		? ((assignedAgent as Agent & { display_name?: string; name?: string })
				.display_name ??
			(assignedAgent as Agent & { display_name?: string; name?: string })
				.name ??
			assignedAgent.slug)
		: null;

	function addLabel(label: string) {
		const trimmed = label.trim();
		if (!trimmed || parsedLabels.includes(trimmed)) return;
		const next = [...parsedLabels, trimmed];
		onUpdate({ labels: JSON.stringify(next) });
		setLabelInput("");
	}

	function removeLabel(label: string) {
		const next = parsedLabels.filter((l) => l !== label);
		onUpdate({ labels: JSON.stringify(next) });
	}

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ width: 0, opacity: 0 }}
					animate={{ width: 288, opacity: 1 }}
					exit={{ width: 0, opacity: 0 }}
					transition={{ duration: 0.2 }}
					className="h-full shrink-0 overflow-hidden border-l border-border/30"
				>
					<div className="flex h-full w-72 flex-col overflow-y-auto bg-card p-4">
						<div className="flex items-center justify-between border-b border-border/30 pb-3">
							<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
								Properties
							</span>
							<button
								onClick={onClose}
								className="text-muted-foreground/50 hover:text-foreground transition-colors"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<div className="mt-4">
							{/* Status */}
							<PropertyRow label="Status">
								<InlineDropdown
									trigger={
										<div className="flex items-center gap-2 py-0.5 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors">
											<StatusIcon status={issue.status} />
											<span>{STATUS_LABELS[issue.status]}</span>
											<ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
										</div>
									}
								>
									{(close) => (
										<>
											{STATUS_OPTIONS.map((s) => (
												<button
													key={s}
													onClick={() => {
														onUpdate({ status: s });
														close();
													}}
													className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
												>
													<StatusIcon status={s} />
													<span>{STATUS_LABELS[s]}</span>
													{issue.status === s && (
														<Check className="w-3 h-3 text-setra-400 ml-auto" />
													)}
												</button>
											))}
										</>
									)}
								</InlineDropdown>
							</PropertyRow>

							{/* Priority */}
							<PropertyRow label="Priority">
								<InlineDropdown
									trigger={
										<div className="flex items-center gap-2 py-0.5 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors">
											<PriorityIcon priority={issue.priority} />
											<span>{PRIORITY_LABELS[issue.priority]}</span>
											<ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
										</div>
									}
								>
									{(close) => (
										<>
											{PRIORITY_OPTIONS.map((p) => (
												<button
													key={p}
													onClick={() => {
														onUpdate({ priority: p });
														close();
													}}
													className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
												>
													<PriorityIcon priority={p} />
													<span>{PRIORITY_LABELS[p]}</span>
													{issue.priority === p && (
														<Check className="w-3 h-3 text-setra-400 ml-auto" />
													)}
												</button>
											))}
										</>
									)}
								</InlineDropdown>
							</PropertyRow>

							{/* Assignee */}
							<PropertyRow label="Assignee">
								<InlineDropdown
									trigger={
										<div className="flex items-center gap-2 py-0.5 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors">
											{issue.assignedAgentId ? (
												<>
													<div className="w-[18px] h-[18px] rounded-full bg-setra-600 flex items-center justify-center shrink-0">
														<span className="text-[8px] font-mono text-white">
															{(assignedAgentName ?? issue.assignedAgentId)
																.slice(0, 2)
																.toUpperCase()}
														</span>
													</div>
													<span className="text-sm truncate">
														{assignedAgentName ?? issue.assignedAgentId}
													</span>
												</>
											) : (
												<span className="text-muted-foreground/60">
													Unassigned
												</span>
											)}
											<ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
										</div>
									}
								>
									{(close) => (
										<>
											<button
												onClick={() => {
													onUpdate({ assignedAgentId: null });
													close();
												}}
												className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors text-muted-foreground"
											>
												Unassigned
												{!issue.assignedAgentId && (
													<Check className="w-3 h-3 text-setra-400 ml-auto" />
												)}
											</button>
											{agents.map((agent) => (
												<button
													key={agent.id}
													onClick={() => {
														onUpdate({ assignedAgentId: agent.id });
														close();
													}}
													className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
												>
													<div
														className={cn(
															"w-1.5 h-1.5 rounded-full shrink-0",
															agent.status === "running"
																? "bg-green-400"
																: agent.status === "error"
																	? "bg-red-400"
																	: "bg-muted-foreground/40",
														)}
													/>
													{(
														agent as Agent & {
															display_name?: string;
															name?: string;
														}
													).display_name ??
														(
															agent as Agent & {
																display_name?: string;
																name?: string;
															}
														).name ??
														agent.slug}
													{issue.assignedAgentId === agent.id && (
														<Check className="w-3 h-3 text-setra-400 ml-auto" />
													)}
												</button>
											))}
										</>
									)}
								</InlineDropdown>
							</PropertyRow>

							{/* Project */}
							<PropertyRow label="Project">
								<InlineDropdown
									trigger={
										<div className="flex items-center gap-2 py-0.5 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors">
											<span
												className={cn(
													!issue.projectId && "text-muted-foreground/60",
												)}
											>
												{projects.find((p) => p.id === issue.projectId)?.name ??
													(issue.projectId || "None")}
											</span>
											<ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
										</div>
									}
								>
									{(close) => (
										<>
											{projects.map((project) => (
												<button
													key={project.id}
													onClick={() => {
														onUpdate({ projectId: project.id });
														close();
													}}
													className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
												>
													{project.name}
													{issue.projectId === project.id && (
														<Check className="w-3 h-3 text-setra-400 ml-auto" />
													)}
												</button>
											))}
										</>
									)}
								</InlineDropdown>
							</PropertyRow>

							{/* Labels */}
							<PropertyRow label="Labels">
								<div className="flex flex-wrap gap-1 mb-1.5">
									{parsedLabels.map((label) => (
										<span
											key={label}
											className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-muted/50 border border-border/40 text-[10px] text-muted-foreground"
										>
											{label}
											<button
												onClick={() => removeLabel(label)}
												className="hover:text-foreground ml-0.5"
											>
												<X className="w-2.5 h-2.5" />
											</button>
										</span>
									))}
								</div>
								<input
									value={labelInput}
									onChange={(e) => setLabelInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === ",") {
											e.preventDefault();
											addLabel(labelInput);
										}
									}}
									placeholder="Add label..."
									className="w-full bg-muted/30 border border-border/40 rounded px-2 py-1 text-xs outline-none focus:border-setra-500 placeholder:text-muted-foreground/40"
								/>
							</PropertyRow>

							{/* Parent Issue */}
							<PropertyRow label="Parent Issue">
								<span className="text-muted-foreground/60 text-sm">
									{issue.parentIssueId ?? "—"}
								</span>
							</PropertyRow>

							{/* Due Date */}
							<PropertyRow label="Due Date">
								<input
									type="date"
									value={issue.dueDate?.slice(0, 10) ?? ""}
									onChange={(e) =>
										onUpdate({ dueDate: e.target.value || null })
									}
									className="bg-muted/30 border border-border/40 rounded px-2 py-1 text-xs outline-none focus:border-setra-500 text-foreground w-full"
								/>
							</PropertyRow>

							<PropertyRow label="Acceptance Criteria">
								<textarea
									value={issue.acceptanceCriteria ?? ""}
									onChange={(e) =>
										onUpdate({ acceptanceCriteria: e.target.value })
									}
									rows={5}
									placeholder="Markdown supported"
									className="w-full bg-muted/30 border border-border/40 rounded px-2 py-1.5 text-xs outline-none focus:border-setra-500 text-foreground placeholder:text-muted-foreground/40 resize-y"
								/>
							</PropertyRow>

							<PropertyRow label="Test Command">
								<input
									value={issue.testCommand ?? ""}
									onChange={(e) =>
										onUpdate({
											testCommand: e.target.value,
											testStatus: e.target.value.trim() ? "pending" : "none",
										})
									}
									placeholder="e.g., npm test, npx playwright test"
									className="w-full bg-muted/30 border border-border/40 rounded px-2 py-1.5 text-xs outline-none focus:border-setra-500 text-foreground placeholder:text-muted-foreground/40"
								/>
							</PropertyRow>

							<PropertyRow label="Test Status">
								<div className="flex flex-col gap-2">
									<div>
										{issue.testStatus === "running" ? (
											<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-400">
												<Loader2 className="h-3 w-3 animate-spin" /> Testing...
											</span>
										) : issue.testStatus === "passed" ? (
											<span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-1 text-[10px] font-medium text-green-400">
												✓ Tests passed
											</span>
										) : issue.testStatus === "failed" ? (
											<span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400">
												✗ Tests failed
											</span>
										) : issue.testStatus === "pending" ? (
											<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-400">
												Tests pending
											</span>
										) : (
											<span className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
												No tests configured
											</span>
										)}
									</div>
									{issue.testStatus === "failed" && onRunTests ? (
										<button
											type="button"
											onClick={onRunTests}
											disabled={isRunningTests}
											className="inline-flex items-center gap-2 rounded border border-border/40 px-2 py-1 text-[10px] font-medium hover:bg-muted/40 disabled:opacity-50"
										>
											{isRunningTests ? (
												<Loader2 className="h-3 w-3 animate-spin" />
											) : null}
											Re-run Tests
										</button>
									) : null}
								</div>
							</PropertyRow>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
