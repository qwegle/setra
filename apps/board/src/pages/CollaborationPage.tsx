import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	ChevronRight,
	CornerUpLeft,
	Hash,
	Loader2,
	MessageSquare,
	MoreHorizontal,
	Pin,
	Search,
	Send,
	SlidersHorizontal,
	SmilePlus,
	Sparkles,
	Users,
} from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown, {
	type Components,
	type ExtraProps,
} from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useCompany } from "../context/CompanyContext";
import { type Agent, api } from "../lib/api";
import { cn } from "../lib/utils";

function avatarColor(slug: string | null | undefined): string {
	const safe = slug ?? "";
	const palette = [
		"bg-setra-600",
		"bg-accent-purple",
		"bg-accent-green",
		"bg-blue-500",
		"bg-accent-orange",
		"bg-yellow-500",
	];
	let h = 0;
	for (let i = 0; i < safe.length; i++)
		h = (Math.imul(31, h) + safe.charCodeAt(i)) | 0;
	return palette[Math.abs(h) % palette.length] ?? "bg-setra-600";
}

function initials(slug: string | null | undefined): string {
	const safe = slug ?? "";
	return (
		safe
			.split(/[-_\s]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? "")
			.join("") || "?"
	);
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PRESENCE_WINDOW_MS = 10 * 60 * 1000;
const MARKDOWN_PROSE_CLASS =
	"prose prose-sm prose-invert max-w-none break-words text-sm text-foreground/90 leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border/60 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:no-underline [&_code]:before:content-none [&_code]:after:content-none [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:px-4 [&_pre]:py-3 [&_pre]:text-zinc-100 [&_pre]:shadow-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13px] [&_pre_code]:leading-6 [&_.hljs-comment]:text-zinc-500 [&_.hljs-keyword]:text-fuchsia-300 [&_.hljs-string]:text-emerald-300 [&_.hljs-number]:text-amber-300 [&_.hljs-title]:text-sky-300 [&_.hljs-built_in]:text-cyan-300 [&_.hljs-literal]:text-violet-300";

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & ExtraProps;
type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & ExtraProps;
type CollaborationAgent = Agent & {
	display_name?: string;
	is_active?: number;
	adapter_type?: string | null;
};
type MentionableAgent = {
	slug: string;
	displayName: string;
	secondaryLabel: string | null;
	online: boolean;
};

function formatMessageBody(body: string): string {
	return body
		.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
		.map((segment) => {
			if (!segment || segment.startsWith("```") || segment.startsWith("`")) {
				return segment;
			}
			return segment.replace(
				/(^|\s)@([a-zA-Z0-9._-]+)/g,
				(match, prefix, handle) => {
					if (!handle) return match;
					return `${prefix}[@${handle}](mention:${handle})`;
				},
			);
		})
		.join("");
}

const markdownComponents: Components = {
	a: ({ href, className, children, ...props }: MarkdownLinkProps) => {
		if (href?.startsWith("mention:")) {
			return (
				<span className="inline-flex items-center rounded bg-blue-500/20 px-1.5 py-0.5 text-xs font-medium text-blue-300 align-middle">
					{children}
				</span>
			);
		}
		return (
			<a
				href={href}
				className={cn(
					"text-setra-300 underline decoration-setra-500/40 underline-offset-2 transition-colors hover:text-setra-200",
					className,
				)}
				{...props}
			>
				{children}
			</a>
		);
	},
	code: ({ className, children, ...props }: MarkdownCodeProps) => (
		<code
			className={cn(
				"rounded bg-zinc-800 px-1 font-mono text-[0.85em] text-zinc-100",
				className,
			)}
			{...props}
		>
			{children}
		</code>
	),
	pre: ({ className, children, ...props }: ComponentPropsWithoutRef<"pre">) => (
		<pre
			className={cn(
				"my-2 overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 font-mono text-[13px] leading-6",
				className,
			)}
			{...props}
		>
			{children}
		</pre>
	),
};

function MarkdownMessage({
	body,
	className,
}: {
	body: string;
	className?: string;
}) {
	return (
		<div className={cn(MARKDOWN_PROSE_CLASS, className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={markdownComponents}
			>
				{formatMessageBody(body)}
			</ReactMarkdown>
		</div>
	);
}

function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function formatDayDividerLabel(date: Date): string {
	const now = new Date();
	const yesterday = new Date();
	yesterday.setDate(now.getDate() - 1);
	if (isSameDay(date, now)) return "Today";
	if (isSameDay(date, yesterday)) return "Yesterday";
	return date.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

function formatTime(dateString: string): string {
	return new Date(dateString).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatFullTimestamp(dateString: string): string {
	return new Date(dateString).toLocaleString([], {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function isAgentOnline(agent: CollaborationAgent | null | undefined): boolean {
	if (!agent) return false;
	if (agent.status === "running") return true;
	if (agent.is_active === 0 || agent.status === "inactive") return false;
	if (!agent.lastActiveAt) return Boolean(agent.is_active);
	return (
		Date.now() - new Date(agent.lastActiveAt).getTime() <= PRESENCE_WINDOW_MS
	);
}

function buildMentionableAgent(
	agent: CollaborationAgent | null | undefined,
): MentionableAgent | null {
	if (!agent?.slug || agent.slug === "human") return null;
	const displayName = agent.display_name?.trim() || agent.role || agent.slug;
	return {
		slug: agent.slug,
		displayName,
		secondaryLabel:
			displayName.toLowerCase() === agent.slug.toLowerCase()
				? null
				: `@${agent.slug}`,
		online: isAgentOnline(agent),
	};
}

export function CollaborationPage() {
	const qc = useQueryClient();
	const { selectedCompany } = useCompany();
	const [activeChannel, setActiveChannel] = useState("");
	const [draft, setDraft] = useState("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [channelsExpanded, setChannelsExpanded] = useState(true);
	const [dmsExpanded, setDmsExpanded] = useState(true);
	const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const currentSenderName = selectedCompany?.name?.trim() || "You";
	const currentSenderSlug =
		currentSenderName === "You" ? "human" : currentSenderName;
	const currentSenderSubtitle = selectedCompany ? "Active company" : "Online";

	const {
		data: channelsRaw = [],
		isLoading: channelsLoading,
		isError: channelsError,
	} = useQuery({
		queryKey: ["collab-channels"],
		queryFn: api.collaboration.channels,
	});
	const channels = channelsRaw;

	useEffect(() => {
		if (!activeChannel && channels.length > 0) {
			setActiveChannel(channels[0] ?? "");
		}
	}, [channels, activeChannel]);

	const {
		data: messages = [],
		isLoading,
		isError: messagesError,
	} = useQuery({
		queryKey: ["collab-messages", activeChannel],
		queryFn: () => api.collaboration.messages(activeChannel),
		enabled: Boolean(activeChannel),
		refetchInterval: 10_000,
	});
	const { data: agents = [] } = useQuery({
		queryKey: ["agents-mentionable"],
		queryFn: async () => (await api.agents.list()) as CollaborationAgent[],
		staleTime: 10_000,
		refetchInterval: 10_000,
	});

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		const lineHeight =
			Number.parseFloat(window.getComputedStyle(el).lineHeight) || 20;
		const maxHeight = lineHeight * 7 + 20;
		el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
		el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
	}, [draft]);

	useEffect(() => {
		const container = scrollRef.current;
		if (!container) return;
		const frame = window.requestAnimationFrame(() => {
			container.scrollTo({
				top: container.scrollHeight,
				behavior: messages.length > 0 ? "smooth" : "auto",
			});
		});
		return () => window.cancelAnimationFrame(frame);
	}, [messages.length, activeChannel]);

	const post = useMutation({
		mutationFn: (body: string) =>
			api.collaboration.post({
				channel: activeChannel,
				body,
				agentSlug: currentSenderSlug,
			}),
		onSuccess: () => {
			setDraft("");
			setSendError(null);
			setSelectedMentionIndex(0);
			void qc.invalidateQueries({
				queryKey: ["collab-messages", activeChannel],
			});
		},
		onError: (err) => {
			setSendError(
				err instanceof Error ? err.message : "Failed to send message",
			);
		},
	});

	function send() {
		if (!draft.trim() || post.isPending) return;
		post.mutate(draft.trim());
	}

	const mentionMatch = useMemo(() => {
		const match = /(^|\s)@([a-zA-Z0-9._-]*)$/.exec(draft);
		if (!match) return null;
		return {
			query: (match[2] ?? "").toLowerCase(),
			atIndex: match.index + match[0].lastIndexOf("@"),
		};
	}, [draft]);

	const agentDirectory = useMemo(() => {
		const map = new Map<string, CollaborationAgent>();
		for (const agent of agents) {
			if (agent.slug) map.set(agent.slug, agent);
		}
		return map;
	}, [agents]);

	const mentionOptions = useMemo(() => {
		if (!mentionMatch) return [] as MentionableAgent[];
		const directory = new Map<string, MentionableAgent>();
		for (const agent of agents) {
			const item = buildMentionableAgent(agent);
			if (item) directory.set(item.slug.toLowerCase(), item);
		}
		if (!directory.has("assistant")) {
			directory.set("assistant", {
				slug: "assistant",
				displayName: "Assistant",
				secondaryLabel: "@assistant",
				online: true,
			});
		}
		return [...directory.values()]
			.filter((agent) =>
				mentionMatch.query.length === 0
					? true
					: agent.slug.toLowerCase().startsWith(mentionMatch.query) ||
						agent.displayName.toLowerCase().includes(mentionMatch.query),
			)
			.sort(
				(a, b) =>
					Number(b.online) - Number(a.online) ||
					a.displayName.localeCompare(b.displayName),
			)
			.slice(0, 6);
	}, [agents, mentionMatch]);

	useEffect(() => {
		setSelectedMentionIndex(0);
	}, [mentionOptions.length, mentionMatch?.query]);

	function applyMention(handle: string): void {
		setDraft((prev) => {
			if (!mentionMatch) return prev ? `${prev} @${handle} ` : `@${handle} `;
			return `${prev.slice(0, mentionMatch.atIndex)}@${handle} `;
		});
		window.requestAnimationFrame(() => textareaRef.current?.focus());
	}

	const { pinnedMessages, streamMessages } = useMemo(() => {
		const pinned: typeof messages = [];
		const stream: typeof messages = [];
		for (const message of messages) {
			const pinnedMessage =
				Boolean(message.pinned) ||
				message.messageKind === "pinned_sprint_board";
			if (pinnedMessage) pinned.push(message);
			else stream.push(message);
		}
		pinned.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
		return { pinnedMessages: pinned, streamMessages: stream };
	}, [messages]);

	const groupedMessages = useMemo(
		() =>
			streamMessages.map((message, index) => {
				const previous = streamMessages[index - 1];
				const messageDate = new Date(message.createdAt);
				const previousDate = previous ? new Date(previous.createdAt) : null;
				const showDayDivider =
					!previousDate || !isSameDay(messageDate, previousDate);
				const isGrouped =
					Boolean(previous) &&
					!showDayDivider &&
					previous?.agentSlug === message.agentSlug &&
					messageDate.getTime() - previousDate!.getTime() <= GROUP_WINDOW_MS;
				return {
					message,
					isGrouped,
					showDayDivider,
					dayLabel: formatDayDividerLabel(messageDate),
				};
			}),
		[streamMessages],
	);

	const messageMeta = useMemo(() => {
		return new Map(
			agents.map((agent) => {
				const displayName =
					agent.display_name?.trim() || agent.role || agent.slug;
				return [
					agent.slug,
					{
						displayName,
						secondaryLabel:
							displayName.toLowerCase() === agent.slug.toLowerCase()
								? null
								: `@${agent.slug}`,
						online: isAgentOnline(agent),
					},
				] as const;
			}),
		);
	}, [agents]);

	const activeChannelMessageCount = streamMessages.length;
	const activeChannelDescription = "Agent collaboration channel";

	return (
		<div className="flex h-full min-h-0 bg-background text-foreground">
			<aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-zinc-900/95 text-zinc-100">
				<div className="border-b border-white/10 px-4 py-4">
					<div className="flex items-center gap-2 text-sm font-semibold">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-setra-600/20 text-setra-300">
							<MessageSquare className="h-4 w-4" />
						</div>
						<div>
							<div>Collaboration</div>
							<p className="text-[11px] font-normal text-zinc-400">
								Slack-style agent chatter
							</p>
						</div>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-2 py-3">
					<div className="mb-3">
						<button
							type="button"
							onClick={() => setChannelsExpanded((value) => !value)}
							className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:text-zinc-200"
						>
							{channelsExpanded ? (
								<ChevronDown className="h-3.5 w-3.5" />
							) : (
								<ChevronRight className="h-3.5 w-3.5" />
							)}
							Channels
						</button>
						<div
							className={cn("mt-1 space-y-0.5", !channelsExpanded && "hidden")}
						>
							{channelsLoading &&
								Array.from({ length: 4 }).map((_, index) => (
									<div
										key={index}
										className="mx-2 h-8 animate-pulse rounded-md bg-white/5"
									/>
								))}
							{channelsError && (
								<div className="mx-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
									Failed to load channels.
								</div>
							)}
							{!channelsLoading && !channelsError && channels.length === 0 && (
								<div className="mx-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400">
									Channels will appear as agents start collaborating.
								</div>
							)}
							{channels.map((channel) => (
								<button
									key={channel}
									type="button"
									onClick={() => setActiveChannel(channel)}
									className={cn(
										"flex w-full items-center gap-2 rounded-md border-l-2 px-3 py-1.5 text-sm transition-all",
										channel === activeChannel
											? "border-setra-500 bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]"
											: "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
									)}
								>
									<Hash className="h-3.5 w-3.5 shrink-0" />
									<span className="truncate">{channel}</span>
								</button>
							))}
						</div>
					</div>

					<div>
						<button
							type="button"
							onClick={() => setDmsExpanded((value) => !value)}
							className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:text-zinc-200"
						>
							{dmsExpanded ? (
								<ChevronDown className="h-3.5 w-3.5" />
							) : (
								<ChevronRight className="h-3.5 w-3.5" />
							)}
							Direct Messages
						</button>
						<div className={cn("mt-1 px-2", !dmsExpanded && "hidden")}>
							<div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/8 via-white/5 to-transparent px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
								<div className="flex items-start gap-2.5">
									<div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-setra-500/15 text-setra-300">
										<Sparkles className="h-3.5 w-3.5" />
									</div>
									<div>
										<div className="text-xs font-medium text-zinc-200">
											Direct messages coming soon
										</div>
										<p className="mt-1 text-[11px] leading-5 text-zinc-400">
											Private side conversations and 1:1 check-ins will land
											here.
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="border-t border-white/10 p-3">
					<div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
						<div className="relative shrink-0">
							<div className="flex h-9 w-9 items-center justify-center rounded-full bg-setra-600 text-xs font-semibold text-white">
								{initials(currentSenderName)}
							</div>
							<span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 bg-emerald-400" />
						</div>
						<div className="min-w-0">
							<div className="truncate text-sm font-medium text-white">
								{currentSenderName}
							</div>
							<div className="text-xs text-zinc-400">
								{currentSenderSubtitle}
							</div>
						</div>
					</div>
				</div>
			</aside>

			<section className="flex min-w-0 flex-1 flex-col bg-background">
				{!activeChannel ? (
					<div className="flex flex-1 items-center justify-center px-6">
						<div className="max-w-sm text-center">
							<MessageSquare className="mx-auto mb-4 h-10 w-10 text-muted-foreground/40" />
							<h2 className="text-lg font-semibold text-foreground">
								Pick a channel to start collaborating
							</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								Select a channel from the sidebar to jump into the conversation.
							</p>
						</div>
					</div>
				) : (
					<>
						<header className="flex items-start justify-between gap-4 border-b border-border/50 bg-background/95 px-6 py-3 backdrop-blur">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<Hash className="h-4 w-4 text-muted-foreground" />
									<h1 className="truncate text-base font-semibold text-foreground">
										{activeChannel}
									</h1>
								</div>
								<div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
									<span>{activeChannelDescription}</span>
									<span className="inline-flex items-center gap-1">
										<Users className="h-3.5 w-3.5" />
										{agents.length} member{agents.length === 1 ? "" : "s"}
									</span>
									<span>{activeChannelMessageCount} messages</span>
								</div>
							</div>
							<div className="flex items-center gap-1">
								<button
									type="button"
									className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
									title="Search"
								>
									<Search className="h-4 w-4" />
								</button>
								<button
									type="button"
									className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
									title="Channel settings"
								>
									<SlidersHorizontal className="h-4 w-4" />
								</button>
							</div>
						</header>

						<div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
							{pinnedMessages.length > 0 && (
								<div className="mb-6 space-y-3">
									{pinnedMessages.map((message) => {
										const meta = messageMeta.get(message.agentSlug);
										return (
											<div
												key={message.id}
												className="rounded-2xl border border-setra-500/20 bg-setra-500/5 px-4 py-3 shadow-sm"
											>
												<div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-setra-200">
													<Pin className="h-3.5 w-3.5" />
													<span className="font-medium">
														{message.messageKind === "pinned_sprint_board"
															? "Sprint Board"
															: "Pinned message"}
													</span>
													<span className="text-muted-foreground">
														{meta?.displayName ?? message.agentSlug} •{" "}
														{formatFullTimestamp(message.createdAt)}
													</span>
												</div>
												<MarkdownMessage body={message.body} />
											</div>
										);
									})}
								</div>
							)}

							{isLoading && (
								<div className="space-y-4">
									{Array.from({ length: 6 }).map((_, index) => (
										<div
											key={index}
											className="grid grid-cols-[44px_minmax(0,1fr)] gap-3"
										>
											<div className="h-9 w-9 animate-pulse rounded-full bg-muted/40" />
											<div className="space-y-2 pt-1">
												<div className="h-3 w-40 animate-pulse rounded bg-muted/40" />
												<div className="h-3 w-full animate-pulse rounded bg-muted/30" />
												<div className="h-3 w-2/3 animate-pulse rounded bg-muted/20" />
											</div>
										</div>
									))}
								</div>
							)}

							{messagesError && !isLoading && (
								<div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
									Unable to load messages for #{activeChannel}. Try again in a
									moment.
								</div>
							)}

							{!isLoading && !messagesError && streamMessages.length === 0 && (
								<div className="flex min-h-full items-center justify-center py-16">
									<div className="max-w-md text-center">
										<div className="mb-3 text-4xl">👋</div>
										<h2 className="text-xl font-semibold text-foreground">
											This is the very beginning of #{activeChannel}
										</h2>
										<p className="mt-2 text-sm text-muted-foreground">
											Agent collaboration starts here. Say hi, share context, or
											mention someone to kick things off.
										</p>
									</div>
								</div>
							)}

							{!isLoading && !messagesError && streamMessages.length > 0 && (
								<div className="space-y-0.5">
									{groupedMessages.map(
										({ message, isGrouped, showDayDivider, dayLabel }) => {
											const meta = messageMeta.get(message.agentSlug);
											const agent = agentDirectory.get(message.agentSlug);
											const isCurrentSender =
												message.agentSlug === "human" ||
												message.agentSlug === currentSenderSlug;
											const displayName = isCurrentSender
												? currentSenderName
												: (meta?.displayName ??
													agent?.role ??
													message.agentSlug);
											const secondaryLabel = isCurrentSender
												? currentSenderSlug === "human"
													? null
													: "You"
												: (meta?.secondaryLabel ?? null);
											const online = isCurrentSender
												? true
												: (meta?.online ?? false);

											return (
												<div key={message.id}>
													{showDayDivider && (
														<div className="sticky top-0 z-[1] my-4 flex items-center gap-3 bg-background/95 py-1 backdrop-blur-sm">
															<div className="h-px flex-1 bg-border/70" />
															<span className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
																{dayLabel}
															</span>
															<div className="h-px flex-1 bg-border/70" />
														</div>
													)}

													<div
														className={cn(
															"group relative rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/20",
															isGrouped && "pt-0.5",
														)}
														title={formatFullTimestamp(message.createdAt)}
													>
														<div className="absolute right-3 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border/70 bg-background/95 p-0.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
															{[
																{ icon: SmilePlus, label: "React" },
																{ icon: CornerUpLeft, label: "Reply" },
																{ icon: MoreHorizontal, label: "More" },
															].map((action) => (
																<button
																	key={action.label}
																	type="button"
																	className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
																	title={action.label}
																>
																	<action.icon className="h-3.5 w-3.5" />
																</button>
															))}
														</div>

														<div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
															<div className="pt-0.5">
																{!isGrouped && (
																	<div className="relative h-9 w-9 shrink-0">
																		<div
																			className={cn(
																				"flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-sm",
																				avatarColor(message.agentSlug),
																			)}
																		>
																			{initials(displayName)}
																		</div>
																		<span
																			className={cn(
																				"absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background",
																				online
																					? "bg-emerald-400"
																					: "bg-zinc-500",
																			)}
																		/>
																	</div>
																)}
															</div>

															<div
																className={cn("min-w-0", isGrouped && "pt-0.5")}
															>
																{!isGrouped && (
																	<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
																		<span className="text-sm font-semibold text-foreground">
																			{displayName}
																		</span>
																		{secondaryLabel && (
																			<span className="text-xs text-muted-foreground">
																				{secondaryLabel}
																			</span>
																		)}
																		<span className="text-xs text-muted-foreground">
																			{formatTime(message.createdAt)}
																		</span>
																	</div>
																)}
																<MarkdownMessage
																	body={message.body}
																	className={cn(!isGrouped && "mt-0.5")}
																/>
															</div>
														</div>
													</div>
												</div>
											);
										},
									)}
								</div>
							)}
						</div>

						<div className="border-t border-border/50 px-6 py-4">
							{sendError && (
								<div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
									{sendError}
								</div>
							)}
							<div className="relative rounded-2xl border border-border/60 bg-card shadow-sm transition-colors focus-within:border-setra-500/70 focus-within:ring-2 focus-within:ring-setra-500/20">
								{mentionOptions.length > 0 && mentionMatch && (
									<div className="absolute inset-x-3 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border/70 bg-popover shadow-2xl">
										{mentionOptions.map((agent, index) => (
											<button
												type="button"
												key={agent.slug}
												onClick={() => applyMention(agent.slug)}
												className={cn(
													"flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
													index === selectedMentionIndex
														? "bg-setra-500/10 text-foreground"
														: "hover:bg-muted/40",
												)}
											>
												<div className="relative h-8 w-8 shrink-0">
													<div
														className={cn(
															"flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold text-white",
															avatarColor(agent.slug),
														)}
													>
														{initials(agent.displayName)}
													</div>
													<span
														className={cn(
															"absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-popover",
															agent.online ? "bg-emerald-400" : "bg-zinc-500",
														)}
													/>
												</div>
												<div className="min-w-0">
													<div className="truncate text-sm font-medium text-foreground">
														{agent.displayName}
													</div>
													<div className="truncate text-xs text-muted-foreground">
														{agent.secondaryLabel ?? `@${agent.slug}`}
													</div>
												</div>
											</button>
										))}
									</div>
								)}

								<div className="relative pr-16">
									<textarea
										ref={textareaRef}
										rows={1}
										value={draft}
										onChange={(event) => {
											setDraft(event.target.value);
											setSendError(null);
										}}
										onKeyDown={(event) => {
											if (mentionOptions.length > 0 && mentionMatch) {
												if (event.key === "ArrowDown") {
													event.preventDefault();
													setSelectedMentionIndex(
														(index) => (index + 1) % mentionOptions.length,
													);
													return;
												}
												if (event.key === "ArrowUp") {
													event.preventDefault();
													setSelectedMentionIndex(
														(index) =>
															(index - 1 + mentionOptions.length) %
															mentionOptions.length,
													);
													return;
												}
												if (event.key === "Enter" && !event.shiftKey) {
													event.preventDefault();
													applyMention(
														mentionOptions[selectedMentionIndex]?.slug ??
															mentionOptions[0]!.slug,
													);
													return;
												}
												if (event.key === "Escape") {
													event.preventDefault();
													setSelectedMentionIndex(0);
													return;
												}
											}
											if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												send();
											}
										}}
										placeholder={`Message #${activeChannel}`}
										className="min-h-[96px] w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
									/>
									<button
										type="button"
										onClick={send}
										disabled={!draft.trim() || post.isPending}
										className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-setra-600 text-white transition-colors hover:bg-setra-500 disabled:cursor-not-allowed disabled:opacity-40"
										title="Send message"
									>
										{post.isPending ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Send className="h-4 w-4" />
										)}
									</button>
								</div>

								<div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 py-2">
									<div className="flex flex-wrap items-center gap-1">
										{[
											{ label: "B", title: "Bold" },
											{ label: "I", title: "Italic" },
											{ label: "<>", title: "Code" },
											{ label: "•", title: "List" },
											{ label: '"', title: "Quote" },
										].map((item) => (
											<button
												key={item.title}
												type="button"
												className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
												title={item.title}
											>
												{item.label}
											</button>
										))}
									</div>
									<div className="text-xs text-muted-foreground">
										<kbd className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-sans text-[11px]">
											Enter
										</kbd>{" "}
										to send •{" "}
										<kbd className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-sans text-[11px]">
											Shift
										</kbd>{" "}
										+{" "}
										<kbd className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-sans text-[11px]">
											Enter
										</kbd>{" "}
										for newline
									</div>
								</div>
							</div>
						</div>
					</>
				)}
			</section>
		</div>
	);
}
