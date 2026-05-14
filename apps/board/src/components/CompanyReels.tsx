/**
 * Reels-style vertical feed for company discovery.
 *
 * One company fills the viewport at a time. Swipe / wheel / arrow keys / on-
 * screen up-down buttons advance to the next. CSS scroll-snap does the heavy
 * lifting so we don't need a gesture library.
 *
 * Used by LanTab and CloudTab in CompanySetupPage.
 */

import { ChevronDown, ChevronUp, MapPin, Network, Users } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./ui";

export interface ReelItem {
	id: string;
	name: string;
	subtitle?: string;
	tag?: string;
}

interface CompanyReelsProps<T extends ReelItem> {
	items: T[];
	kind: "lan" | "cloud";
	busyId?: string | null;
	onJoin: (item: T) => void;
	emptyState: ReactNode;
}

export function CompanyReels<T extends ReelItem>({
	items,
	kind,
	busyId,
	onJoin,
	emptyState,
}: CompanyReelsProps<T>) {
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const [index, setIndex] = useState(0);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const onScroll = () => {
			const h = scroller.clientHeight;
			if (h === 0) return;
			const next = Math.round(scroller.scrollTop / h);
			setIndex((prev) => (prev === next ? prev : next));
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				scrollTo(index + 1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				scrollTo(index - 1);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [index, items.length]);

	function scrollTo(i: number) {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const clamped = Math.max(0, Math.min(items.length - 1, i));
		scroller.scrollTo({ top: clamped * scroller.clientHeight, behavior: "smooth" });
	}

	if (items.length === 0) {
		return (
			<div className="flex h-[520px] items-center justify-center rounded-xl border border-dashed border-[#d9c6a3] bg-[#fdfaf3] text-center text-sm text-[#5b4f3a]">
				{emptyState}
			</div>
		);
	}

	return (
		<div className="relative h-[520px] overflow-hidden rounded-xl border border-[#e5d6b8] bg-[#fbf6ec]">
			<div
				ref={scrollerRef}
				className="h-full snap-y snap-mandatory overflow-y-scroll scroll-smooth"
				style={{ scrollbarWidth: "none" }}
			>
				{items.map((item) => (
					<ReelCard
						key={item.id}
						item={item}
						kind={kind}
						busy={busyId === item.id}
						onJoin={() => onJoin(item)}
					/>
				))}
			</div>

			{/* Right-side action rail (Instagram-style) */}
			<div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3">
				<button
					type="button"
					aria-label="Previous"
					disabled={index === 0}
					onClick={() => scrollTo(index - 1)}
					className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#2b2418]/85 text-[#fbf6ec] shadow-md transition hover:bg-[#2b2418] disabled:opacity-30"
				>
					<ChevronUp className="h-4 w-4" />
				</button>
				<div className="pointer-events-auto rounded-full bg-white/80 px-2 py-1 text-[11px] font-medium text-[#5b4f3a] shadow-sm">
					{index + 1} / {items.length}
				</div>
				<button
					type="button"
					aria-label="Next"
					disabled={index >= items.length - 1}
					onClick={() => scrollTo(index + 1)}
					className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#2b2418]/85 text-[#fbf6ec] shadow-md transition hover:bg-[#2b2418] disabled:opacity-30"
				>
					<ChevronDown className="h-4 w-4" />
				</button>
			</div>

			{/* Left dot index */}
			<div className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1.5">
				{items.slice(0, 8).map((it, i) => (
					<span
						key={it.id}
						className={`h-1.5 w-1.5 rounded-full transition-all ${
							i === index ? "h-3 bg-[#7a5421]" : "bg-[#d9c6a3]"
						}`}
					/>
				))}
				{items.length > 8 && (
					<span className="text-[10px] text-[#a89a7a]">…</span>
				)}
			</div>
		</div>
	);
}

function ReelCard<T extends ReelItem>({
	item,
	kind,
	busy,
	onJoin,
}: {
	item: T;
	kind: "lan" | "cloud";
	busy: boolean;
	onJoin: () => void;
}) {
	const initial = item.name.slice(0, 1).toUpperCase();
	const Icon = kind === "lan" ? Network : MapPin;

	return (
		<section className="flex h-full w-full snap-start snap-always flex-col items-center justify-center gap-6 px-12">
			<div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-[#2b2418] to-[#5b4f3a] text-4xl font-semibold text-[#fbf6ec] shadow-xl">
				{initial}
			</div>

			<div className="flex flex-col items-center gap-2 text-center">
				<h3 className="text-2xl font-semibold text-[#2b2418]">{item.name}</h3>
				{item.subtitle && (
					<p className="flex items-center gap-1.5 text-sm text-[#6f6044]">
						<Icon className="h-4 w-4" />
						{item.subtitle}
					</p>
				)}
				{item.tag && (
					<span className="inline-flex items-center gap-1 rounded-full bg-[#f3e7cf] px-3 py-1 text-xs font-medium text-[#5b4f3a]">
						<Users className="h-3 w-3" />
						{item.tag}
					</span>
				)}
			</div>

			<Button
				type="button"
				onClick={onJoin}
				disabled={busy}
				className="w-full max-w-xs"
				size="lg"
			>
				{busy ? "Joining..." : "Join this company"}
			</Button>

			<p className="text-center text-xs text-[#a89a7a]">
				Swipe up for the next company · ↑ ↓ keys also work
			</p>
		</section>
	);
}
