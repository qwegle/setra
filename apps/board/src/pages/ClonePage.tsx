import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BookOpen,
	Brain,
	CheckCircle,
	ChevronRight,
	Eye,
	EyeOff,
	Lightbulb,
	Lock,
	MessageSquare,
	RefreshCw,
	Unlock,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/utils";

// Clone-specific API (slim wrapper — reuses the same base)
const cloneApi = {
	profile: api.clone.profile,
	pending: api.clone.questions,
	answer: api.clone.answer,
	setMode: api.clone.setMode,
	regenerateBrief: api.clone.regenerateBrief,
};

interface CloneProfile {
	id: string;
	name: string;
	mode: "training" | "locked";
	brief: string | null;
	trainedAt: string | null;
	lockedAt: string | null;
}

interface QaItem {
	id: string;
	question: string;
	aspect: string;
	answer: string | null;
}

const aspectLabel: Record<string, string> = {
	values: "Your values",
	risk: "Risk tolerance",
	style: "Work style",
	domain: "Domain knowledge",
	priority: "Priorities",
	general: "General",
};

const TRAINING_TIPS = [
	{
		icon: MessageSquare,
		title: "Answer questions",
		desc: "Work through the questions below — each answer improves precision.",
	},
	{
		icon: BookOpen,
		title: "Write issue descriptions",
		desc: "Detailed issue descriptions are automatically captured as training data.",
	},
	{
		icon: Zap,
		title: "Make decisions",
		desc: "When you approve, reject or comment, your clone learns your judgment style.",
	},
	{
		icon: Lightbulb,
		title: "Regenerate the brief",
		desc: "Click ↻ after new activity to refresh what your clone knows about you.",
	},
];

