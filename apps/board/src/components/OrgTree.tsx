import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { RosterEntry } from "../lib/api";
import {
	H_GAP,
	NODE_H,
	NODE_W,
	type TreeNode,
	buildForest,
	computeSubtreeWidth,
	flatten,
	layoutSubtree,
} from "../lib/org-tree-layout";
import { cn } from "../lib/utils";

/**
 * SVG-canvas org tree.
 *
 * Layout algorithm is the standard "subtree width" tidy-tree pattern used by
 * paperclip's OrgChart (MIT) — each subtree is laid out left-to-right under
 * its parent, and the parent is centered above its children.
 */

function initials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length >= 2)
		return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
	return name.slice(0, 2).toUpperCase();
}

function statusColor(entry: RosterEntry): { color: string; label: string } {
	// Real adapter availability via the joined agent_roster.status, falling back to is_active.
	switch (entry.runtime_status) {
		case "running":
			return { color: "#10b981", label: "Running" };
		case "idle":
			return { color: "#3b82f6", label: "Idle (ready)" };
		case "awaiting_key":
			return { color: "#f59e0b", label: "Awaiting API key" };
		case "paused":
			return { color: "#ef4444", label: entry.paused_reason ?? "Paused" };
		default:
			return entry.is_active === 0
				? { color: "#6b7280", label: "Inactive" }
				: { color: "#6b7280", label: "Unknown" };
	}
}

export function OrgTree({ entries }: { entries: RosterEntry[] }) {
	const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
	const svgRef = useRef<SVGSVGElement>(null);
	const drag = useRef<{
		startX: number;
		startY: number;
		tx: number;
		ty: number;
	} | null>(null);

	const { roots, allNodes, width, height } = useMemo(() => {
		const rs = buildForest(entries);
		let cursor = 0;
		let maxDepth = 0;
		for (const r of rs) {
			computeSubtreeWidth(r);
			layoutSubtree(r, cursor, 0);
			cursor += r.subtreeWidth + H_GAP * 2;
			const all = flatten([r]);
			for (const n of all) maxDepth = Math.max(maxDepth, n.y);
		}
		const all = flatten(rs);
		return {
			roots: rs,
			allNodes: all,
			width: Math.max(cursor, NODE_W),
			height: maxDepth + NODE_H,
		};
	}, [entries]);

	function onMouseDown(e: React.MouseEvent) {
		drag.current = {
			startX: e.clientX,
			startY: e.clientY,
			tx: transform.x,
			ty: transform.y,
		};
	}
	function onMouseMove(e: React.MouseEvent) {
		if (!drag.current) return;
		const dx = e.clientX - drag.current.startX;
		const dy = e.clientY - drag.current.startY;
		setTransform((t) => ({
			...t,
			x: drag.current!.tx + dx,
			y: drag.current!.ty + dy,
		}));
	}
	function onMouseUp() {
		drag.current = null;
	}

	useEffect(() => {
		const el = svgRef.current;
		if (!el) return;
		function onWheel(e: WheelEvent) {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.1 : 0.9;
			setTransform((t) => ({
				...t,
				scale: Math.max(0.3, Math.min(2.5, t.scale * factor)),
			}));
		}
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	function fit() {
		const el = svgRef.current;
		if (!el) return;
		const bbox = el.getBoundingClientRect();
		const sx = (bbox.width - 80) / Math.max(width, 1);
		const sy = (bbox.height - 80) / Math.max(height, 1);
		const scale = Math.min(1, Math.min(sx, sy));
		setTransform({
			x: (bbox.width - width * scale) / 2,
			y: 40,
			scale,
		});
	}

	useEffect(() => {
		fit();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [width, height]);

	if (entries.length === 0) {
		return (
			<div className="glass rounded-xl p-12 text-center text-sm text-muted-foreground/60">
				No agents on the team yet — add your first one to see the tree.
			</div>
		);
	}

	return (
		<div className="relative w-full h-[600px] glass rounded-xl overflow-hidden">
			{/* Toolbar */}
			<div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-background/70 backdrop-blur rounded-md border border-border p-1 text-xs">
				<button
					type="button"
					onClick={() =>
						setTransform((t) => ({
							...t,
							scale: Math.min(2.5, t.scale * 1.15),
						}))
					}
					className="px-2 py-0.5 hover:bg-accent rounded"
					aria-label="Zoom in"
				>
					+
				</button>
				<button
					type="button"
					onClick={() =>
						setTransform((t) => ({
							...t,
							scale: Math.max(0.3, t.scale / 1.15),
						}))
					}
					className="px-2 py-0.5 hover:bg-accent rounded"
					aria-label="Zoom out"
				>
					−
				</button>
				<button
					type="button"
					onClick={fit}
					className="px-2 py-0.5 hover:bg-accent rounded"
					aria-label="Fit to screen"
				>
					Fit
				</button>
				<span className="px-2 text-muted-foreground/50">
					{Math.round(transform.scale * 100)}%
				</span>
			</div>

			<svg
				ref={svgRef}
				className="w-full h-full cursor-grab active:cursor-grabbing select-none"
				onMouseDown={onMouseDown}
				onMouseMove={onMouseMove}
				onMouseUp={onMouseUp}
				onMouseLeave={onMouseUp}
				data-testid="org-tree-svg"
			>
				<g
					transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
				>
					{/* Edges */}
					{allNodes.map((parent) =>
						parent.children.map((child) => {
							const px = parent.x + NODE_W / 2;
							const py = parent.y + NODE_H;
							const cx = child.x + NODE_W / 2;
							const cy = child.y;
							const midY = (py + cy) / 2;
							return (
								<path
									key={`edge-${parent.entry.id}-${child.entry.id}`}
									d={`M ${px} ${py} V ${midY} H ${cx} V ${cy}`}
									fill="none"
									stroke="currentColor"
									strokeOpacity="0.25"
									strokeWidth={1.5}
								/>
							);
						}),
					)}
					{/* Nodes */}
					{allNodes.map((node) => {
						const e = node.entry;
						return (
							<g
								key={node.entry.id}
								transform={`translate(${node.x}, ${node.y})`}
								data-testid={`org-node-${e.id}`}
							>
								<foreignObject width={NODE_W} height={NODE_H}>
									<Link
										to={`/agents/${e.id}`}
										className={cn(
											"block w-full h-full glass rounded-lg p-3 border border-border/50",
											"hover:border-setra-400 transition-colors no-underline",
										)}
										onClick={(ev) => ev.stopPropagation()}
										onMouseDown={(ev) => ev.stopPropagation()}
									>
										<div className="flex items-center gap-2">
											<div className="w-8 h-8 rounded-full bg-setra-600/30 text-setra-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
												{initials(e.display_name)}
											</div>
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium truncate text-foreground">
													{e.display_name}
												</p>
												<p className="text-[10px] text-muted-foreground/60 truncate">
													{e.template_name}
												</p>
											</div>
											<span
												className="w-2 h-2 rounded-full flex-shrink-0"
												style={{ background: statusColor(e).color }}
												title={statusColor(e).label}
											/>
										</div>
										<p className="text-[10px] text-muted-foreground/50 mt-1.5 truncate">
											{e.model ?? "—"}
										</p>
									</Link>
								</foreignObject>
							</g>
						);
					})}
				</g>
			</svg>
			<p className="absolute bottom-2 left-3 text-[10px] text-muted-foreground/40 pointer-events-none">
				Drag to pan · Ctrl/⌘ + scroll to zoom · {roots.length} root
				{roots.length !== 1 ? "s" : ""}
			</p>
		</div>
	);
}
