import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, LayoutGrid, Loader2, Send } from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Panel,
	Group as PanelGroup,
	Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { Badge, Button, PageHeader } from "../components/ui";
import { useRunChunkStream } from "../hooks/useRunChunkStream";
import {
	type Agent,
	type AgentRun,
	type AgentRunLogChunk,
	api,
} from "../lib/api";
import { cn, timeAgo } from "../lib/utils";

const DASHBOARD_CHANNEL = "general";
const MIN_PANELS = 4;
const MAX_PANELS = 6;

const CHUNK_TYPE_STYLES: Partial<
	Record<AgentRunLogChunk["type"], { className: string; prefix?: string }>
> = {
	assistant: { className: "text-foreground" },
	tool_use: { className: "text-setra-400", prefix: "[tool]" },
	tool_result: { className: "text-muted-foreground", prefix: "[result]" },
	system: { className: "text-accent-yellow", prefix: "[system]" },
	input: { className: "text-muted-foreground italic", prefix: "[prompt]" },
	stdout: { className: "text-foreground/80" },
	stderr: { className: "text-accent-red", prefix: "[stderr]" },
	output: { className: "text-foreground" },
};
const DEFAULT_CHUNK_STYLE = { className: "text-foreground" } as const;

interface DashboardAgent extends Agent {
	displayName: string;
}

function formatTimestamp(ts: string): string {
	try {
		const d = new Date(ts);
		if (Number.isNaN(d.getTime())) return "";
		return d.toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return "";
	}
}

function statusLabel(
	agent: DashboardAgent,
	run: AgentRun | null,
): "running" | "idle" {
	return agent.status === "running" || run?.status === "running"
		? "running"
		: "idle";
}

function pickPrimaryRun(runs: AgentRun[]): AgentRun | null {
	return (
		runs.find((run) => run.status === "running") ??
		runs.find((run) => run.status === "pending") ??
		runs[0] ??
		null
	);
}

