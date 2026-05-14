import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	ArrowUpRight,
	BarChart3,
	Bot,
	CheckCircle,
	Coins,
	DollarSign,
	Download,
	Edit2,
	Folder,
	Loader2,
	Plus,
	Save,
	Settings2,
	Target,
	Trash2,
	TrendingDown,
	TrendingUp,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, PageHeader } from "../components/ui";
import { type CostSummary, api, costs, request } from "../lib/api";
import { cn } from "../lib/utils";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(n: number | undefined): string {
	if (n === undefined) return "—";
	return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

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
			className="h-10 w-full"
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

function selectTrendData(
	dailySeries: Array<{ date: string; costUsd: number }>,
	period: Period,
): number[] {
	const points = period === "daily" ? 2 : period === "weekly" ? 7 : 30;
	return dailySeries.slice(-points).map((point) => point.costUsd);
}

function StatCard({
	label,
	value,
	icon: Icon,
	danger,
}: {
	label: string;
	value: string;
	icon: React.ElementType;
	danger?: boolean | undefined;
}) {
	return (
		<div className="glass rounded-lg p-4 flex flex-col gap-2">
			<div className="flex items-center gap-2 text-muted-foreground/60">
				<Icon className="w-4 h-4" />
				<span className="text-[10px] font-semibold uppercase tracking-wider">
					{label}
				</span>
			</div>
			<p
				className={cn(
					"text-2xl font-bold tabular-nums",
					danger && "text-accent-red",
				)}
			>
				{value}
			</p>
		</div>
	);
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

type Period = "daily" | "weekly" | "monthly";
type Tab = "overview" | "budgets" | "providers" | "billing" | "reports";

const TABS: { id: Tab; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "budgets", label: "Budgets" },
	{ id: "providers", label: "Providers" },
	{ id: "billing", label: "Billing" },
	{ id: "reports", label: "Reports" },
];

// ─── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ summary }: { summary: CostSummary | undefined }) {
	const [period, setPeriod] = useState<Period>("monthly");
	const { data: budget } = useQuery({
		queryKey: ["budget"],
		queryFn: api.budget.summary,
		refetchInterval: 30_000,
	});

	if (!summary) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
				<Loader2 className="w-4 h-4 animate-spin" /> Loading…
			</div>
		);
	}

	const isOverBudget = summary.projectedMonthEndUsd > summary.budgetMonthlyUsd;
	const heroValue = budget
		? period === "daily"
			? budget.dailyCostUsd
			: period === "weekly"
				? budget.weeklyCostUsd
				: budget.monthlyCostUsd
		: undefined;
	const heroLabel =
		period === "daily"
			? "Today"
			: period === "weekly"
				? "This week"
				: "This month";
	const sparkData = selectTrendData(summary.dailySeries ?? [], period);
	const hasSparkData = sparkData.length >= 2;

	return (
		<div className="space-y-6">
			<div className="glass rounded-lg p-5">
				<div className="flex flex-col gap-5 sm:flex-row sm:items-start">
					<div className="flex-1">
						<div className="mb-1 flex items-center gap-3">
							<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								{heroLabel}
							</span>
							<span className="inline-flex items-center gap-0.5 rounded bg-accent-green/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
								<ArrowUpRight className="h-2.5 w-2.5" />
								live
							</span>
						</div>
						<p className="text-5xl font-bold tabular-nums text-foreground">
							{fmtUsd(heroValue)}
						</p>
						<p className="mt-2 text-xs text-muted-foreground">
							{budget
								? period === "monthly"
									? `Daily avg: ${fmtUsd(budget.dailyCostUsd)}`
									: period === "weekly"
										? `Monthly projection: ${fmtUsd(budget.weeklyCostUsd * 4.3)}`
										: `Weekly projection: ${fmtUsd(budget.dailyCostUsd * 7)}`
								: "Loading budget trend…"}
						</p>
					</div>
					<div className="min-w-0 flex-1">
						{hasSparkData ? (
							<>
								<Sparkline data={sparkData} color="#4f7eff" />
								<p className="mt-1 text-right text-[10px] text-muted-foreground/40">
									real spend history
								</p>
							</>
						) : (
							<div className="flex h-10 items-center justify-end text-xs text-muted-foreground/50">
								No data yet
							</div>
						)}
					</div>
				</div>

				<div className="mt-5 flex flex-wrap gap-2">
					{(["daily", "weekly", "monthly"] as Period[]).map((value) => (
						<Button
							key={value}
							type="button"
							variant={period === value ? "primary" : "secondary"}
							size="sm"
							onClick={() => setPeriod(value)}
							className="capitalize"
						>
							{value}
						</Button>
					))}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
				<StatCard
					label="Today"
					value={fmtUsd(budget?.dailyCostUsd)}
					icon={Coins}
				/>
				<StatCard
					label="7 Days"
					value={fmtUsd(budget?.weeklyCostUsd)}
					icon={TrendingDown}
				/>
				<StatCard
					label="30 Days"
					value={fmtUsd(budget?.monthlyCostUsd)}
					icon={BarChart3}
				/>
			</div>

			{/* Stat grid */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard
					label="Spend MTD"
					value={fmtUsd(summary.totalMtdUsd)}
					icon={DollarSign}
				/>
				<StatCard
					label="Monthly Budget"
					value={fmtUsd(summary.budgetMonthlyUsd)}
					icon={Target}
				/>
				<StatCard
					label="Projected Month-End"
					value={fmtUsd(summary.projectedMonthEndUsd)}
					icon={TrendingUp}
					danger={isOverBudget}
				/>
				<StatCard
					label="Cost per Task"
					value={fmtUsd(summary.costPerTaskUsd)}
					icon={BarChart3}
				/>
			</div>

			{/* Top agents */}
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
					Top Agents by Cost
				</p>
				<div className="glass rounded-lg overflow-hidden">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border/20 text-muted-foreground/60">
								<th className="text-left px-4 py-2.5 w-10 text-xs font-medium">
									#
								</th>
								<th className="text-left px-4 py-2.5 text-xs font-medium">
									Agent
								</th>
								<th className="text-right px-4 py-2.5 text-xs font-medium">
									Tasks
								</th>
								<th className="text-right px-4 py-2.5 text-xs font-medium">
									Tokens
								</th>
								<th className="text-right px-4 py-2.5 text-xs font-medium">
									Cost
								</th>
							</tr>
						</thead>
						<tbody>
							{summary.byAgent.length === 0 ? (
								<tr>
									<td
										colSpan={5}
										className="text-center py-6 text-muted-foreground/40 text-xs"
									>
										No data yet
									</td>
								</tr>
							) : (
								summary.byAgent.map((row, i) => (
									<tr
										key={row.agentId ?? row.agentSlug ?? i}
										className="border-b border-border/10 last:border-0 hover:bg-muted/20"
									>
										<td className="px-4 py-2.5 text-muted-foreground/40 tabular-nums">
											{i + 1}
										</td>
										<td className="px-4 py-2.5 font-mono text-xs">
											{row.agentSlug}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-xs">
											{row.tasks}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-xs">
											{fmtTokens(row.tokens)}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
											{fmtUsd(row.costUsd)}
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>

			{/* Top projects */}
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
					Top Projects by Cost
				</p>
				<div className="glass rounded-lg overflow-hidden">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border/20 text-muted-foreground/60">
								<th className="text-left px-4 py-2.5 w-10 text-xs font-medium">
									#
								</th>
								<th className="text-left px-4 py-2.5 text-xs font-medium">
									Project
								</th>
								<th className="text-right px-4 py-2.5 text-xs font-medium">
									Tasks
								</th>
								<th className="text-right px-4 py-2.5 text-xs font-medium">
									Tokens
								</th>
								<th className="text-right px-4 py-2.5 text-xs font-medium">
									Cost
								</th>
							</tr>
						</thead>
						<tbody>
							{summary.byProject.length === 0 ? (
								<tr>
									<td
										colSpan={5}
										className="text-center py-6 text-muted-foreground/40 text-xs"
									>
										No data yet
									</td>
								</tr>
							) : (
								summary.byProject.map((row, i) => (
									<tr
										key={row.projectId}
										className="border-b border-border/10 last:border-0 hover:bg-muted/20"
									>
										<td className="px-4 py-2.5 text-muted-foreground/40 tabular-nums">
											{i + 1}
										</td>
										<td className="px-4 py-2.5 text-sm">{row.projectName}</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-xs">
											{row.tasks}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-xs">
											{fmtTokens(row.tokens)}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium">
											{fmtUsd(row.costUsd)}
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

// ─── Budgets Tab ───────────────────────────────────────────────────────────────

type SettingsBudgetResponse = {
	budget: {
		dailyUsd: number;
		perRunUsd: number;
		alertAt: number;
	};
};

function BudgetsTab() {
	const qc = useQueryClient();
	const [dailyCap, setDailyCap] = useState(0);
	const [perRunCap, setPerRunCap] = useState(0);
	const [alertThreshold, setAlertThreshold] = useState(0);
	const [globalBudget, setGlobalBudget] = useState("");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editLimit, setEditLimit] = useState("");
	const [showAddForm, setShowAddForm] = useState(false);
	const [newAgentId, setNewAgentId] = useState("");
	const [newLimit, setNewLimit] = useState("");

	const { data: budgets = [], isLoading } = useQuery({
		queryKey: ["costs-budgets"],
		queryFn: costs.budgets.list,
	});

	const { data: globalSettings } = useQuery({
		queryKey: ["budget-settings"],
		queryFn: api.budget.settings,
	});
	const { data: settings } = useQuery({
		queryKey: ["settings"],
		queryFn: () => request<SettingsBudgetResponse>("/settings"),
	});

	useEffect(() => {
		if (globalSettings && globalSettings.limitUsd !== null) {
			setGlobalBudget(String(globalSettings.limitUsd));
		}
	}, [globalSettings]);

	useEffect(() => {
		if (!settings) return;
		setDailyCap(settings.budget.dailyUsd);
		setPerRunCap(settings.budget.perRunUsd);
		setAlertThreshold(settings.budget.alertAt);
	}, [settings]);

	const { data: agents = [] } = useQuery({
		queryKey: ["agents"],
		queryFn: api.agents.list,
	});

	const updateMutation = useMutation({
		mutationFn: async ({
			agentId,
			limitUsd,
		}: { agentId: string; limitUsd: number }) => {
			if (agentId === "global") {
				return api.budget.updateSettings({ limitUsd });
			}
			await costs.budgets.update(agentId, limitUsd);
			return { ok: true };
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["costs-budgets"] });
			void qc.invalidateQueries({ queryKey: ["budget-settings"] });
		},
	});
	const saveBudgetConfig = useMutation({
		mutationFn: () =>
			request<{ ok: boolean }>("/settings", {
				method: "POST",
				body: JSON.stringify({
					budget: {
						dailyUsd: dailyCap,
						perRunUsd: perRunCap,
						alertAt: alertThreshold,
					},
				}),
			}),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["settings"] });
		},
	});

	return (
		<div className="space-y-6">
			<div className="glass rounded-lg p-4">
				<div className="mb-4 flex items-center justify-between gap-3">
					<div>
						<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
							Budget Configuration
						</p>
						<p className="mt-1 text-xs text-muted-foreground/60">
							Set workspace-wide spend controls for daily usage and single runs.
						</p>
					</div>
					<button
						className="flex items-center gap-1.5 rounded bg-setra-600 px-3 py-2 text-sm font-medium text-[#2b2418] transition-colors hover:bg-setra-600/80 disabled:opacity-50"
						onClick={() => saveBudgetConfig.mutate()}
						disabled={saveBudgetConfig.isPending}
					>
						<Save className="h-3 w-3" /> Save
					</button>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					<div>
						<label className="mb-1 block text-sm font-medium">Daily cap</label>
						<p className="mb-2 text-xs text-muted-foreground/60">
							Hard stop when reached (USD/day).
						</p>
						<input
							type="number"
							min={0}
							step={0.01}
							value={dailyCap}
							onChange={(e) => setDailyCap(Number(e.target.value))}
							className="w-full rounded border border-border/40 bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
					</div>
					<div>
						<label className="mb-1 block text-sm font-medium">
							Per-run cap
						</label>
						<p className="mb-2 text-xs text-muted-foreground/60">
							Maximum spend per agent launch (USD/run).
						</p>
						<input
							type="number"
							min={0}
							step={0.01}
							value={perRunCap}
							onChange={(e) => setPerRunCap(Number(e.target.value))}
							className="w-full rounded border border-border/40 bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
					</div>
					<div>
						<label className="mb-1 block text-sm font-medium">
							Alert threshold
						</label>
						<p className="mb-2 text-xs text-muted-foreground/60">
							Warn when this fraction of the daily cap is used (0–1).
						</p>
						<input
							type="number"
							min={0}
							max={1}
							step={0.05}
							value={alertThreshold}
							onChange={(e) => setAlertThreshold(Number(e.target.value))}
							className="w-full rounded border border-border/40 bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
					</div>
				</div>
			</div>

			{/* Global budget */}
			<div className="glass rounded-lg p-4">
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
					Global Monthly Budget
				</p>
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground/60 text-sm">$</span>
					<input
						type="number"
						value={globalBudget}
						onChange={(e) => setGlobalBudget(e.target.value)}
						placeholder="e.g. 500"
						className="w-40 bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
					/>
					<button
						className="flex items-center gap-1.5 px-3 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-[#2b2418] text-sm font-medium transition-colors"
						onClick={() => {
							const n = Number.parseFloat(globalBudget);
							if (!isNaN(n))
								updateMutation.mutate({ agentId: "global", limitUsd: n });
						}}
					>
						<Save className="w-3 h-3" /> Save
					</button>
				</div>
			</div>

			{/* Per-agent budgets */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
						Per-Agent Budgets
					</p>
					<button
						className="text-xs flex items-center gap-1 text-setra-300 hover:text-setra-200"
						onClick={() => setShowAddForm((v) => !v)}
					>
						<Plus className="w-3 h-3" /> Add rule
					</button>
				</div>

				{showAddForm && (
					<div className="glass rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
						<select
							value={newAgentId}
							onChange={(e) => setNewAgentId(e.target.value)}
							className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						>
							<option value="">Select agent…</option>
							{agents.map((a) => (
								<option key={a.id} value={a.id}>
									{a.slug}
								</option>
							))}
						</select>
						<span className="text-muted-foreground/60 text-sm">$</span>
						<input
							type="number"
							value={newLimit}
							onChange={(e) => setNewLimit(e.target.value)}
							placeholder="Limit USD"
							className="w-32 bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
						<button
							className="px-3 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-[#2b2418] text-sm font-medium transition-colors"
							onClick={() => {
								const n = Number.parseFloat(newLimit);
								if (newAgentId && !isNaN(n)) {
									updateMutation.mutate({ agentId: newAgentId, limitUsd: n });
									setShowAddForm(false);
									setNewAgentId("");
									setNewLimit("");
								}
							}}
						>
							Add
						</button>
					</div>
				)}

				{isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
						<Loader2 className="w-4 h-4 animate-spin" /> Loading…
					</div>
				) : (
					<div className="glass rounded-lg overflow-hidden">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-border/20 text-muted-foreground/60">
									<th className="text-left px-4 py-2.5 text-xs font-medium">
										Agent
									</th>
									<th className="text-right px-4 py-2.5 text-xs font-medium">
										Monthly Limit
									</th>
									<th className="text-right px-4 py-2.5 text-xs font-medium">
										Used
									</th>
									<th className="px-4 py-2.5 text-xs font-medium w-40">
										Usage
									</th>
									<th className="px-4 py-2.5 text-xs font-medium w-20" />
								</tr>
							</thead>
							<tbody>
								{budgets.length === 0 ? (
									<tr>
										<td
											colSpan={5}
											className="text-center py-6 text-muted-foreground/40 text-xs"
										>
											No budget rules configured
										</td>
									</tr>
								) : (
									budgets.map((b) => {
										const pct =
											b.limitUsd > 0
												? Math.min((b.usedUsd / b.limitUsd) * 100, 100)
												: 0;
										return (
											<tr
												key={b.agentId}
												className="border-b border-border/10 last:border-0 hover:bg-muted/20"
											>
												<td className="px-4 py-3 font-mono text-xs">
													{b.agentSlug}
												</td>
												<td className="px-4 py-3 text-right tabular-nums text-xs">
													{editingId === b.agentId ? (
														<input
															autoFocus
															type="number"
															value={editLimit}
															onChange={(e) => setEditLimit(e.target.value)}
															onBlur={() => {
																const n = Number.parseFloat(editLimit);
																if (!isNaN(n))
																	updateMutation.mutate({
																		agentId: b.agentId,
																		limitUsd: n,
																	});
																setEditingId(null);
															}}
															className="w-24 bg-muted/40 border border-border/40 rounded px-2 py-1 text-xs text-right focus:outline-none"
														/>
													) : (
														fmtUsd(b.limitUsd)
													)}
												</td>
												<td className="px-4 py-3 text-right tabular-nums text-xs">
													{fmtUsd(b.usedUsd)}
												</td>
												<td className="px-4 py-3">
													<div className="h-1.5 rounded-full bg-muted overflow-hidden">
														<div
															className={cn(
																"h-full rounded-full transition-all",
																pct >= 90
																	? "bg-accent-red"
																	: pct >= 70
																		? "bg-accent-yellow"
																		: "bg-accent-green",
															)}
															style={{ width: `${pct}%` }}
														/>
													</div>
													<p className="text-[10px] text-muted-foreground/40 mt-0.5 text-right tabular-nums">
														{pct.toFixed(0)}%
													</p>
												</td>
												<td className="px-4 py-3">
													<div className="flex items-center gap-1 justify-end">
														<button
															className="p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground transition-colors"
															onClick={() => {
																setEditingId(b.agentId);
																setEditLimit(String(b.limitUsd));
															}}
														>
															<Edit2 className="w-3.5 h-3.5" />
														</button>
														<button
															className="p-1 rounded hover:bg-accent-red/10 text-muted-foreground/50 hover:text-accent-red transition-colors"
															onClick={() =>
																updateMutation.mutate({
																	agentId: b.agentId,
																	limitUsd: 0,
																})
															}
														>
															<Trash2 className="w-3.5 h-3.5" />
														</button>
													</div>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

// ─── Providers Tab ─────────────────────────────────────────────────────────────

function ProvidersTab() {
	const { data: providers = [], isLoading } = useQuery({
		queryKey: ["costs-providers"],
		queryFn: costs.providers,
	});

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
				<Loader2 className="w-4 h-4 animate-spin" /> Loading…
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
			{providers.map((p) => (
				<div key={p.name} className="glass rounded-lg p-4 space-y-3">
					<div className="flex items-center justify-between">
						<p className="font-semibold capitalize">{p.name}</p>
						<span
							className={cn(
								"text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border",
								p.status === "ok"
									? "bg-accent-green/10 text-accent-green border-accent-green/30"
									: p.status === "error"
										? "bg-accent-red/10 text-accent-red border-accent-red/30"
										: "bg-muted text-muted-foreground border-border/30",
							)}
						>
							{p.status}
						</span>
					</div>
					<div className="space-y-1.5 text-xs text-muted-foreground/70">
						<div className="flex justify-between">
							<span>API Key</span>
							<span className="font-mono">
								{p.keyHint
									? `****${p.keyHint}`
									: p.isConfigured
										? "configured"
										: "—"}
							</span>
						</div>
						<div className="flex justify-between">
							<span>Models</span>
							<span>{p.models.length}</span>
						</div>
						<div className="flex justify-between">
							<span>Spend MTD</span>
							<span className="tabular-nums font-medium text-foreground/80">
								{fmtUsd(p.spendMtdUsd)}
							</span>
						</div>
					</div>
					{!p.isConfigured && (
						<p className="text-xs text-muted-foreground/50 flex items-center gap-1">
							<Settings2 className="w-3 h-3" />
							Configure in Settings
						</p>
					)}
				</div>
			))}
		</div>
	);
}

// ─── Billing Tab ───────────────────────────────────────────────────────────────

function BillingTab() {
	return (
		<div className="space-y-4">
			<div className="glass rounded-lg p-4 flex items-start gap-3 border border-setra-600/20">
				<AlertCircle className="w-5 h-5 text-setra-400 shrink-0 mt-0.5" />
				<div>
					<p className="text-sm font-medium">Enterprise Billing</p>
					<p className="text-xs text-muted-foreground/70 mt-1">
						Billing is managed at the instance level for enterprise deployments.
					</p>
				</div>
			</div>
			<div className="glass rounded-lg p-4 space-y-2">
				<p className="text-sm font-medium">Billing Support</p>
				<p className="text-xs text-muted-foreground/60">
					Contact your account manager or reach out at{" "}
					<span className="font-mono text-setra-300">billing@setra.dev</span>{" "}
					for billing enquiries.
				</p>
			</div>
			<div className="glass rounded-lg p-4 flex items-start gap-3 border border-border/20">
				<CheckCircle className="w-5 h-5 text-accent-green shrink-0 mt-0.5" />
				<p className="text-xs text-muted-foreground/70">
					For the open-source edition, there is no billing.
				</p>
			</div>
		</div>
	);
}

// ─── Reports Tab ───────────────────────────────────────────────────────────────

function ReportsTab() {
	const today = new Date().toISOString().slice(0, 10);
	const firstOfMonth = today.slice(0, 8) + "01";
	const [from, setFrom] = useState(firstOfMonth);
	const [to, setTo] = useState(today);
	const [toastMsg, setToastMsg] = useState<string | null>(null);

	function toast(msg: string) {
		setToastMsg(msg);
		setTimeout(() => setToastMsg(null), 3000);
	}

	return (
		<div className="space-y-4">
			{toastMsg && (
				<div className="glass rounded-lg px-4 py-2 text-sm border border-setra-600/30 text-setra-300">
					{toastMsg}
				</div>
			)}
			<div className="glass rounded-lg p-4">
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
					Date Range
				</p>
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-2">
						<label className="text-xs text-muted-foreground/60">From</label>
						<input
							type="date"
							value={from}
							onChange={(e) => setFrom(e.target.value)}
							className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
					</div>
					<div className="flex items-center gap-2">
						<label className="text-xs text-muted-foreground/60">To</label>
						<input
							type="date"
							value={to}
							onChange={(e) => setTo(e.target.value)}
							className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
					</div>
					<button
						className="flex items-center gap-1.5 px-3 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-[#2b2418] text-sm font-medium transition-colors"
						onClick={() => toast("Export started")}
					>
						<Download className="w-3.5 h-3.5" /> Export CSV
					</button>
				</div>
			</div>

			<div className="glass rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border/20 text-muted-foreground/60">
							<th className="text-left px-4 py-2.5 text-xs font-medium">
								Date
							</th>
							<th className="text-right px-4 py-2.5 text-xs font-medium">
								Tokens
							</th>
							<th className="text-right px-4 py-2.5 text-xs font-medium">
								Cost
							</th>
							<th className="text-right px-4 py-2.5 text-xs font-medium">
								Agents
							</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td
								colSpan={4}
								className="text-center py-8 text-muted-foreground/40 text-xs"
							>
								No cost data for selected range
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	);
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function CostsPage() {
	const [tab, setTab] = useState<Tab>("overview");

	const { data: summary } = useQuery({
		queryKey: ["costs-summary"],
		queryFn: costs.summary,
		refetchInterval: 30_000,
	});

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
			<PageHeader
				title="Costs & Budget"
				subtitle="Track spend, budgets, providers, and billing in one place."
				actions={<Badge variant="info">{tab}</Badge>}
			/>

			{/* Tabs */}
			<div className="flex flex-wrap gap-2 border-b border-border/30 pb-4">
				{TABS.map((t) => (
					<Button
						key={t.id}
						type="button"
						variant={tab === t.id ? "primary" : "ghost"}
						size="sm"
						onClick={() => setTab(t.id)}
					>
						{t.label}
					</Button>
				))}
			</div>

			{/* Content */}
			{tab === "overview" && <OverviewTab summary={summary} />}
			{tab === "budgets" && <BudgetsTab />}
			{tab === "providers" && <ProvidersTab />}
			{tab === "billing" && <BillingTab />}
			{tab === "reports" && <ReportsTab />}
		</div>
	);
}
