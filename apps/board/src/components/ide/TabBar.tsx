import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { type IDETab, REPLIT, tabIcon, tabId, tabTitle } from "./types";

interface TabBarProps {
	tabs: IDETab[];
	activeTabId: string | null;
	onSelect: (tabId: string) => void;
	onClose: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelect, onClose }: TabBarProps) {
	return (
		<div
			className="flex h-10 items-end gap-1 overflow-x-auto border-b px-2"
			style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
		>
			{tabs.length === 0 ? (
				<div className="flex h-full items-center px-2 text-xs text-[#5F6B7A]">
					Open a file or tool to get started.
				</div>
			) : (
				tabs.map((tab) => {
					const id = tabId(tab);
					const active = id === activeTabId;
					const Icon = tabIcon(tab);
					return (
						<button
							key={id}
							type="button"
							onClick={() => onSelect(id)}
							className={cn(
								"group flex h-9 min-w-0 max-w-[220px] items-center gap-2 rounded-t-md border px-3 text-xs transition-colors",
								active ? "text-[#2b2418]" : "text-[#9DA2A6] hover:text-[#2b2418]",
							)}
							style={{
								borderColor: REPLIT.border,
								borderBottomColor: active ? REPLIT.panelAlt : REPLIT.border,
								backgroundColor: active ? REPLIT.panelAlt : REPLIT.background,
							}}
						>
							<Icon className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">
								{tab.type === "file" && tab.isDirty
									? `● ${tabTitle(tab)}`
									: tabTitle(tab)}
							</span>
							<span
								role="button"
								tabIndex={-1}
								onClick={(event) => {
									event.stopPropagation();
									onClose(id);
								}}
								className="rounded p-0.5 opacity-60 transition-opacity hover:bg-white/10 hover:opacity-100"
							>
								<X className="h-3.5 w-3.5" />
							</span>
						</button>
					);
				})
			)}
		</div>
	);
}
