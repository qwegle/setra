import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	Bot,
	CheckCircle,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	GitBranch,
	History,
	MessageSquare,
	Play,
	User,
	XCircle,
	Zap,
} from "lucide-react";
import { useState } from "react";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { type ActivityEntry, api } from "../lib/api";
import { cn, timeAgo } from "../lib/utils";

const PAGE_SIZE = 50;

const EVENT_ICONS: Record<string, typeof History> = {
	"issue.created": GitBranch,
	"issue.status_changed": AlertCircle,
	"issue.assigned": User,
	"agent.run_started": Play,
	"agent.run_completed": CheckCircle,
	"agent.run_failed": XCircle,
	comment_added: MessageSquare,
	"goal.created": Zap,
};

const EVENT_VERB: Record<string, string> = {
	"issue.created": "created issue",
	"issue.status_changed": "changed status of",
	"issue.assigned": "assigned",
	"issue.updated": "updated",
	"agent.run_started": "started a run on",
	"agent.run_completed": "completed a run on",
	"agent.run_failed": "run failed on",
	"goal.created": "created goal",
	"goal.updated": "updated goal",
	"routine.created": "created routine",
	"routine.executed": "ran routine",
	comment_added: "commented on",
	status_changed: "changed status of",
	priority_changed: "changed priority of",
	assigned: "assigned",
};

const FILTER_TABS = [
	{ id: "all", label: "All" },
	{ id: "issue", label: "Issues" },
	{ id: "agent", label: "Agents" },
	{ id: "comment", label: "Comments" },
	{ id: "goal", label: "Goals" },
] as const;

type FilterType = (typeof FILTER_TABS)[number]["id"];

const EMPTY_STATE_COPY: Record<FilterType, string> = {
	all: "No activity yet",
	issue: "No issue activity yet",
	agent: "No agent activity yet",
	comment: "No comment activity yet",
	goal: "No goal activity yet",
};

function actorInitials(name: string): string {
	return name
		.split(/[\s_-]/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("");
}

function isAgent(actor: string): boolean {
	return (
		actor.startsWith("agent:") ||
		actor.includes("-agent") ||
		actor.includes("_agent")
	);
}

function eventVariant(
	event: string,
): "default" | "success" | "warning" | "danger" | "info" {
	if (event.startsWith("agent.run_failed")) return "danger";
	if (event.startsWith("agent.run_completed")) return "success";
	if (event.startsWith("agent")) return "info";
	if (event.startsWith("goal")) return "warning";
	if (event.startsWith("comment") || event === "comment_added")
		return "default";
	return "default";
}

function eventLabel(event: string): string {
	return event.replaceAll(".", " · ").replaceAll("_", " ");
}

function ActorAvatar({ actor }: { actor: string }) {
	const initials = actorInitials(actor.replace(/^agent:/, ""));
	const agentActor = isAgent(actor);

	if (actor === "system") {
		return (
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800/70">
				<Bot className="h-4 w-4 text-zinc-400" aria-hidden="true" />
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
				agentActor
					? "border-blue-500/30 bg-blue-500/15 font-mono text-blue-300"
					: "border-zinc-700 bg-zinc-800 text-zinc-200",
			)}
		>
			{initials}
		</div>
	);
}

function entityFromPayload(
	entry: ActivityEntry,
): { label: string; name: string } | null {
	try {
		if (!entry.payload) return null;
		const payload = JSON.parse(entry.payload) as Record<string, unknown>;
		const name = (payload.title ??
			payload.name ??
			payload.slug ??
			payload.id ??
			"") as string;
		const type = entry.event.split(".")[0] ?? entry.event;
		return name ? { label: type, name } : null;
	} catch {
		return null;
	}
}

function getValue(obj: Record<string, unknown>, key: string): unknown {
	return obj[key];
}

function getNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function PayloadDetails({ entry }: { entry: ActivityEntry }) {
	if (!entry.payload) return null;

	try {
		const payload = JSON.parse(entry.payload) as Record<string, unknown>;
		const details: Array<{ label: string; value: string }> = [];
		const fromStatus =
			getValue(payload, "fromStatus") ?? getValue(payload, "from");
		const toStatus = getValue(payload, "toStatus") ?? getValue(payload, "to");
		const priority =
			getValue(payload, "priority") ??
			getValue(payload, "toPriority") ??
			getValue(payload, "estimatedComplexity");
		const assignee =
			getValue(payload, "assignee") ??
			getValue(payload, "assignedAgentId") ??
			getValue(payload, "agentSlug");
		const model = getValue(payload, "model") ?? getValue(payload, "modelId");
		const costUsd = getNumber(getValue(payload, "costUsd"));
		const duration =
			getValue(payload, "duration") ??
			getValue(payload, "durationMs") ??
			getValue(payload, "elapsedMs");
		const promptTokens =
			getNumber(getValue(payload, "promptTokens")) ??
			getNumber(getValue(payload, "inputTokens"));
		const completionTokens =
			getNumber(getValue(payload, "completionTokens")) ??
			getNumber(getValue(payload, "outputTokens"));
		const error = getValue(payload, "error");
		const comment =
			getValue(payload, "comment") ??
			getValue(payload, "body") ??
			getValue(payload, "content");
		const title = getValue(payload, "title");
		const description = getValue(payload, "description");
		const slug = getValue(payload, "slug");

		if (fromStatus && toStatus) {
			details.push({ label: "Status", value: `${fromStatus} → ${toStatus}` });
		} else if (toStatus) {
			details.push({ label: "Status", value: String(toStatus) });
		} else if (getValue(payload, "status")) {
			details.push({
				label: "Status",
				value: String(getValue(payload, "status")),
			});
		}
		if (priority) details.push({ label: "Priority", value: String(priority) });
		if (assignee) details.push({ label: "Assignee", value: String(assignee) });
		if (model) details.push({ label: "Model", value: String(model) });
		if (costUsd !== null)
			details.push({ label: "Cost", value: `$${costUsd.toFixed(4)}` });
		if (duration) details.push({ label: "Duration", value: String(duration) });
		if (promptTokens !== null)
			details.push({
				label: "Tokens",
				value: `${promptTokens} in / ${completionTokens ?? 0} out`,
			});
		if (error) details.push({ label: "Error", value: String(error) });
		if (comment) {
			const text = String(comment);
			details.push({
				label: "Content",
				value: text.length > 200 ? `${text.slice(0, 200)}…` : text,
			});
		}
		if (title) details.push({ label: "Title", value: String(title) });
		if (description) {
			const text = String(description);
			details.push({
				label: "Description",
				value: text.length > 200 ? `${text.slice(0, 200)}…` : text,
			});
		}
		if (slug) details.push({ label: "Slug", value: String(slug) });
		if (details.length === 0) return null;

		return (
			<div className="ml-11 mt-3 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
				<div className="space-y-2">
					{details.map((detail, index) => (
						<div
							key={`${detail.label}-${index}`}
							className="flex gap-3 text-xs"
						>
							<span className="w-20 shrink-0 font-medium text-zinc-400">
								{detail.label}
							</span>
							<span className="break-all text-zinc-200">{detail.value}</span>
						</div>
					))}
				</div>
			</div>
		);
	} catch {
		return null;
	}
}

