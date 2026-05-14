/**
 * Live activity strip — the "what is agent X doing right now" surface.
 *
 * Subscribes to the run:chunk SSE stream filtered to a specific agent
 * (or run) and renders a rolling feed of assistant thinking and tool
 * calls. Designed to be mounted on AgentDetailPage (full feed) or as a
 * single-line variant on aggregate surfaces such as ProjectDetailPage.
 */

import { Activity, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import {
	type RunChunkEvent,
	useRunChunkStream,
} from "../hooks/useRunChunkStream";
import { cn } from "../lib/utils";

interface AgentActivityStripProps {
	agentId?: string | null;
	runId?: string | null;
	variant?: "full" | "single-line";
	maxRows?: number;
	className?: string;
}

const TYPE_LABEL: Record<RunChunkEvent["type"], string> = {
	assistant: "thinking",
	tool_use: "tool",
	tool_result: "tool result",
	system: "system",
	input: "prompt",
	stdout: "stdout",
	stderr: "stderr",
	output: "output",
};

const TYPE_TONE: Record<RunChunkEvent["type"], string> = {
	assistant: "text-foreground",
	tool_use: "text-setra-400",
	tool_result: "text-muted-foreground",
	system: "text-accent-yellow",
	input: "text-muted-foreground italic",
	stdout: "text-foreground/80",
	stderr: "text-accent-red",
	output: "text-foreground",
};

function summarize(chunk: RunChunkEvent): string {
	const body = chunk.content?.trim() ?? "";
	if (chunk.type === "tool_use" && chunk.toolName) {
		return `${chunk.toolName}${body ? ` — ${body}` : ""}`;
	}
	return body;
}

function formatTime(ts: string): string {
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

export function AgentActivityStrip({
	agentId = null,
	runId = null,
	variant = "full",
	maxRows = 50,
	className,
}: AgentActivityStripProps) {
	const { chunks, latest, connected } = useRunChunkStream({
		agentId,
		runId,
		limit: maxRows,
	});

	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [chunks.length]);

	if (variant === "single-line") {
		const text = latest ? summarize(latest) : "Idle";
		return (
			<div
				className={cn(
					"flex items-center gap-2 truncate text-xs text-muted-foreground",
					className,
				)}
				title={text}
			>
				<span
					className={cn(
						"inline-block h-1.5 w-1.5 shrink-0 rounded-full",
						connected ? "bg-accent-green" : "bg-muted-foreground/40",
					)}
					aria-hidden
				/>
				{latest ? (
					<>
						<span className={cn("uppercase tracking-wide", "text-[10px]")}>
							{TYPE_LABEL[latest.type]}
						</span>
						<span className={cn("truncate", TYPE_TONE[latest.type])}>
							{text}
						</span>
					</>
				) : (
					<span>Waiting for activity</span>
				)}
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex flex-col rounded-lg border border-border/40 bg-[#0a0a0b]",
				className,
			)}
		>
			<div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
				<div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
					<Activity className="h-3.5 w-3.5" aria-hidden />
					Live activity
				</div>
				<div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
					<span
						className={cn(
							"inline-block h-1.5 w-1.5 rounded-full",
							connected ? "bg-accent-green" : "bg-muted-foreground/40",
						)}
						aria-hidden
					/>
					{connected ? "Streaming" : "Reconnecting"}
				</div>
			</div>
			<div
				ref={containerRef}
				className="max-h-64 min-h-[120px] flex-1 overflow-y-auto p-3 font-mono text-xs"
			>
				{chunks.length === 0 ? (
					<div className="flex h-full min-h-[100px] items-center justify-center text-muted-foreground">
						Waiting for activity
					</div>
				) : (
					<div className="space-y-1.5">
						{chunks.map((chunk, i) => {
							const key = `${chunk.runId}-${chunk.sequence ?? i}`;
							const isTool = chunk.type === "tool_use";
							return (
								<div key={key} className="flex gap-2">
									<span className="shrink-0 text-[10px] text-muted-foreground/60">
										{formatTime(chunk.timestamp)}
									</span>
									<span
										className={cn(
											"shrink-0 text-[10px] uppercase tracking-wide",
											TYPE_TONE[chunk.type],
										)}
									>
										{TYPE_LABEL[chunk.type]}
									</span>
									<span
										className={cn(
											"min-w-0 break-words whitespace-pre-wrap",
											TYPE_TONE[chunk.type],
										)}
									>
										{isTool && (
											<Wrench className="mr-1 inline h-3 w-3" aria-hidden />
										)}
										{summarize(chunk)}
									</span>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
