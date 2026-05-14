import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	CheckCircle,
	Cpu,
	HardDrive,
	Heart,
	MemoryStick,
	RefreshCw,
	Server,
	Trash2,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

type HealthSnapshot = Awaited<ReturnType<typeof api.health.snapshot>>;

/** Read renderer (app) memory via the non-standard performance.memory API (Chromium only). */
function getAppMemory() {
	const mem = (
		performance as unknown as {
			memory?: {
				usedJSHeapSize: number;
				totalJSHeapSize: number;
				jsHeapSizeLimit: number;
			};
		}
	).memory;
	if (!mem) return null;
	return {
		usedMb: Math.round(mem.usedJSHeapSize / 1024 / 1024),
		totalMb: Math.round(mem.totalJSHeapSize / 1024 / 1024),
		limitMb: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
		percent: Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100),
	};
}

// Keep up to 60 samples (5s interval = 5 min of history)
const MAX_HISTORY = 60;

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function MiniBar({
	value,
	max,
	color,
}: { value: number; max: number; color: string }) {
	const pct = Math.min(100, Math.round((value / max) * 100));
	return (
		<div className="h-2 w-full rounded-full bg-white">
			<div
				className={cn("h-2 rounded-full transition-all", color)}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

function Sparkline({
	data,
	max,
	color,
}: { data: number[]; max: number; color: string }) {
	if (data.length < 2) return null;
	const h = 40;
	const w = 200;
	const step = w / (data.length - 1);
	// Ensure we have a meaningful range — add padding so flat lines don't sit at edge
	const dataMax = Math.max(...data);
	const dataMin = Math.min(...data);
	const range = dataMax - dataMin || 1;
	const effectiveMax = max > 0 ? max : dataMax + 1;
	const points = data
		.map((v, i) => {
			const x = i * step;
			const y = h - 2 - (v / effectiveMax) * (h - 4);
			return `${x},${y}`;
		})
		.join(" ");
	// Fill area under the curve
	const fillPoints = `0,${h} ${points} ${(data.length - 1) * step},${h}`;
	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			className="w-full h-10"
			preserveAspectRatio="none"
		>
			<polygon fill={`${color}15`} points={fillPoints} />
			<polyline
				fill="none"
				stroke={color}
				strokeWidth="2"
				points={points}
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function StatCard({
	icon: Icon,
	label,
	value,
	unit,
	sub,
	level,
}: {
	icon: typeof Cpu;
	label: string;
	value: string | number;
	unit?: string;
	sub?: string;
	level?: "ok" | "warn" | "danger";
}) {
	const colors = {
		ok: "text-accent-green",
		warn: "text-amber-400",
		danger: "text-red-400",
	};
	return (
		<div className="rounded-lg border border-[#e5d6b8] bg-[#faf3e3]/60 p-4">
			<div className="flex items-center gap-2 mb-2">
				<Icon className={cn("h-4 w-4", colors[level ?? "ok"])} />
				<span className="text-xs text-[#6f6044] uppercase tracking-wider">
					{label}
				</span>
			</div>
			<div className="flex items-baseline gap-1">
				<span
					className={cn(
						"text-2xl font-bold tabular-nums",
						colors[level ?? "ok"],
					)}
				>
					{value}
				</span>
				{unit && <span className="text-sm text-[#8a7a5c]">{unit}</span>}
			</div>
			{sub && <p className="text-[10px] text-[#8a7a5c] mt-1">{sub}</p>}
		</div>
	);
}

export function HealthPage() {
	const qc = useQueryClient();
	const [history, setHistory] = useState<HealthSnapshot[]>([]);
	const [appMemHistory, setAppMemHistory] = useState<number[]>([]);
	const [autoGcEnabled, setAutoGcEnabled] = useState(true);
	const autoGcTriggered = useRef(false);

	const { data, isLoading, isError } = useQuery({
		queryKey: ["health"],
		queryFn: api.health.snapshot,
		refetchInterval: 5_000,
	});

	const gcMutation = useMutation({
		mutationFn: api.health.triggerGc,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["health"] });
		},
	});

	// Accumulate history
	useEffect(() => {
		if (!data) return;
		setHistory((prev) => {
			const next = [...prev, data];
			return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
		});
		// Track app (renderer) memory alongside server metrics
		const am = getAppMemory();
		if (am) {
			setAppMemHistory((prev) => {
				const next = [...prev, am.usedMb];
				return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
			});
		}

		// Auto-GC: if server process heap > 400MB, trigger GC automatically
		if (
			autoGcEnabled &&
			data.process.heapUsedMb > 400 &&
			!autoGcTriggered.current &&
			!gcMutation.isPending
		) {
			autoGcTriggered.current = true;
			gcMutation.mutate();
			// Reset trigger after 60s cooldown
			setTimeout(() => {
				autoGcTriggered.current = false;
			}, 60_000);
		}
	}, [data, autoGcEnabled, gcMutation]);

	const appMem = useMemo(() => getAppMemory(), [data]); // re-read each poll cycle

	if (isLoading) {
		return (
			<div className="space-y-5 animate-pulse p-6">
				<div className="h-8 glass rounded-lg w-64" />
				<div className="grid gap-4 grid-cols-2 md:grid-cols-4">
					{[...Array(8)].map((_, i) => (
						<div key={i} className="h-24 glass rounded-xl" />
					))}
				</div>
			</div>
		);
	}

	if (isError || !data) {
		return (
			<div className="p-6">
				<PageHeader title="Health" subtitle="System health monitoring" />
				<Card>
					<div className="flex items-center gap-3 text-red-400">
						<AlertTriangle className="h-5 w-5" />
						<p>Failed to load health data. Is the server running?</p>
					</div>
				</Card>
			</div>
		);
	}

	const ramLevel =
		data.system.ramPercent > 90
			? "danger"
			: data.system.ramPercent > 70
				? "warn"
				: "ok";
	const cpuLevel =
		data.system.cpuPercent > 90
			? "danger"
			: data.system.cpuPercent > 60
				? "warn"
				: "ok";
	const heapLevel =
		data.process.heapUsedMb > 400
			? "danger"
			: data.process.heapUsedMb > 200
				? "warn"
				: "ok";

	const appMemLevel = appMem
		? appMem.percent > 80
			? "danger"
			: appMem.percent > 50
				? "warn"
				: "ok"
		: "ok";

	const ramHistory = history.map((h) => h.system.ramPercent);
	const cpuHistory = history.map((h) => h.system.cpuPercent);
	const heapHistory = history.map((h) => h.process.heapUsedMb);
	const rssHistory = history.map((h) => h.process.rssMb);

	return (
		<div className="p-6 space-y-6 overflow-y-auto h-full">
			<PageHeader
				title="Health"
				subtitle="Real-time system & process monitoring with auto-healing"
				actions={
					<div className="flex items-center gap-3">
						<Badge
							variant={
								heapLevel === "ok"
									? "success"
									: heapLevel === "warn"
										? "warning"
										: "danger"
							}
						>
							{heapLevel === "ok"
								? "Healthy"
								: heapLevel === "warn"
									? "High memory"
									: "Critical"}
						</Badge>
						<Button
							onClick={() => gcMutation.mutate()}
							loading={gcMutation.isPending}
							variant="secondary"
							size="sm"
							icon={<Trash2 className="h-3.5 w-3.5" />}
						>
							Force GC
						</Button>
					</div>
				}
			/>

			{/* GC result toast */}
			{gcMutation.data && (
				<div className="rounded-lg border border-accent-green/30 bg-accent-green/5 p-3 flex items-center gap-3">
					<CheckCircle className="h-4 w-4 text-accent-green shrink-0" />
					<p className="text-sm text-[#4b3f2d]">
						GC{" "}
						{gcMutation.data.gcAvailable
							? "completed"
							: "unavailable (no --expose-gc)"}{" "}
						— freed{" "}
						<span className="font-mono text-accent-green">
							{gcMutation.data.freedMb} MB
						</span>{" "}
						(heap: {gcMutation.data.before.heapUsedMb}→
						{gcMutation.data.after.heapUsedMb} MB)
					</p>
				</div>
			)}

			{/* System stats */}
			<div>
				<h3 className="text-sm font-medium text-[#6f6044] mb-3 flex items-center gap-2">
					<Server className="h-4 w-4" /> System
				</h3>
				<div className="grid gap-3 grid-cols-2 md:grid-cols-4">
					<StatCard
						icon={Cpu}
						label="CPU Usage"
						value={data.system.cpuPercent}
						unit="%"
						sub={`${data.system.cpuCount} cores · load ${data.system.loadAvg1m}`}
						level={cpuLevel}
					/>
					<StatCard
						icon={MemoryStick}
						label="RAM Used"
						value={data.system.ramUsedMb}
						unit="MB"
						sub={`${data.system.ramPercent}% of ${data.system.ramTotalMb} MB`}
						level={ramLevel}
					/>
					<StatCard
						icon={HardDrive}
						label="RAM Free"
						value={data.system.ramFreeMb}
						unit="MB"
						sub={`${100 - data.system.ramPercent}% available`}
						level="ok"
					/>
					<StatCard
						icon={Activity}
						label="System Uptime"
						value={formatUptime(data.os.uptimeSeconds)}
						sub={`${data.os.platform} ${data.os.arch}`}
						level="ok"
					/>
				</div>
			</div>

			{/* Setra App (renderer) memory */}
			{appMem && (
				<div>
					<h3 className="text-sm font-medium text-[#6f6044] mb-3 flex items-center gap-2">
						<Zap className="h-4 w-4" /> Setra App
					</h3>
					<div className="grid gap-3 grid-cols-2 md:grid-cols-4">
						<StatCard
							icon={MemoryStick}
							label="App Heap Used"
							value={appMem.usedMb}
							unit="MB"
							sub={`${appMem.percent}% of ${appMem.limitMb} MB limit`}
							level={appMemLevel as "ok" | "warn" | "danger"}
						/>
						<StatCard
							icon={HardDrive}
							label="App Heap Total"
							value={appMem.totalMb}
							unit="MB"
							sub={`Allocated by V8 for Setra UI`}
							level="ok"
						/>
						<StatCard
							icon={Cpu}
							label="Heap Limit"
							value={appMem.limitMb}
							unit="MB"
							sub="Max heap allowed by runtime"
							level="ok"
						/>
						<StatCard
							icon={Activity}
							label="App Health"
							value={
								appMemLevel === "ok"
									? "Good"
									: appMemLevel === "warn"
										? "Moderate"
										: "High"
							}
							sub={`${appMem.usedMb} MB used of ${appMem.limitMb} MB`}
							level={appMemLevel as "ok" | "warn" | "danger"}
						/>
					</div>
				</div>
			)}

			{/* Process stats */}
			<div>
				<h3 className="text-sm font-medium text-[#6f6044] mb-3 flex items-center gap-2">
					<Zap className="h-4 w-4" /> Setra Server Process (PID{" "}
					{data.process.pid})
				</h3>
				<div className="grid gap-3 grid-cols-2 md:grid-cols-4">
					<StatCard
						icon={MemoryStick}
						label="RSS Memory"
						value={data.process.rssMb}
						unit="MB"
						sub="Total resident set size"
						level={
							data.process.rssMb > 500
								? "danger"
								: data.process.rssMb > 250
									? "warn"
									: "ok"
						}
					/>
					<StatCard
						icon={Cpu}
						label="Heap Used"
						value={data.process.heapUsedMb}
						unit="MB"
						sub={`of ${data.process.heapTotalMb} MB heap`}
						level={heapLevel}
					/>
					<StatCard
						icon={HardDrive}
						label="External"
						value={data.process.externalMb}
						unit="MB"
						sub="C++ objects bound to JS"
						level="ok"
					/>
					<StatCard
						icon={Activity}
						label="Process Uptime"
						value={formatUptime(data.process.uptimeSeconds)}
						sub={`Node ${data.os.nodeVersion}`}
						level="ok"
					/>
				</div>
			</div>

			{/* Memory bars */}
			<Card>
				<div className="space-y-4">
					<h3 className="text-sm font-medium text-[#4b3f2d]">
						Memory Breakdown
					</h3>
					<div className="space-y-3">
						<div>
							<div className="flex justify-between text-xs text-[#6f6044] mb-1">
								<span>System RAM</span>
								<span>
									{data.system.ramUsedMb} / {data.system.ramTotalMb} MB (
									{data.system.ramPercent}%)
								</span>
							</div>
							<MiniBar
								value={data.system.ramUsedMb}
								max={data.system.ramTotalMb}
								color={
									ramLevel === "danger"
										? "bg-red-500"
										: ramLevel === "warn"
											? "bg-amber-500"
											: "bg-accent-green"
								}
							/>
						</div>
						<div>
							<div className="flex justify-between text-xs text-[#6f6044] mb-1">
								<span>V8 Heap</span>
								<span>
									{data.process.heapUsedMb} / {data.process.heapTotalMb} MB
								</span>
							</div>
							<MiniBar
								value={data.process.heapUsedMb}
								max={data.process.heapTotalMb}
								color={
									heapLevel === "danger"
										? "bg-red-500"
										: heapLevel === "warn"
											? "bg-amber-500"
											: "bg-setra-500"
								}
							/>
						</div>
						<div>
							<div className="flex justify-between text-xs text-[#6f6044] mb-1">
								<span>Process RSS</span>
								<span>{data.process.rssMb} MB</span>
							</div>
							<MiniBar
								value={data.process.rssMb}
								max={1024}
								color="bg-[#7a5421]"
							/>
						</div>
						{appMem && (
							<div>
								<div className="flex justify-between text-xs text-[#6f6044] mb-1">
									<span>Setra App Heap</span>
									<span>
										{appMem.usedMb} / {appMem.limitMb} MB ({appMem.percent}%)
									</span>
								</div>
								<MiniBar
									value={appMem.usedMb}
									max={appMem.limitMb}
									color={
										appMemLevel === "danger"
											? "bg-red-500"
											: appMemLevel === "warn"
												? "bg-amber-500"
												: "bg-cyan-500"
									}
								/>
							</div>
						)}
					</div>
				</div>
			</Card>

			{/* Sparkline charts */}
			{history.length >= 2 && (
				<Card>
					<div className="space-y-4">
						<h3 className="text-sm font-medium text-[#4b3f2d]">
							Trend (last {Math.min(history.length, MAX_HISTORY)} samples · 5s
							interval)
						</h3>
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							<div>
								<p className="text-xs text-[#6f6044] mb-1">CPU %</p>
								<Sparkline data={cpuHistory} max={100} color="#22c55e" />
							</div>
							<div>
								<p className="text-xs text-[#6f6044] mb-1">RAM %</p>
								<Sparkline data={ramHistory} max={100} color="#3b82f6" />
							</div>
							<div>
								<p className="text-xs text-[#6f6044] mb-1">Server Heap (MB)</p>
								<Sparkline
									data={heapHistory}
									max={Math.max(...heapHistory, 256)}
									color="#f59e0b"
								/>
							</div>
							<div>
								<p className="text-xs text-[#6f6044] mb-1">Server RSS (MB)</p>
								<Sparkline
									data={rssHistory}
									max={Math.max(...rssHistory, 512)}
									color="#a855f7"
								/>
							</div>
							{appMemHistory.length >= 2 && (
								<div>
									<p className="text-xs text-[#6f6044] mb-1">
										Setra App Heap (MB)
									</p>
									<Sparkline
										data={appMemHistory}
										max={Math.max(...appMemHistory, 128)}
										color="#06b6d4"
									/>
								</div>
							)}
						</div>
					</div>
				</Card>
			)}

			{/* Auto-heal settings */}
			<Card>
				<div className="space-y-4">
					<h3 className="text-sm font-medium text-[#4b3f2d] flex items-center gap-2">
						<Heart className="h-4 w-4 text-red-400" /> Auto-Heal
					</h3>
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm text-[#4b3f2d]">Auto garbage collection</p>
							<p className="text-xs text-[#8a7a5c]">
								Automatically trigger GC when heap exceeds 400 MB (60s cooldown)
							</p>
						</div>
						<button
							type="button"
							role="switch"
							aria-checked={autoGcEnabled}
							onClick={() => setAutoGcEnabled(!autoGcEnabled)}
							className={cn(
								"relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
								autoGcEnabled ? "bg-setra-500" : "bg-[#f3e7cf]",
							)}
						>
							<span
								className={cn(
									"pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
									autoGcEnabled ? "translate-x-5" : "translate-x-0",
								)}
							/>
						</button>
					</div>
					<p className="text-[10px] text-[#9d8d6e]">
						Auto-heal monitors heap usage and reclaims memory before it causes
						slowdowns. The Force GC button above triggers an immediate
						collection.
					</p>
				</div>
			</Card>

			{/* Top Processes by Memory */}
			<ProcessTable />
		</div>
	);
}

function ProcessTable() {
	const { data, isLoading } = useQuery({
		queryKey: ["health-processes"],
		queryFn: api.health.processes,
		refetchInterval: 10_000,
	});

	return (
		<Card>
			<div className="space-y-3">
				<h3 className="text-sm font-medium text-[#4b3f2d] flex items-center gap-2">
					<Activity className="h-4 w-4 text-cyan-400" /> Top Processes by Memory
				</h3>
				{isLoading ? (
					<p className="text-xs text-[#8a7a5c]">Loading…</p>
				) : !data?.processes?.length ? (
					<p className="text-xs text-[#8a7a5c]">No process data available</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-xs">
							<thead>
								<tr className="border-b border-[#e5d6b8] text-[#8a7a5c]">
									<th className="text-left py-2 pr-3 font-medium">PID</th>
									<th className="text-left py-2 pr-3 font-medium">Process</th>
									<th className="text-right py-2 pr-3 font-medium">CPU %</th>
									<th className="text-right py-2 pr-3 font-medium">MEM %</th>
									<th className="text-right py-2 font-medium">RSS (MB)</th>
								</tr>
							</thead>
							<tbody>
								{data.processes.map((p, i) => (
									<tr
										key={`${p.pid}-${i}`}
										className="border-b border-[#e5d6b8]/50 hover:bg-white/30 transition-colors"
									>
										<td className="py-1.5 pr-3 tabular-nums text-[#6f6044]">
											{p.pid}
										</td>
										<td
											className="py-1.5 pr-3 text-[#3b3224] truncate max-w-[200px]"
											title={p.name}
										>
											{(p.name.split("/").pop() ?? "").replace(
												/Electron/gi,
												"Setra",
											)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums">
											<span
												className={
													p.cpu > 50
														? "text-red-400"
														: p.cpu > 20
															? "text-amber-400"
															: "text-[#6f6044]"
												}
											>
												{p.cpu.toFixed(1)}
											</span>
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums">
											<span
												className={
													p.mem > 10
														? "text-red-400"
														: p.mem > 5
															? "text-amber-400"
															: "text-[#6f6044]"
												}
											>
												{p.mem.toFixed(1)}
											</span>
										</td>
										<td className="py-1.5 text-right tabular-nums text-[#4b3f2d]">
											{p.rssMb.toFixed(1)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<p className="text-[10px] text-[#9d8d6e]">
					Top 20 processes sorted by memory usage · refreshes every 10s
				</p>
			</div>
		</Card>
	);
}
