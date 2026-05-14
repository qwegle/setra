import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronDown, Loader2, Send, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompany } from "../context/CompanyContext";
import { cn } from "../lib/utils";

interface Message {
	id: number;
	role: "user" | "assistant";
	content: string;
	quickActions?: { label: string; route: string }[];
}

interface AssistantAction {
	type: string;
	route?: string;
	label?: string;
	name?: string;
	params?: Record<string, unknown>;
	title?: string;
	description?: string;
}

interface AiCeoPanelProps {
	isOpen: boolean;
	onClose: () => void;
}

function parseQuickActions(text: string): {
	text: string;
	quickActions: { label: string; route: string }[];
} {
	// Support both QUICK_ACTIONS and ACTIONS block formats
	const qaMatch = text.match(/QUICK_ACTIONS:\s*(\[.*?\])/s);
	if (qaMatch?.[1]) {
		try {
			const quickActions = JSON.parse(qaMatch[1]) as {
				label: string;
				route: string;
			}[];
			const cleanText = text.replace(/QUICK_ACTIONS:\s*\[.*?\]/s, "").trim();
			return { text: cleanText, quickActions };
		} catch {
			/* fall through */
		}
	}
	const actMatch = text.match(/ACTIONS:\s*(\[[\s\S]*?\])\s*$/);
	if (actMatch?.[1]) {
		try {
			const actions = JSON.parse(actMatch[1]) as {
				type: string;
				route?: string;
				label?: string;
			}[];
			const quickActions = actions
				.filter((a) => a.type === "navigate" && a.route)
				.map((a) => ({
					label: a.label ?? a.route ?? "",
					route: a.route ?? "",
				}));
			const cleanText = text.replace(/ACTIONS:\s*\[[\s\S]*?\]\s*$/, "").trim();
			return { text: cleanText, quickActions };
		} catch {
			/* fall through */
		}
	}
	return { text, quickActions: [] };
}

