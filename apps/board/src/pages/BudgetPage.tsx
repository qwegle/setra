import { useQuery } from "@tanstack/react-query";
import {
	ArrowUpRight,
	BarChart3,
	Bot,
	Coins,
	TrendingDown,
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
import { api, costs } from "../lib/api";
import { cn, formatCost, formatTokens } from "../lib/utils";

// ─── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({
	data,
	color = "#4f7eff",
}: { data: number[]; color?: string }) {
	if (data.length < 2) return null;
	const max = Math.max(...data, 0.001);
	const pts = data
		.map((v, i) => {
			const x = (i / (data.length - 1)) * 200;
			const y = 40 - (v / max) * 36;
			return `${x},${y}`;
		})
		.join(" ");
	return (
		<svg
			viewBox="0 0 200 40"
			className="w-full h-10"
			preserveAspectRatio="none"
		>
			<polyline
				points={pts}
				fill="none"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// ─── Cache efficiency gauge (circular SVG) ──────────────────────────────────────

function CacheGauge({ pct }: { pct: number }) {
	const r = 32;
	const circumference = 2 * Math.PI * r;
	const filled = (pct / 100) * circumference;

	return (
		<div className="relative inline-flex items-center justify-center">
			<svg width={80} height={80} className="-rotate-90">
				{/* Track */}
				<circle
					cx={40}
					cy={40}
					r={r}
					fill="none"
					stroke="rgba(255,255,255,0.06)"
					strokeWidth={8}
				/>
				{/* Fill */}
				<circle
					cx={40}
					cy={40}
					r={r}
					fill="none"
					stroke="#22c55e"
					strokeWidth={8}
					strokeDasharray={`${filled} ${circumference}`}
					strokeLinecap="round"
					className="transition-all duration-700"
				/>
			</svg>
			<span className="absolute text-sm font-bold tabular-nums text-accent-green">
				{pct.toFixed(0)}%
			</span>
		</div>
	);
}

// ─── Period type ────────────────────────────────────────────────────────────────

type Period = "daily" | "weekly" | "monthly";

// ─── Page ───────────────────────────────────────────────────────────────────────

export function BudgetPage() {
	const [period, setPeriod] = useState<Period>("monthly");

	const { data: budget, isLoading } = useQuery({
		queryKey: ["budget"],
		queryFn: api.budget.summary,
		refetchInterval: 30_000,
	});

	const { data: costSummary } = useQuery({
		queryKey: ["costs-summary"],
		queryFn: costs.summary,
		refetchInterval: 30_000,
	});

	if (isLoading) {
		return (
			<div className="mx-auto w-full max-w-5xl space-y-6">
				<PageHeader
					title="Budget"
					subtitle="Track token spend, cost trends, and cache efficiency."
				/>
				<Skeleton variant="rect" height="180px" />
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} variant="rect" height="120px" />
					))}
				</div>
				<Skeleton variant="rect" height="240px" />
			</div>
		);
	}

	if (!budget) return null;

	const cacheHitPct = budget.cacheHitRate * 100;
	const savedCost = budget.estimatedCacheSavingsUsd ?? 0;

	const heroValue =
		period === "daily"
			? budget.dailyCostUsd
			: period === "weekly"
				? budget.weeklyCostUsd
				: budget.monthlyCostUsd;

	const heroLabel =
		period === "daily"
			? "Today"
			: period === "weekly"
				? "This week"
				: "This month";

	const sparkData = selectTrendData(costSummary?.dailySeries ?? [], period);
	const hasSparkData = sparkData.length >= 2;

	// Token totals for bar chart
	const totalTokens =
		budget.totalInputTokens +
			budget.totalOutputTokens +
			budget.totalCacheReadTokens || 1;

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6 animate-slide-in-up">
			<PageHeader
				title="Budget"
				subtitle="Track token spend, cost trends, and cache efficiency across your workspace."
				actions={<Badge variant="info">{heroLabel}</Badge>}
			/>
			{/* ── Hero metric + period tabs ── */}
			<Card>
				<div className="flex flex-col sm:flex-row sm:items-start gap-5">
					{/* Hero number */}
					<div className="flex-1">
						<div className="flex items-center gap-3 mb-1">
							<span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
								{heroLabel}
							</span>
							<span className="inline-flex items-center gap-0.5 text-[10px] text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded font-medium">
								<ArrowUpRight className="w-2.5 h-2.5" />
								live
							</span>
						</div>
						<p className="text-5xl font-bold tabular-nums text-foreground">
							{formatCost(heroValue)}
						</p>
						<p className="text-xs text-muted-foreground mt-2">
							{period === "monthly" &&
								`Daily avg: ${formatCost(budget.dailyCostUsd)}`}
							{period === "weekly" &&
								`Monthly projection: ${formatCost(budget.weeklyCostUsd * 4.3)}`}
							{period === "daily" &&
								`Weekly projection: ${formatCost(budget.dailyCostUsd * 7)}`}
						</p>
					</div>

					{/* Sparkline */}
					<div className="flex-1 min-w-0">
						{hasSparkData ? (
							<>
								<Sparkline data={sparkData} color="#4f7eff" />
								<p className="text-[10px] text-muted-foreground/40 text-right mt-1">
									real spend history
								</p>
							</>
						) : (
							<div className="h-10 flex items-center justify-end text-xs text-muted-foreground/50">
								No data yet
							</div>
						)}
					</div>
				</div>

				{/* Period selector */}
				<div className="mt-5 flex flex-wrap gap-2">
					{(["daily", "weekly", "monthly"] as Period[]).map((p) => (
						<Button
							key={p}
							type="button"
							variant={period === p ? "primary" : "secondary"}
							size="sm"
							onClick={() => setPeriod(p)}
							className="capitalize"
						>
							{p}
						</Button>
					))}
				</div>
			</Card>

			{/* ── Cost period cards ── */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				<PeriodCard
					label="Today"
					value={formatCost(budget.dailyCostUsd)}
					icon={Coins}
					color="text-accent-yellow"
					active={period === "daily"}
				/>
				<PeriodCard
					label="7 days"
					value={formatCost(budget.weeklyCostUsd)}
					icon={TrendingDown}
					color="text-setra-400"
					active={period === "weekly"}
				/>
				<PeriodCard
					label="30 days"
					value={formatCost(budget.monthlyCostUsd)}
					icon={BarChart3}
					color="text-accent-purple"
					active={period === "monthly"}
				/>
			</div>

			{/* ── Two column: cache + top agents ── */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				{/* Cache efficiency */}
				<Card title="Prompt cache efficiency">
					<h2 className="text-sm font-semibold mb-5 flex items-center gap-2">
						<Zap className="w-4 h-4 text-setra-400" />
						Prompt cache efficiency
					</h2>
					<div className="flex items-center gap-6">
						<CacheGauge pct={cacheHitPct} />
						<div className="space-y-3 flex-1">
							<StatRow
								label="Cache hit rate"
								value={`${cacheHitPct.toFixed(1)}%`}
								highlight
							/>
							<StatRow
								label="Tokens from cache"
								value={formatTokens(budget.totalCacheReadTokens)}
							/>
							<StatRow
								label="Est. cost savings"
								value={formatCost(savedCost)}
								valueClass="text-accent-green"
							/>
						</div>
					</div>

					{/* Cache bar */}
					<div className="mt-5">
						<div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
							<span>Cache utilisation</span>
							<span>{cacheHitPct.toFixed(1)}%</span>
						</div>
						<div className="h-1.5 bg-muted rounded-full overflow-hidden">
							<div
								className="h-full bg-gradient-to-r from-setra-600 to-accent-green rounded-full transition-all duration-700"
								style={{ width: `${Math.min(100, cacheHitPct)}%` }}
							/>
						</div>
					</div>
				</Card>

				{/* Top agents by cost */}
				{budget.topAgents.length > 0 ? (
					<Card title="Top spenders">
						<h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
							<Bot className="w-4 h-4 text-muted-foreground" />
							Top spenders
						</h2>
						<div className="space-y-2.5">
							{budget.topAgents.map((agent, i) => {
								const maxCost = budget.topAgents[0]?.costUsd ?? 1;
								const barPct = (agent.costUsd / maxCost) * 100;
								return (
									<div key={agent.slug}>
										<div className="flex items-center gap-2 mb-1">
											<span className="text-[10px] text-muted-foreground/50 w-4 tabular-nums">
												{i + 1}
											</span>
											<span className="font-mono text-xs flex-1 text-foreground/80 truncate">
												{agent.slug}
											</span>
											<span className="text-[10px] text-muted-foreground/60 shrink-0">
												{agent.model}
											</span>
											<span className="text-xs font-semibold tabular-nums shrink-0">
												{formatCost(agent.costUsd)}
											</span>
										</div>
										<div className="ml-6 h-1 bg-muted rounded-full overflow-hidden">
											<div
												className="h-full bg-setra-600 rounded-full transition-all duration-500"
												style={{ width: `${barPct}%` }}
											/>
										</div>
									</div>
								);
							})}
						</div>
					</Card>
				) : (
					<EmptyState
						icon={<Bot className="h-10 w-10" aria-hidden="true" />}
						title="No top spenders yet"
						description="Agent spend data will appear here once runs start accumulating cost."
					/>
				)}
			</div>

			{/* ── Token breakdown ── */}
			<Card title="Token breakdown — this month">
				<h2 className="text-sm font-semibold mb-5 flex items-center gap-2">
					<BarChart3 className="w-4 h-4 text-setra-400" />
					Token breakdown — this month
				</h2>
				<div className="space-y-4">
					<TokenBar
						label="Input tokens"
						value={budget.totalInputTokens}
						total={totalTokens}
						color="bg-setra-500"
						formatted={formatTokens(budget.totalInputTokens)}
					/>
					<TokenBar
						label="Output tokens"
						value={budget.totalOutputTokens}
						total={totalTokens}
						color="bg-accent-green"
						formatted={formatTokens(budget.totalOutputTokens)}
					/>
					<TokenBar
						label="Cache reads"
						value={budget.totalCacheReadTokens}
						total={totalTokens}
						color="bg-accent-yellow"
						formatted={formatTokens(budget.totalCacheReadTokens)}
						sub="(saved from cache)"
					/>
				</div>
			</Card>
		</div>
	);
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

function PeriodCard({
	label,
	value,
	icon: Icon,
	color,
	active,
}: {
	label: string;
	value: string;
	icon: React.ElementType;
	color: string;
	active?: boolean;
}) {
	return (
		<Card className={cn(active && "border-setra-600/50")}>
			<div className="flex items-center gap-2 mb-3">
				<Icon className={cn("w-4 h-4", color)} />
				<span className="text-xs text-muted-foreground">{label}</span>
			</div>
			<p className="text-2xl font-bold tabular-nums">{value}</p>
		</Card>
	);
}

function StatRow({
	label,
	value,
	highlight,
	valueClass,
}: {
	label: string;
	value: string;
	highlight?: boolean;
	valueClass?: string;
}) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span
				className={cn(
					"text-sm tabular-nums font-medium",
					highlight ? "text-foreground" : "text-muted-foreground",
					valueClass,
				)}
			>
				{value}
			</span>
		</div>
	);
}