function EmptyPanel() {
	return (
		<div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-border/40 bg-[#0a0a0b] px-6 text-center">
			<div className="rounded-full border border-border/40 bg-background/10 p-3">
				<Bot className="h-5 w-5 text-muted-foreground/60" />
			</div>
			<p className="mt-4 text-sm font-medium text-foreground/80">
				Waiting for another agent
			</p>
			<p className="mt-1 max-w-xs text-xs text-muted-foreground/60">
				As more agents join the roster, they will appear here automatically.
			</p>
		</div>
	);
}

function AgentTerminalPanel({ agent }: { agent: DashboardAgent }) {
	const qc = useQueryClient();
	const containerRef = useRef<HTMLDivElement>(null);
	const [autoScroll, setAutoScroll] = useState(true);
	const [userScrolledUp, setUserScrolledUp] = useState(false);
	const [draft, setDraft] = useState("");
	const [sendError, setSendError] = useState<string | null>(null);

	const { data: runs = [] } = useQuery({
		queryKey: ["agent-runs", agent.id],
		queryFn: () => api.agentDetail.getRuns(agent.id),
		refetchInterval: 10_000,
	});

	const primaryRun = useMemo(() => pickPrimaryRun(runs), [runs]);
	const live = statusLabel(agent, primaryRun) === "running";
	const issueLabel =
		primaryRun?.issueTitle ?? agent.currentIssueId ?? "No active issue";

	const { data: chunks = [] } = useQuery({
		queryKey: ["run-log", agent.id, primaryRun?.id ?? null],
		queryFn: () =>
			primaryRun ? api.agentDetail.getRunLog(agent.id, primaryRun.id) : [],
		enabled: Boolean(primaryRun),
		// Initial fetch loads history; live updates arrive via SSE below.
		// Background poll kept at 30s to recover from missed events.
		refetchInterval: 30_000,
	});

	// Merge SSE-pushed run:chunk events for the active run into the
	// query-cache chunks so the panel updates without polling.
	const { chunks: streamedChunks } = useRunChunkStream({
		runId: primaryRun?.id ?? null,
	});
	const mergedChunks: AgentRunLogChunk[] = useMemo(() => {
		if (streamedChunks.length === 0) return chunks;
		const seen = new Set<string>();
		const out: AgentRunLogChunk[] = [];
		const push = (c: AgentRunLogChunk, seq?: number) => {
			const key = `${seq ?? out.length}-${c.timestamp}-${c.content.slice(0, 32)}`;
			if (seen.has(key)) return;
			seen.add(key);
			out.push(c);
		};
		for (const c of chunks) push(c, c.sequence);
		for (const c of streamedChunks) push(c, c.sequence);
		return out;
	}, [chunks, streamedChunks]);
	const chunkCount = mergedChunks.length;

	useEffect(() => {
		if (chunkCount > 0 && autoScroll && containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [chunkCount, autoScroll]);

	const handleScroll = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		setUserScrolledUp(!atBottom);
		setAutoScroll(atBottom);
	}, []);

	function resumeAutoScroll() {
		setAutoScroll(true);
		setUserScrolledUp(false);
		if (containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}

	const sendMessage = useMutation({
		mutationFn: (body: string) =>
			api.collaboration.post({
				channel: DASHBOARD_CHANNEL,
				body: body.startsWith("@") ? body : `@${agent.slug} ${body}`,
				agentSlug: "human",
			}),
		onSuccess: () => {
			setDraft("");
			setSendError(null);
			void qc.invalidateQueries({
				queryKey: ["collab-messages", DASHBOARD_CHANNEL],
			});
		},
		onError: (err) => {
			setSendError(
				err instanceof Error ? err.message : "Failed to send message",
			);
		},
	});

	function handleSend() {
		const message = draft.trim();
		if (!message || sendMessage.isPending) return;
		sendMessage.mutate(message);
	}

	const badge = statusLabel(agent, primaryRun);

	return (
		<div className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-lg border border-border/50 bg-[#0a0a0b] shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
			<div className="flex items-start justify-between gap-3 border-b border-border/40 px-4 py-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-sm font-semibold text-foreground">
							{agent.displayName}
						</h2>
						<span className="text-[10px] font-mono text-muted-foreground/45">
							@{agent.slug}
						</span>
					</div>
					<p className="mt-1 truncate text-xs text-muted-foreground/70">
						Issue: <span className="text-foreground/85">{issueLabel}</span>
					</p>
				</div>
				<div
					className={cn(
						"inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
						badge === "running"
							? "border-accent-green/30 bg-accent-green/10 text-accent-green"
							: "border-border/50 bg-background/20 text-muted-foreground",
					)}
				>
					<span
						className={cn(
							"h-1.5 w-1.5 rounded-full",
							badge === "running"
								? "bg-accent-green animate-pulse"
								: "bg-muted-foreground/60",
						)}
					/>
					{badge}
				</div>
			</div>

			<div className="flex items-center justify-between border-b border-border/30 px-4 py-2 text-[11px] text-muted-foreground/55">
				<span>
					{primaryRun ? `Run ${primaryRun.id.slice(0, 8)}` : "No run selected"}
				</span>
				<span>{timeAgo(primaryRun?.startedAt ?? agent.lastActiveAt)}</span>
			</div>

			<div className="relative min-h-0 flex-1">
				{userScrolledUp && (
					<div className="absolute right-2 top-2 z-10 flex items-center gap-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur">
						<span>Scroll lock</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={resumeAutoScroll}
						>
							Resume
						</Button>
					</div>
				)}
				<div
					ref={containerRef}
					onScroll={handleScroll}
					className="h-full overflow-y-auto px-4 py-3 scroll-smooth"
				>
					{mergedChunks.length === 0 ? (
						<p className="text-xs font-mono italic text-muted-foreground/40">
							{primaryRun
								? "No log entries yet…"
								: "Waiting for agent activity…"}
						</p>
					) : (
						<div className="space-y-0.5">
							{mergedChunks.map((chunk) => {
								const style =
									CHUNK_TYPE_STYLES[chunk.type] ?? DEFAULT_CHUNK_STYLE;
								const prefix =
									chunk.type === "tool_use" && chunk.toolName
										? `[tool:${chunk.toolName}]`
										: style.prefix;

								return (
									<div
										key={`${chunk.timestamp}-${chunk.type}-${chunk.content.slice(0, 24)}`}
										className="flex items-start gap-3 leading-5"
									>
										<span className="w-16 shrink-0 pt-px font-mono text-[10px] text-muted-foreground/30">
											{formatTimestamp(chunk.timestamp)}
										</span>
										<span
											className={cn(
												"break-all whitespace-pre-wrap font-mono text-xs",
												style.className,
											)}
										>
											{prefix && (
												<span className="mr-1.5 opacity-60">{prefix}</span>
											)}
											{chunk.content}
										</span>
									</div>
								);
							})}
						</div>
					)}
					{live && (
						<div className="mt-1 flex items-start gap-3 leading-5">
							<span className="w-16 font-mono text-[10px] text-muted-foreground/30" />
							<span className="text-xs font-mono text-setra-400">
								<span className="inline-block h-3 w-2 animate-pulse bg-setra-400" />
							</span>
						</div>
					)}
				</div>
			</div>

			<div className="border-t border-border/40 p-3">
				{sendError && (
					<p className="mb-2 text-xs text-accent-red">{sendError}</p>
				)}
				<div className="flex gap-2">
					<input
						type="text"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								handleSend();
							}
						}}
						placeholder={`Message @${agent.slug} in #${DASHBOARD_CHANNEL}…`}
						className="flex-1 rounded-md border border-border/50 bg-background/10 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/45 focus:border-setra-500 focus:outline-none focus:ring-1 focus:ring-setra-500"
					/>
					<Button
						type="button"
						onClick={handleSend}
						disabled={!draft.trim() || sendMessage.isPending}
						loading={sendMessage.isPending}
						icon={
							!sendMessage.isPending ? (
								<Send className="h-4 w-4" aria-hidden="true" />
							) : undefined
						}
					>
						Send
					</Button>
				</div>
			</div>
		</div>
	);
}