function ActivityRow({
	entry,
	isExpanded,
	onToggle,
}: {
	entry: ActivityEntry;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const verb = EVENT_VERB[entry.event] ?? entry.event;
	const entity = entityFromPayload(entry);
	const actorDisplay = entry.actor.replace(/^agent:/, "");
	const EventIcon = EVENT_ICONS[entry.event] ?? History;
	const hasPayload = Boolean(entry.payload);

	return (
		<div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-4">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-start gap-3 text-left"
				aria-expanded={hasPayload ? isExpanded : undefined}
			>
				<ActorAvatar actor={entry.actor} />
				<div className="min-w-0 flex-1 space-y-2">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={eventVariant(entry.event)}>
							{eventLabel(entry.event)}
						</Badge>
						<span
							className="text-xs text-zinc-500"
							title={new Date(entry.created_at).toLocaleString()}
						>
							{timeAgo(entry.created_at)}
						</span>
					</div>
					<div className="flex items-center gap-2 text-sm text-zinc-200">
						<EventIcon
							className="h-4 w-4 shrink-0 text-zinc-500"
							aria-hidden="true"
						/>
						<p className="leading-relaxed">
							<span className="font-medium text-white">{actorDisplay}</span>{" "}
							<span className="text-zinc-400">{verb}</span>
							{entity && <span className="text-blue-300"> {entity.name}</span>}
						</p>
					</div>
				</div>
				{hasPayload && (
					<span className="pt-1 text-zinc-500">
						{isExpanded ? (
							<ChevronUp className="h-4 w-4" aria-hidden="true" />
						) : (
							<ChevronDown className="h-4 w-4" aria-hidden="true" />
						)}
					</span>
				)}
			</button>
			{isExpanded && <PayloadDetails entry={entry} />}
		</div>
	);
}

function getDayLabel(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today.getTime() - 86400000);
	const entryDay = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
	);

	if (entryDay.getTime() === today.getTime()) return "Today";
	if (entryDay.getTime() === yesterday.getTime()) return "Yesterday";
	return date.toLocaleDateString("en-US", {
		weekday: "long",
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function groupByDay(items: ActivityEntry[]): Map<string, ActivityEntry[]> {
	const groups = new Map<string, ActivityEntry[]>();
	for (const item of items) {
		const label = getDayLabel(item.created_at);
		if (!groups.has(label)) groups.set(label, []);
		groups.get(label)?.push(item);
	}
	return groups;
}

function Pagination({
	page,
	totalPages,
	total,
	onPageChange,
}: {
	page: number;
	totalPages: number;
	total: number;
	onPageChange: (page: number) => void;
}) {
	if (totalPages <= 1) return null;

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-6 py-4">
			<span className="text-sm text-zinc-400" aria-live="polite">
				{total} activities
			</span>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
					icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
					aria-label="Previous page"
				/>
				<span className="text-sm text-zinc-400">
					Page {page} of {totalPages}
				</span>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={page >= totalPages}
					onClick={() => onPageChange(page + 1)}
					icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
					aria-label="Next page"
				/>
			</div>
		</div>
	);
}

export function ActivityPage() {
	const [filter, setFilter] = useState<FilterType>("all");
	const [page, setPage] = useState(1);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const handleFilterChange = (nextFilter: FilterType) => {
		setFilter(nextFilter);
		setPage(1);
		setExpandedId(null);
	};

	const handlePageChange = (nextPage: number) => {
		setPage(nextPage);
		setExpandedId(null);
	};

	const { data, isLoading, isError } = useQuery({
		queryKey: ["activity", "global", page, filter],
		queryFn: () =>
			api.activity.list(page, PAGE_SIZE, filter !== "all" ? filter : undefined),
	});

	const items = data?.items ?? [];
	const totalPages = data?.totalPages ?? 1;
	const total = data?.total ?? 0;
	const dayGroups = groupByDay(items);

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-zinc-800 px-6 py-6">
				<PageHeader
					title="Activity"
					subtitle="Review issue updates, agent runs, and goal changes across the workspace."
					actions={
						total > 0 ? (
							<Badge variant="default" className="text-sm" role="status">
								{total}
							</Badge>
						) : undefined
					}
				/>
				<div
					className="mt-4 flex flex-wrap gap-2"
					aria-label="Activity filters"
				>
					{FILTER_TABS.map((tab) => (
						<Button
							key={tab.id}
							type="button"
							variant={filter === tab.id ? "primary" : "ghost"}
							size="sm"
							onClick={() => handleFilterChange(tab.id)}
						>
							{tab.label}
						</Button>
					))}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto px-6 py-6">
				{isLoading && (
					<Card>
						<Skeleton count={8} />
					</Card>
				)}

				{isError && (
					<Card>
						<p className="text-sm text-red-400">Failed to load activity.</p>
					</Card>
				)}

				{!isLoading && !isError && items.length === 0 && (
					<EmptyState
						icon={<History className="h-10 w-10" aria-hidden="true" />}
						title={EMPTY_STATE_COPY[filter]}
						description="New activity will appear here as work happens across issues, agents, and goals."
					/>
				)}

				{!isLoading && !isError && items.length > 0 && (
					<div className="space-y-6">
						{Array.from(dayGroups.entries()).map(([dayLabel, dayItems]) => (
							<section key={dayLabel} className="space-y-3">
								<div className="flex items-center gap-3">
									<div className="h-px flex-1 bg-zinc-800" />
									<span className="text-sm font-medium text-zinc-400">
										{dayLabel}
									</span>
									<div className="h-px flex-1 bg-zinc-800" />
								</div>
								<div className="space-y-3">
									{dayItems.map((entry) => (
										<ActivityRow
											key={entry.id}
											entry={entry}
											isExpanded={expandedId === entry.id}
											onToggle={() =>
												setExpandedId(expandedId === entry.id ? null : entry.id)
											}
										/>
									))}
								</div>
							</section>
						))}
					</div>
				)}
			</div>

			{!isLoading && !isError && (
				<Pagination
					page={page}
					totalPages={totalPages}
					total={total}
					onPageChange={handlePageChange}
				/>
			)}
		</div>
	);
}