export function AiCeoPanel({ isOpen, onClose }: AiCeoPanelProps) {
	const { selectedCompany } = useCompany();
	const navigate = useNavigate();
	const [messages, setMessages] = useState<Message[]>([]);
	const msgIdRef = useRef(0);
	const nextId = () => ++msgIdRef.current;
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const bottomRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const executeAction = useCallback(
		async (action: AssistantAction) => {
			if (action.type === "navigate") {
				if (action.route) navigate(action.route);
				onClose();
				return;
			}
			if (action.type === "create_issue") {
				try {
					const projRes = await fetch("/api/projects");
					const projects = projRes.ok
						? ((await projRes.json()) as { id: string }[])
						: [];
					const projectId = projects[0]?.id;
					if (!projectId) {
						navigate("/projects");
						onClose();
						return;
					}
					const res = await fetch("/api/issues", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							projectId,
							title: action.title,
							description: action.description ?? "",
							status: "todo",
							priority: "medium",
						}),
					});
					if (res.ok) {
						setMessages((prev) => [
							...prev,
							{
								id: nextId(),
								role: "assistant",
								content: `✅ Created issue: **${action.title}**. Your agents can now pick it up.`,
								quickActions: [{ label: "View Issues", route: "/projects" }],
							},
						]);
						navigate("/projects");
					}
				} catch {
					setMessages((prev) => [
						...prev,
						{
							id: nextId(),
							role: "assistant",
							content:
								"Couldn't create the issue right now. Go to Projects to create it manually.",
							quickActions: [{ label: "Projects", route: "/projects" }],
						},
					]);
				}
				return;
			}
			if (action.type === "create_agent") {
				navigate("/agents");
				onClose();
				return;
			}
			if (action.type === "tool" && typeof action.name === "string") {
				const toolName = action.name;
				const params = action.params ?? {};
				try {
					const res = await fetch(
						`/api/assistant/tools/${encodeURIComponent(toolName)}`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(params),
						},
					);
					const data = (await res.json()) as {
						ok?: boolean;
						error?: string;
						[k: string]: unknown;
					};
					if (data.ok) {
						const launchedCount =
							typeof data["launchedCount"] === "number"
								? (data["launchedCount"] as number)
								: null;
						setMessages((prev) => [
							...prev,
							{
								id: nextId(),
								role: "assistant",
								content:
									toolName === "run_agents_parallel" && launchedCount !== null
										? `✅ Started ${launchedCount} agents in parallel.`
										: `✅ Tool \`${toolName}\` ran successfully.`,
							},
						]);
					} else {
						setMessages((prev) => [
							...prev,
							{
								id: nextId(),
								role: "assistant",
								content: `⚠️ Tool \`${toolName}\` failed: ${data.error ?? "unknown error"}`,
							},
						]);
					}
				} catch (e) {
					setMessages((prev) => [
						...prev,
						{
							id: nextId(),
							role: "assistant",
							content: `⚠️ Tool \`${toolName}\` errored: ${(e as Error).message}`,
						},
					]);
				}
				return;
			}
			if (action.route) {
				navigate(action.route);
				onClose();
			}
		},
		[navigate, onClose],
	);

	// Welcome message on first open
	useEffect(() => {
		if (isOpen && messages.length === 0) {
			const companyName = selectedCompany?.name ?? "your company";
			const welcome = `Welcome to ${companyName}! 🚀 I'm your Assistant, ready to help you build great things.

What would you like to work on first?`;
			const { text, quickActions } = parseQuickActions(
				`${welcome}

QUICK_ACTIONS: [{"label": "Create first issue", "route": "/projects"}, {"label": "Set up agents", "route": "/agents"}, {"label": "Define goals", "route": "/goals"}, {"label": "Connect tools", "route": "/integrations"}]`,
			);
			setMessages([
				{ id: nextId(), role: "assistant", content: text, quickActions },
			]);
		}
	}, [isOpen, messages.length, selectedCompany]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length]);

	useEffect(() => {
		if (isOpen) inputRef.current?.focus();
	}, [isOpen]);

	const sendMessage = useCallback(
		async (text: string) => {
			if (!text.trim() || loading) return;

			const userMsg: Message = { id: nextId(), role: "user", content: text };
			const newMessages = [...messages, userMsg];
			setMessages(newMessages);
			setInput("");
			setLoading(true);

			try {
				const apiMessages = newMessages.map((m) => ({
					role: m.role,
					content: m.content,
				}));
				const resp = await fetch("/api/ai/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						messages: apiMessages,
						companyName: selectedCompany?.name,
						companyGoal: undefined,
					}),
				});

				if (resp.ok) {
					const data = (await resp.json()) as {
						reply: string;
						actions?: AssistantAction[];
					};
					const { text: cleanText, quickActions } = parseQuickActions(
						data.reply,
					);
					// Auto-execute non-navigate actions
					if (data.actions) {
						for (const action of data.actions) {
							if (action.type !== "navigate") {
								await executeAction(action);
								return;
							}
						}
					}
					const extraActions = (data.actions ?? [])
						.filter((a) => a.type === "navigate" && a.route)
						.map((a) => ({
							label: a.label ?? a.route ?? "",
							route: a.route ?? "",
						}));
					setMessages((prev) => [
						...prev,
						{
							id: nextId(),
							role: "assistant",
							content: cleanText,
							quickActions: [...quickActions, ...extraActions],
						},
					]);
				} else {
					const errorBody = (await resp.json().catch(async () => ({
						error: await resp.text().catch(() => ""),
					}))) as { error?: string };
					const content = errorBody.error?.includes("No AI provider configured")
						? "No AI provider configured. Go to Settings → AI Providers to add an API key."
						: "I'm having trouble connecting right now. Make sure your AI provider is configured in Settings.";
					setMessages((prev) => [
						...prev,
						{
							id: nextId(),
							role: "assistant",
							content,
							quickActions: [
								{ label: "Go to Settings → AI Providers", route: "/settings" },
							],
						},
					]);
				}
			} catch {
				setMessages((prev) => [
					...prev,
					{
						id: nextId(),
						role: "assistant",
						content: "Connection error. Please check your settings.",
						quickActions: [{ label: "Settings", route: "/settings" }],
					},
				]);
			} finally {
				setLoading(false);
			}
		},
		[messages, loading, selectedCompany, executeAction],
	);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			sendMessage(input);
		}
	};

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0, y: 20, scale: 0.95 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: 20, scale: 0.95 }}
					transition={{ duration: 0.2 }}
					className="fixed bottom-4 right-4 z-50 w-[380px] max-h-[560px] flex flex-col rounded-xl border border-border/50 bg-background shadow-2xl shadow-black/20"
				>
					{/* Header */}
					<div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-setra-600/10 rounded-t-xl shrink-0">
						<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-setra-600/20">
							<Zap className="w-4 h-4 text-setra-400" />
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-sm font-semibold text-foreground truncate">
								Assistant
							</p>
							<p className="text-xs text-muted-foreground truncate">
								{selectedCompany?.name ?? "Your company"}
							</p>
						</div>
						<button
							type="button"
							onClick={onClose}
							className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
						>
							<ChevronDown className="w-4 h-4" />
						</button>
					</div>

					{/* Messages */}
					<div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
						{messages.map((msg) => (
							<div
								key={msg.id}
								className={cn(
									"flex gap-3",
									msg.role === "user" && "flex-row-reverse",
								)}
							>
								{msg.role === "assistant" && (
									<div className="flex items-center justify-center w-7 h-7 rounded-full bg-setra-600/20 shrink-0 mt-0.5">
										<Bot className="w-3.5 h-3.5 text-setra-400" />
									</div>
								)}
								<div className={cn("flex flex-col gap-2 max-w-[85%]")}>
									<div
										className={cn(
											"rounded-xl px-3 py-2 text-sm leading-relaxed",
											msg.role === "assistant"
												? "bg-muted/50 text-foreground"
												: "bg-setra-600 text-[#2b2418] ml-auto",
										)}
									>
										{msg.content}
									</div>
									{msg.quickActions && msg.quickActions.length > 0 && (
										<div className="flex flex-wrap gap-1.5 mt-1">
											{msg.quickActions.map((action, j) => (
												<button
													type="button"
													key={`${action.route}-${action.label}`}
													onClick={() =>
														executeAction({
															type: "navigate",
															route: action.route,
															label: action.label,
														})
													}
													className="text-xs px-2.5 py-1 rounded-full border border-setra-500/40 text-setra-400 hover:bg-setra-600/10 hover:border-setra-500 transition-all"
												>
													{action.label}
												</button>
											))}
										</div>
									)}
								</div>
							</div>
						))}
						{loading && (
							<div className="flex gap-3">
								<div className="flex items-center justify-center w-7 h-7 rounded-full bg-setra-600/20 shrink-0">
									<Bot className="w-3.5 h-3.5 text-setra-400" />
								</div>
								<div className="bg-muted/50 rounded-xl px-3 py-2">
									<Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
								</div>
							</div>
						)}
						<div ref={bottomRef} />
					</div>

					{/* Input */}
					<div className="px-3 py-3 border-t border-border/50 shrink-0">
						<div className="flex gap-2">
							<input
								ref={inputRef}
								type="text"
								value={input}
								onChange={(e) => setInput(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="Ask your Assistant anything..."
								className="flex-1 bg-muted/40 border border-border/50 rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-setra-500/50"
							/>
							<button
								type="button"
								onClick={() => sendMessage(input)}
								disabled={!input.trim() || loading}
								className="flex items-center justify-center w-9 h-9 rounded-lg bg-setra-600 text-[#2b2418] disabled:opacity-40 hover:bg-setra-500 transition-colors shrink-0"
							>
								<Send className="w-3.5 h-3.5" />
							</button>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
