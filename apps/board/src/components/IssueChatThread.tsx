import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ActivityEntry, IssueComment } from "../lib/api";
import { cn } from "../lib/utils";

interface IssueChatThreadProps {
	comments: IssueComment[];
	activity: ActivityEntry[];
	onSendComment: (body: string) => Promise<void>;
	onDeleteComment?: (commentId: string) => void;
	currentUserId?: string;
}

interface ThreadItem {
	type: "comment" | "event";
	id: string;
	timestamp: string;
	actor: string;
	body?: string;
	event?: string;
	payload?: string | null;
}

function formatRelativeTime(iso: string): string {
	const date = new Date(iso);
	if (isNaN(date.getTime())) return "";
	const diff = Date.now() - date.getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Strip the `**AgentName**: ` prefix that server-runner prepends to comments.
 * Also extracts the agent name for display.
 */
function parseCommentBody(body: string): {
	agent: string | null;
	text: string;
} {
	const match = body.match(/^\*\*(.+?)\*\*:\s*/);
	if (match && match[1]) {
		return { agent: match[1], text: body.slice(match[0].length) };
	}
	return { agent: null, text: body };
}

function initials(name: string): string {
	return name.slice(0, 2).toUpperCase();
}

function formatEventText(event: string, payload: string | null): string {
	try {
		const p = payload ? JSON.parse(payload) : null;
		switch (event) {
			case "status_changed":
				return `Status changed to ${p?.to ?? "unknown"}`;
			case "assigned":
				return `Assigned to ${p?.to ?? "someone"}`;
			case "unassigned":
				return `Unassigned from ${p?.from ?? "someone"}`;
			case "priority_changed":
				return `Priority changed to ${p?.to ?? "unknown"}`;
			case "labeled":
				return `Label "${p?.label ?? ""}" added`;
			case "unlabeled":
				return `Label "${p?.label ?? ""}" removed`;
			case "created":
				return "Issue created";
			default:
				return event.replace(/_/g, " ");
		}
	} catch {
		return event.replace(/_/g, " ");
	}
}

function Avatar({ name, isAgent }: { name: string; isAgent?: boolean }) {
	return (
		<div
			className={cn(
				"w-[28px] h-[28px] rounded-full flex items-center justify-center shrink-0",
				isAgent ? "bg-setra-600" : "bg-muted border border-border/50",
			)}
		>
			<span
				className={cn(
					"text-[10px] font-mono font-medium",
					isAgent ? "text-[#2b2418]" : "text-muted-foreground",
				)}
			>
				{initials(name)}
			</span>
		</div>
	);
}

export function IssueChatThread({
	comments,
	activity,
	onSendComment,
	onDeleteComment,
	currentUserId = "user",
}: IssueChatThreadProps) {
	const [body, setBody] = useState("");
	const [sending, setSending] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Merge comments + activity into a timeline
	const items: ThreadItem[] = [
		...comments.map(
			(c): ThreadItem => ({
				type: "comment",
				id: c.id,
				timestamp: c.created_at,
				actor: c.author,
				body: c.body,
			}),
		),
		...activity.map(
			(a): ThreadItem => ({
				type: "event",
				id: a.id,
				timestamp: a.created_at,
				actor: a.actor,
				event: a.event,
				payload: a.payload,
			}),
		),
	].sort(
		(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
	);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [items.length]);

	async function handleSend() {
		const trimmed = body.trim();
		if (!trimmed || sending) return;
		setSending(true);
		try {
			await onSendComment(trimmed);
			setBody("");
		} finally {
			setSending(false);
		}
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			handleSend();
		}
	}

	const isAgentActor = (actor: string) =>
		!actor.includes("@") && actor !== currentUserId;

	return (
		<div className="flex flex-col h-full">
			{/* Thread */}
			<div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
				{items.length === 0 && (
					<p className="text-xs text-muted-foreground/50 text-center py-8">
						No messages yet. Start the conversation.
					</p>
				)}

				{items.map((item) => {
					if (item.type === "event") {
						return (
							<div key={item.id} className="flex items-center gap-2 py-1">
								<div className="w-1 h-1 rounded-full bg-muted-foreground/30 mx-3 shrink-0" />
								<span className="text-[11px] text-muted-foreground/60">
									<span className="text-muted-foreground/80 font-medium">
										{item.actor}
									</span>{" "}
									{formatEventText(item.event ?? "", item.payload ?? null)}
								</span>
								<span className="ml-auto text-[10px] text-muted-foreground/40 shrink-0">
									{formatRelativeTime(item.timestamp)}
								</span>
							</div>
						);
					}

					const isMe = item.actor === currentUserId;
					const isAgent = isAgentActor(item.actor);
					const { agent: parsedAgent, text: cleanBody } = parseCommentBody(
						item.body ?? "",
					);
					const displayName = parsedAgent ?? item.actor;

					return (
						<div
							key={item.id}
							className={cn(
								"flex items-end gap-2",
								isMe ? "flex-row-reverse" : "flex-row",
							)}
						>
							<Avatar name={displayName} isAgent={isAgent} />
							<div
								className={cn(
									"flex flex-col gap-1 max-w-[85%]",
									isMe && "items-end",
								)}
							>
								<div className="flex items-center gap-1.5">
									<span className="text-[10px] text-muted-foreground/60">
										{displayName}
									</span>
									<span className="text-[10px] text-muted-foreground/40">
										{formatRelativeTime(item.timestamp)}
									</span>
								</div>
								<div
									className={cn(
										"rounded-xl px-3 py-2 text-sm leading-relaxed prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-headings:text-sm prose-pre:bg-[#fdfaf3]/30 prose-code:text-xs max-w-none",
										isMe
											? "bg-setra-600/20 text-foreground"
											: "bg-card border border-border/50 text-foreground",
									)}
								>
									<ReactMarkdown remarkPlugins={[remarkGfm]}>
										{cleanBody}
									</ReactMarkdown>
								</div>
								{onDeleteComment && isMe && (
									<button
										onClick={() => onDeleteComment(item.id)}
										className="text-[10px] text-muted-foreground/30 hover:text-accent-red transition-colors"
									>
										Delete
									</button>
								)}
							</div>
						</div>
					);
				})}
				<div ref={bottomRef} />
			</div>

			{/* Composer */}
			<div className="px-4 py-3 border-t border-border/30">
				<div className="relative rounded-xl border border-border/50 bg-muted/20 focus-within:border-setra-500/50 transition-colors">
					<textarea
						ref={textareaRef}
						value={body}
						onChange={(e) => setBody(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Write a comment... (Cmd+Enter to send)"
						rows={3}
						className="w-full bg-transparent px-3 pt-2.5 pb-8 text-sm outline-none placeholder:text-muted-foreground/40 resize-none"
					/>
					<div className="absolute bottom-2 right-2 flex items-center gap-2">
						<span className="text-[10px] text-muted-foreground/40 tabular-nums">
							{body.length}
						</span>
						<button
							onClick={handleSend}
							disabled={!body.trim() || sending}
							className="flex items-center gap-1 px-2.5 py-1 bg-setra-600 hover:bg-setra-500 disabled:opacity-40 text-[#2b2418] text-xs rounded-lg transition-colors"
						>
							<Send className="w-3 h-3" />
							Send
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