function TokenBar({
	label,
	value,
	total,
	color,
	formatted,
	sub,
}: {
	label: string;
	value: number;
	total: number;
	color: string;
	formatted: string;
	sub?: string;
}) {
	const pct = Math.min(100, (value / total) * 100);
	return (
		<div>
			<div className="flex items-center justify-between mb-1.5">
				<div>
					<span className="text-xs text-muted-foreground">{label}</span>
					{sub && (
						<span className="text-[10px] text-muted-foreground/50 ml-1">
							{sub}
						</span>
					)}
				</div>
				<span className="text-xs font-mono font-semibold tabular-nums">
					{formatted}
				</span>
			</div>
			<div className="h-1.5 bg-muted rounded-full overflow-hidden">
				<div
					className={cn(
						"h-full rounded-full transition-all duration-700",
						color,
					)}
					style={{ width: `${pct}%` }}
				/>
			</div>
			<div className="text-[10px] text-muted-foreground/40 text-right mt-0.5">
				{pct.toFixed(1)}%
			</div>
		</div>
	);
}

function selectTrendData(
	dailySeries: Array<{ date: string; costUsd: number }>,
	period: Period,
): number[] {
	const points = period === "daily" ? 2 : period === "weekly" ? 7 : 30;
	return dailySeries.slice(-points).map((point) => point.costUsd);
}
