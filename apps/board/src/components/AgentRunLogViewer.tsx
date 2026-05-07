import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentRunLogChunk, api } from "../lib/api";
import { cn } from "../lib/utils";

interface Props {
	runId: string;
	agentId: string;
	isLive: boolean;
}

const CHUNK_TYPE_STYLES: Record<
	AgentRunLogChunk["type"],
	{ className: string; prefix?: string }
> = {
	assistant: { className: "text-foreground" },
	tool_use: { className: "text-setra-400", prefix: "[tool]" },
	tool_result: { className: "text-muted-foreground", prefix: "[result]" },
	system: { className: "text-accent-yellow", prefix: "[system]" },
};

export function AgentRunLogViewer({ runId, agentId, isLive }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [autoScroll, setAutoScroll] = useState(true);
	const [userScrolledUp, setUserScrolledUp] = useState(false);

	const { data: chunks = [] } = useQuery({
		queryKey: ["run-log", agentId, runId],
		queryFn: () => api.agentDetail.getRunLog(agentId, runId),
		refetchInterval: isLive ? 3_000 : false,
	});
	const chunkCount = chunks.length;

	// Auto-scroll to bottom when new chunks arrive
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

	function formatTimestamp(ts: string) {
		try {
			const d = new Date(ts);
			if (isNaN(d.getTime())) return "";
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

	return (
		<div className="relative rounded-lg overflow-hidden border border-border/50 bg-[#0a0a0b] flex flex-col h-full min-h-[360px]">
			{/* Scroll lock badge */}
			{userScrolledUp && (
				<div className="absolute top-2 right-2 z-10 flex items-center gap-2">
					<span className="px-2.5 py-1 rounded-md bg-muted/80 backdrop-blur text-xs text-muted-foreground border border-border/50">
						Auto-scroll OFF{" "}
						<button
							type="button"
							onClick={resumeAutoScroll}
							className="text-setra-400 hover:text-setra-300 underline ml-1"
						>
							Resume
						</button>
					</span>
				</div>
			)}

			{/* Log content */}
			<div
				ref={containerRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto p-4 space-y-0.5 scroll-smooth"
			>
				{chunks.length === 0 && (
					<p className="text-xs font-mono text-muted-foreground/40 italic">
						No log entries yet…
					</p>
				)}
				{chunks.map((chunk) => {
					const style =
						CHUNK_TYPE_STYLES[chunk.type] ?? CHUNK_TYPE_STYLES.assistant;
					const prefix =
						chunk.type === "tool_use" && chunk.toolName
							? `[tool:${chunk.toolName}]`
							: style.prefix;

					return (
						<div
							key={`${chunk.timestamp}-${chunk.type}-${chunk.content.slice(0, 24)}`}
							className="flex items-start gap-3 leading-5"
						>
							<span className="text-[10px] font-mono text-muted-foreground/30 flex-shrink-0 w-16 pt-px">
								{formatTimestamp(chunk.timestamp)}
							</span>
							<span
								className={cn(
									"text-xs font-mono whitespace-pre-wrap break-all",
									style.className,
								)}
							>
								{prefix && <span className="opacity-60 mr-1.5">{prefix}</span>}
								{chunk.content}
							</span>
						</div>
					);
				})}

				{/* Blinking cursor for live runs */}
				{isLive && (
					<div className="flex items-start gap-3 leading-5">
						<span className="text-[10px] font-mono text-muted-foreground/30 w-16" />
						<span className="text-xs font-mono text-setra-400">
							<span className="inline-block w-2 h-3 bg-setra-400 animate-pulse" />
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
