import { cn } from "../../lib/utils";
import { RAIL_ITEMS, REPLIT, type RailAction } from "./types";

interface IconRailProps {
	activeItem: RailAction | null;
	onSelect: (item: RailAction) => void;
	userInitial?: string;
}

export function IconRail({
	activeItem,
	onSelect,
	userInitial = "U",
}: IconRailProps) {
	return (
		<aside
			className="flex h-full w-12 shrink-0 flex-col border-r"
			style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.background }}
		>
			<div className="flex flex-1 flex-col items-center gap-1 py-2">
				{RAIL_ITEMS.map(({ id, label, icon: Icon }) => (
					<button
						key={id}
						type="button"
						title={label}
						onClick={() => onSelect(id)}
						className={cn(
							"flex h-10 w-10 items-center justify-center rounded-lg border border-transparent transition-colors",
							activeItem === id
								? "text-[#2b2418]"
								: "text-[#9DA2A6] hover:text-[#2b2418]",
						)}
						style={{
							backgroundColor: activeItem === id ? REPLIT.panel : "transparent",
						}}
					>
						<Icon className="h-4.5 w-4.5" />
					</button>
				))}
			</div>
			<div
				className="flex justify-center border-t py-3"
				style={{ borderColor: REPLIT.border }}
			>
				<div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[#24304A] text-xs font-semibold text-[#2b2418]">
					{userInitial.slice(0, 1).toUpperCase()}
					<span
						className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2"
						style={{
							backgroundColor: REPLIT.success,
							borderColor: REPLIT.background,
						}}
					/>
				</div>
			</div>
		</aside>
	);
}
