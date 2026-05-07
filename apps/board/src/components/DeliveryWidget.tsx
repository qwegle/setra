/**
 * DeliveryWidget — top-of-page summary for the SDLC delivery loop.
 *
 * Shows 8 stage counters + the cancelled bucket, the median cycle time, the
 * last-24h activity total, and a compact 24-hour SVG sparkline. All data
 * comes from GET /api/projects/:id/sdlc-stats.
 *
 * No external chart libs — the sparkline is hand-drawn SVG bars.
 */

import { useQuery } from "@tanstack/react-query";
import {
	type LifecycleStage,
	type Project,
	type SdlcStats,
	api,
} from "../lib/api";
import { cn } from "../lib/utils";

const STAGES: { key: LifecycleStage; label: string }[] = [
	{ key: "backlog", label: "Backlog" },
	{ key: "branched", label: "Branched" },
	{ key: "committed", label: "Committed" },
	{ key: "pr_open", label: "PR Open" },
	{ key: "in_review", label: "In Review" },
	{ key: "merged", label: "Merged" },
	{ key: "deployed", label: "Deployed" },
	{ key: "verified", label: "Verified" },
];

function formatHours(h: number | null): string {
	if (h === null || !Number.isFinite(h)) return "—";
	if (h < 1) return `${Math.round(h * 60)}m`;
	if (h < 48) return `${h.toFixed(1)}h`;
	return `${(h / 24).toFixed(1)}d`;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
	const w = 120;
	const h = 28;
	const max = Math.max(1, ...data);
	const barW = w / Math.max(1, data.length);
	return (
		<svg
			viewBox={`0 0 ${w} ${h}`}
			width={w}
			height={h}
			className="opacity-80"
			role="img"
			aria-label={`Last ${data.length} hours of lifecycle activity`}
		>
			{data.map((v, i) => {
				const bh = (v / max) * (h - 2);
				return (
					<rect
						key={`${i}-${v}`}
						x={i * barW + 0.5}
						y={h - bh}
						width={Math.max(1, barW - 1)}
						height={bh}
						fill={color}
						rx={1}
					/>
				);
			})}
		</svg>
	);
}

export function DeliveryWidget({
	projectId,
	project,
}: {
	projectId: string;
	project: Project | null;
}) {
	const { data, isLoading, error } = useQuery<SdlcStats>({
		queryKey: ["sdlc-stats", projectId],
		queryFn: () => api.projects.sdlcStats(projectId),
		refetchInterval: 30_000,
	});

	const accent = project?.color ?? "#6366f1";

	if (isLoading) {
		return (
			<div className="px-4 py-3 border-b border-border/30 text-xs text-muted-foreground/60">
				Loading delivery metrics…
			</div>
		);
	}
	if (error || !data) {
		return (
			<div className="px-4 py-3 border-b border-border/30 text-xs text-muted-foreground/60">
				Delivery metrics unavailable.
			</div>
		);
	}

	return (
		<div className="px-4 py-3 border-b border-border/30 space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span
						className="inline-block w-2.5 h-2.5 rounded-full"
						style={{ backgroundColor: accent }}
					/>
					<h2 className="text-sm font-semibold">Delivery</h2>
					{project && (
						<span className="text-xs text-muted-foreground/60">
							· {project.name}
						</span>
					)}
				</div>
				<div className="flex items-center gap-4 text-xs">
					<div className="flex items-baseline gap-1">
						<span className="text-muted-foreground/60">Cycle</span>
						<span className="font-mono text-foreground">
							{formatHours(data.cycle_time_median_hours)}
						</span>
					</div>
					<div className="flex items-baseline gap-1">
						<span className="text-muted-foreground/60">24h</span>
						<span className="font-mono text-foreground">
							{data.activity_last_24h}
						</span>
					</div>
					<Sparkline data={data.activity_sparkline} color={accent} />
				</div>
			</div>

			<div className="grid grid-cols-4 md:grid-cols-8 gap-2">
				{STAGES.map((s) => (
					<StatCard
						key={s.key}
						label={s.label}
						value={data.counts[s.key] ?? 0}
						accent={accent}
						highlighted={s.key === "merged" || s.key === "verified"}
					/>
				))}
			</div>
			{data.counts.cancelled > 0 && (
				<p className="text-xs text-muted-foreground/60">
					{data.counts.cancelled} cancelled
				</p>
			)}
		</div>
	);
}

function StatCard({
	label,
	value,
	accent,
	highlighted,
}: {
	label: string;
	value: number;
	accent: string;
	highlighted?: boolean;
}) {
	return (
		<div
			className={cn(
				"rounded-md border border-border/30 px-2 py-1.5 bg-muted/10",
				highlighted && "bg-muted/20",
			)}
			style={highlighted ? { borderColor: `${accent}55` } : undefined}
		>
			<p className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
				{label}
			</p>
			<p className="text-lg font-semibold tabular-nums">{value}</p>
		</div>
	);
}