export function MultiViewPage() {
	const { data: agents = [] } = useQuery({
		queryKey: ["agents"],
		queryFn: api.agents.list,
		refetchInterval: 15_000,
	});
	const { data: roster = [] } = useQuery({
		queryKey: ["agents-roster"],
		queryFn: () => api.agents.roster.list(),
		refetchInterval: 15_000,
	});

	const displayNames = useMemo(() => {
		return new Map(
			roster
				.filter((entry) => entry.agent_id)
				.map((entry) => [entry.agent_id as string, entry.display_name]),
		);
	}, [roster]);

	const rankedAgents = useMemo<DashboardAgent[]>(() => {
		return [...agents]
			.sort((a, b) => {
				const aRunning = a.status === "running" ? 1 : 0;
				const bRunning = b.status === "running" ? 1 : 0;
				if (aRunning !== bRunning) return bRunning - aRunning;
				const aLast = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
				const bLast = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
				return bLast - aLast;
			})
			.slice(0, MAX_PANELS)
			.map((agent) => ({
				...agent,
				displayName:
					displayNames.get(agent.id) ?? agent.role ?? agent.slug ?? agent.id,
			}));
	}, [agents, displayNames]);

	const slotCount = rankedAgents.length > MIN_PANELS ? MAX_PANELS : MIN_PANELS;
	const columns = slotCount === MAX_PANELS ? 3 : 2;
	const panels = useMemo(() => {
		const filled = [...rankedAgents];
		while (filled.length < slotCount) filled.push(null as never);
		return filled as Array<DashboardAgent | null>;
	}, [rankedAgents, slotCount]);
	const rows = useMemo(
		() =>
			Array.from({ length: 2 }, (_, index) =>
				panels.slice(index * columns, (index + 1) * columns),
			),
		[columns, panels],
	);

	return (
		<div className="flex h-full min-h-[40rem] flex-col gap-4 overflow-hidden">
			<PageHeader
				title="Multi View"
				subtitle="Watch agents work side-by-side in a live terminal dashboard."
				actions={
					<Badge variant="info">{rankedAgents.length} active panels</Badge>
				}
			/>

			<div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/40 bg-background/30 p-2">
				<PanelGroup orientation="vertical" className="h-full overflow-hidden">
					{rows.map((row, rowIndex) => (
						<Fragment key={`multi-view-row-${rowIndex}`}>
							<Panel defaultSize={50} minSize={25} className="overflow-hidden">
								<PanelGroup
									orientation="horizontal"
									className="h-full overflow-hidden"
								>
									{row.map((agent, columnIndex) => (
										<Fragment
											key={`multi-view-cell-${rowIndex}-${columnIndex}-${agent?.id ?? "empty"}`}
										>
											<Panel
												defaultSize={100 / columns}
												minSize={18}
												className="overflow-hidden p-2"
											>
												{agent ? (
													<AgentTerminalPanel agent={agent} />
												) : (
													<EmptyPanel />
												)}
											</Panel>
											{columnIndex < row.length - 1 && (
												<PanelResizeHandle className="w-1 shrink-0 cursor-col-resize bg-border/20 transition-colors hover:bg-setra-500/40" />
											)}
										</Fragment>
									))}
								</PanelGroup>
							</Panel>
							{rowIndex < rows.length - 1 && (
								<PanelResizeHandle className="h-1 shrink-0 cursor-row-resize bg-border/20 transition-colors hover:bg-setra-500/40" />
							)}
						</Fragment>
					))}
				</PanelGroup>
			</div>
		</div>
	);
}
