/**
 * AnalyticsCards — Dashboard-grade visual summary for OverviewPage.
 *
 * Renders four cards from /api/analytics/dashboard:
 *   1. Run Activity (stacked area: success / fail)
 *   2. Issues by Status (donut)
 *   3. Issues by Priority (bar)
 *   4. Success Rate trend (line + KPI strip)
 *
 * Built on recharts. Pure-presentational: data fetched at this level via
 * react-query so embedding pages don't have to wire it.
 */
import { useQuery } from "@tanstack/react-query";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { api } from "../lib/api";

const STATUS_COLORS: Record<string, string> = {
	backlog: "#8b95a7",
	todo: "#4f8bf0",
	in_progress: "#f0b84f",
	in_review: "#b07cf0",
	done: "#4fbf6a",
	cancelled: "#6b7280",
	blocked: "#ef4444",
};

const PRIORITY_COLORS: Record<string, string> = {
	none: "#6b7280",
	low: "#4f8bf0",
	medium: "#f0b84f",
	high: "#f06b4f",
	urgent: "#ef4444",
};

const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"] as const;

function KpiCard({
	label,
	value,
	hint,
}: { label: string; value: string | number; hint?: string }) {
	return (
		<div className="rounded-xl border border-border/40 bg-ground-900/40 px-4 py-3">
			<p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
				{label}
			</p>
			<p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
			{hint && (
				<p className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</p>
			)}
		</div>
	);
}

export function AnalyticsCards({ days = 14 }: { days?: number }) {
	const { data, isLoading, error } = useQuery({
		queryKey: ["analytics-dashboard", days],
		queryFn: () => api.analytics.dashboard(days),
		refetchInterval: 60_000,
		retry: false,
	});

	if (isLoading) {
		return (
			<div className="rounded-xl border border-border/40 bg-ground-900/30 px-4 py-6 text-sm text-muted-foreground">
				Loading analytics…
			</div>
		);
	}
	if (error || !data) {
		return (
			<div className="rounded-xl border border-border/40 bg-ground-900/30 px-4 py-6 text-sm text-muted-foreground">
				Analytics unavailable: {error instanceof Error ? error.message : "no data"}
			</div>
		);
	}

	const totalRuns = data.totals.runs;
	const overallSuccessRate = totalRuns
		? Math.round((data.totals.successes / totalRuns) * 100)
		: 0;

	const issuesByPrioritySorted = [...PRIORITY_ORDER]
		.map((p) => ({
			bucket: p,
			n: data.issuesByPriority.find((b) => b.bucket === p)?.n ?? 0,
		}))
		.filter((b) => b.n > 0);

	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<KpiCard label={`Runs (${days}d)`} value={totalRuns} />
				<KpiCard
					label="Success rate"
					value={`${overallSuccessRate}%`}
					hint={`${data.totals.successes} success / ${data.totals.fails} fail`}
				/>
				<KpiCard label="Open issues" value={data.totals.issues} />
				<KpiCard
					label="Failed runs"
					value={data.totals.fails}
					hint={`last ${days} days`}
				/>
			</div>

			<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<ChartCard title={`Run activity (last ${days} days)`}>
					<ResponsiveContainer width="100%" height={220}>
						<AreaChart data={data.runActivity}>
							<CartesianGrid stroke="rgba(255,255,255,0.06)" />
							<XAxis dataKey="date" stroke="#8b95a7" fontSize={10} tickFormatter={shortDate} />
							<YAxis stroke="#8b95a7" fontSize={10} allowDecimals={false} />
							<Tooltip
								contentStyle={tooltipStyle}
								labelFormatter={(v) => String(v)}
							/>
							<Legend wrapperStyle={{ fontSize: 11 }} />
							<Area
								type="monotone"
								dataKey="success"
								stackId="1"
								stroke="#4fbf6a"
								fill="#4fbf6a"
								fillOpacity={0.45}
							/>
							<Area
								type="monotone"
								dataKey="fail"
								stackId="1"
								stroke="#ef4444"
								fill="#ef4444"
								fillOpacity={0.45}
							/>
						</AreaChart>
					</ResponsiveContainer>
				</ChartCard>

				<ChartCard title="Issues by status">
					{data.issuesByStatus.length === 0 ? (
						<EmptyChart />
					) : (
						<ResponsiveContainer width="100%" height={220}>
							<PieChart>
								<Pie
									data={data.issuesByStatus}
									dataKey="n"
									nameKey="bucket"
									innerRadius={48}
									outerRadius={80}
									paddingAngle={2}
								>
									{data.issuesByStatus.map((entry) => (
										<Cell
											key={entry.bucket}
											fill={STATUS_COLORS[entry.bucket] ?? "#8b95a7"}
										/>
									))}
								</Pie>
								<Tooltip contentStyle={tooltipStyle} />
								<Legend wrapperStyle={{ fontSize: 11 }} />
							</PieChart>
						</ResponsiveContainer>
					)}
				</ChartCard>

				<ChartCard title="Issues by priority">
					{issuesByPrioritySorted.length === 0 ? (
						<EmptyChart />
					) : (
						<ResponsiveContainer width="100%" height={220}>
							<BarChart data={issuesByPrioritySorted}>
								<CartesianGrid stroke="rgba(255,255,255,0.06)" />
								<XAxis dataKey="bucket" stroke="#8b95a7" fontSize={10} />
								<YAxis stroke="#8b95a7" fontSize={10} allowDecimals={false} />
								<Tooltip contentStyle={tooltipStyle} />
								<Bar dataKey="n" radius={[4, 4, 0, 0]}>
									{issuesByPrioritySorted.map((entry) => (
										<Cell
											key={entry.bucket}
											fill={PRIORITY_COLORS[entry.bucket] ?? "#8b95a7"}
										/>
									))}
								</Bar>
							</BarChart>
						</ResponsiveContainer>
					)}
				</ChartCard>

				<ChartCard title="Success rate trend">
					<ResponsiveContainer width="100%" height={220}>
						<LineChart data={data.successRate}>
							<CartesianGrid stroke="rgba(255,255,255,0.06)" />
							<XAxis dataKey="date" stroke="#8b95a7" fontSize={10} tickFormatter={shortDate} />
							<YAxis
								stroke="#8b95a7"
								fontSize={10}
								domain={[0, 100]}
								tickFormatter={(v) => `${v}%`}
							/>
							<Tooltip
								contentStyle={tooltipStyle}
								formatter={(v) => [`${v}%`, "success"]}
							/>
							<Line
								type="monotone"
								dataKey="pct"
								stroke="#4fbf6a"
								strokeWidth={2}
								dot={false}
							/>
						</LineChart>
					</ResponsiveContainer>
				</ChartCard>
			</div>
		</div>
	);
}

function ChartCard({
	title,
	children,
}: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-xl border border-border/40 bg-ground-900/40 px-3 py-3">
			<p className="text-xs font-medium text-foreground/90 mb-2">{title}</p>
			{children}
		</div>
	);
}

function EmptyChart() {
	return (
		<div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground/70">
			No data yet.
		</div>
	);
}

const tooltipStyle: React.CSSProperties = {
	backgroundColor: "rgba(20, 24, 31, 0.95)",
	border: "1px solid rgba(255,255,255,0.08)",
	borderRadius: 6,
	fontSize: 11,
	color: "#e5e7eb",
};

function shortDate(d: string): string {
	return d.slice(5);
}