export function ClonePage() {
	const qc = useQueryClient();
	const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
	const [showBrief, setShowBrief] = useState(true);

	const { data: profile, isLoading: pLoading } = useQuery<CloneProfile>({
		queryKey: ["clone", "profile"],
		queryFn: cloneApi.profile,
	});
	const { data: questions = [], isLoading: qLoading } = useQuery<QaItem[]>({
		queryKey: ["clone", "questions"],
		queryFn: cloneApi.pending,
	});

	const answer = useMutation({
		mutationFn: ({ id, a }: { id: string; a: string }) =>
			cloneApi.answer(id, a),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["clone"] }),
	});
	const setMode = useMutation({
		mutationFn: (mode: "training" | "locked") => cloneApi.setMode(mode),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["clone"] }),
	});
	const regenerate = useMutation({
		mutationFn: cloneApi.regenerateBrief,
		onSuccess: () => qc.invalidateQueries({ queryKey: ["clone", "profile"] }),
	});

	if (pLoading) {
		return (
			<div className="max-w-3xl space-y-4">
				<div className="h-48 glass rounded-xl animate-pulse" />
				<div className="h-40 glass rounded-xl animate-pulse" />
			</div>
		);
	}

	const isLocked = profile?.mode === "locked";
	const unanswered = questions.filter((q) => !q.answer).length;
	const answered = questions.filter((q) => q.answer).length;

	const modeBadge = isLocked
		? "bg-setra-600/15 text-setra-300 border-setra-600/20"
		: "bg-accent-green/15 text-accent-green border-accent-green/20";

	return (
		<div className="max-w-3xl space-y-5">
			{/* ── Profile header card ───────────────────────────────────────── */}
			<div
				className={cn(
					"glass rounded-xl p-6 border transition-all",
					isLocked
						? "border-setra-600/60 shadow-lg shadow-setra-600/10"
						: "border-border/50",
				)}
			>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-4">
						<div
							className={cn(
								"p-3 rounded-xl",
								isLocked
									? "bg-setra-600/20 text-setra-300"
									: "bg-muted/60 text-muted-foreground",
							)}
						>
							<Brain className="w-6 h-6" />
						</div>
						<div>
							<div className="flex items-center gap-2 flex-wrap">
								<h2 className="text-lg font-semibold text-foreground">
									{profile?.name ?? "My Clone"}
								</h2>
								<span
									className={cn(
										"text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
										modeBadge,
									)}
								>
									{isLocked ? "Active" : "Training"}
								</span>
							</div>

							<p className="text-sm text-muted-foreground mt-0.5">
								{isLocked ? (
									<span className="flex items-center gap-1.5 text-setra-400">
										<Lock className="w-3.5 h-3.5" />
										Acting as you — directing agents in your style
									</span>
								) : (
									<span className="flex items-center gap-1.5">
										<Zap className="w-3.5 h-3.5 text-accent-green" />
										Learning from everything you write and decide
									</span>
								)}
							</p>

							{/* Meta row */}
							<div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground/60">
								{questions.length > 0 && (
									<span>
										{answered}/{questions.length} questions answered
									</span>
								)}
								{profile?.trainedAt && (
									<span>Last trained {timeAgo(profile.trainedAt)}</span>
								)}
								{profile?.lockedAt && isLocked && (
									<span>Locked {timeAgo(profile.lockedAt)}</span>
								)}
							</div>
						</div>
					</div>

					<button
						type="button"
						onClick={() => setMode.mutate(isLocked ? "training" : "locked")}
						disabled={setMode.isPending}
						className={cn(
							"flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all shrink-0",
							isLocked
								? "bg-muted hover:bg-muted/80 text-foreground"
								: "bg-setra-600 hover:bg-setra-500 text-[#2b2418] shadow-lg shadow-setra-600/20",
						)}
					>
						{isLocked ? (
							<>
								<Unlock className="w-4 h-4" /> Resume training
							</>
						) : (
							<>
								<Lock className="w-4 h-4" /> Lock &amp; activate
							</>
						)}
					</button>
				</div>

				{/* Brief section */}
				<div className="mt-5 border-t border-border/30 pt-4">
					<div className="flex items-center justify-between mb-2">
						<span className="text-xs font-medium text-muted-foreground/70">
							Clone brief — what your clone knows about you
						</span>
						<div className="flex gap-1">
							<button
								onClick={() => setShowBrief((v) => !v)}
								className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors"
								title={showBrief ? "Hide brief" : "Show brief"}
							>
								{showBrief ? (
									<EyeOff className="w-3.5 h-3.5" />
								) : (
									<Eye className="w-3.5 h-3.5" />
								)}
							</button>
							<button
								onClick={() => regenerate.mutate()}
								disabled={regenerate.isPending}
								className="p-1 rounded hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors"
								title="Regenerate brief from observations"
							>
								<RefreshCw
									className={cn(
										"w-3.5 h-3.5",
										regenerate.isPending && "animate-spin",
									)}
								/>
							</button>
						</div>
					</div>

					{showBrief &&
						(profile?.brief ? (
							<div className="p-4 rounded-lg bg-muted/40 text-sm text-muted-foreground leading-relaxed border border-border/30 whitespace-pre-wrap">
								{profile.brief}
							</div>
						) : (
							<div className="p-4 rounded-lg bg-muted/30 border border-dashed border-border/30 text-xs text-muted-foreground/50 text-center">
								No brief yet — answer the questions below or click ↻ to generate
								from your activity.
							</div>
						))}
				</div>
			</div>

			{/* ── How the clone works ────────────────────────────────────────── */}
			<div className="glass rounded-xl p-5">
				<h3 className="text-sm font-semibold text-foreground mb-4">
					Training tips
				</h3>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{TRAINING_TIPS.map(({ icon: Icon, title, desc }) => (
						<div
							key={title}
							className="flex gap-3 p-3 rounded-lg bg-muted/30 border border-border/20"
						>
							<div className="p-1.5 rounded-md bg-setra-600/10 shrink-0 self-start">
								<Icon className="w-3.5 h-3.5 text-setra-400" />
							</div>
							<div>
								<p className="text-xs font-semibold text-foreground mb-0.5">
									{title}
								</p>
								<p className="text-xs text-muted-foreground leading-relaxed">
									{desc}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* ── Pending questions ──────────────────────────────────────────── */}
			{!qLoading && questions.length > 0 && (
				<div className="glass rounded-xl p-5">
					<h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
						<MessageSquare className="w-4 h-4 text-accent-yellow" />
						Your clone is asking
					</h3>
					{unanswered > 0 && (
						<p className="text-xs text-muted-foreground mb-4">
							{unanswered} question{unanswered !== 1 ? "s" : ""} waiting for
							your input
						</p>
					)}
					<div className="space-y-3">
						{questions.map((q) => (
							<div
								key={q.id}
								className={cn(
									"rounded-lg p-4 border transition-opacity",
									q.answer
										? "border-border/20 opacity-60"
										: "border-setra-600/30 bg-setra-600/5",
								)}
							>
								<div className="flex items-start gap-3">
									<Brain className="w-4 h-4 text-setra-400 mt-0.5 shrink-0" />
									<div className="flex-1 min-w-0">
										<p className="text-[10px] text-muted-foreground/60 mb-1 font-mono uppercase tracking-wide">
											{aspectLabel[q.aspect] ?? q.aspect}
										</p>
										<p className="text-sm text-foreground mb-3">{q.question}</p>
										{q.answer ? (
											<div className="flex items-start gap-1.5 text-xs text-accent-green">
												<CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
												<span className="leading-relaxed">{q.answer}</span>
											</div>
										) : (
											<form
												onSubmit={(e) => {
													e.preventDefault();
													const a = answerDraft[q.id]?.trim();
													if (a) answer.mutate({ id: q.id, a });
												}}
												className="flex gap-2"
											>
												<input
													value={answerDraft[q.id] ?? ""}
													onChange={(e) =>
														setAnswerDraft((d) => ({
															...d,
															[q.id]: e.target.value,
														}))
													}
													placeholder="Your answer…"
													className="flex-1 bg-input border border-border rounded-md px-3 py-1.5 text-sm text-foreground outline-none focus:border-setra-600 transition-colors placeholder:text-muted-foreground/40"
												/>
												<button
													type="submit"
													disabled={
														answer.isPending || !answerDraft[q.id]?.trim()
													}
													className="px-3 py-1.5 text-xs rounded-md bg-setra-600 hover:bg-setra-500 text-[#2b2418] transition-colors flex items-center gap-1 disabled:opacity-40"
												>
													<ChevronRight className="w-3.5 h-3.5" />
												</button>
											</form>
										)}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Empty questions state */}
			{!qLoading && questions.length === 0 && (
				<div className="glass rounded-xl p-8 text-center">
					<CheckCircle className="w-8 h-8 text-accent-green mx-auto mb-3" />
					<h3 className="text-sm font-semibold text-foreground mb-1">
						No pending questions
					</h3>
					<p className="text-xs text-muted-foreground">
						Your clone will generate more questions as it learns. Keep making
						decisions and writing issue descriptions.
					</p>
				</div>
			)}
		</div>
	);
}
