import { AnimatePresence, motion } from "framer-motion";
import {
	Bot,
	Brain,
	Coins,
	FilePlus,
	FolderKanban,
	LayoutDashboard,
	MessageSquareDot,
	Search,
	Settings,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDialog } from "../context/DialogContext";
import { cn } from "../lib/utils";

interface PaletteItem {
	id: string;
	label: string;
	category: "navigation" | "action";
	shortcut?: string;
	icon: React.ElementType;
	action: () => void;
}

function usePaletteItems(
	navigate: ReturnType<typeof useNavigate>,
	close: () => void,
): PaletteItem[] {
	return [
		{
			id: "nav-overview",
			label: "Overview",
			category: "navigation",
			shortcut: "⌘1",
			icon: LayoutDashboard,
			action: () => {
				close();
				navigate("/overview");
			},
		},
		{
			id: "nav-projects",
			label: "Projects",
			category: "navigation",
			shortcut: "⌘2",
			icon: FolderKanban,
			action: () => {
				close();
				navigate("/projects");
			},
		},
		{
			id: "nav-agents",
			label: "Agents",
			category: "navigation",
			shortcut: "⌘3",
			icon: Bot,
			action: () => {
				close();
				navigate("/agents");
			},
		},
		{
			id: "nav-collaboration",
			label: "Collaboration",
			category: "navigation",
			shortcut: "⌘4",
			icon: MessageSquareDot,
			action: () => {
				close();
				navigate("/collaboration");
			},
		},
		{
			id: "nav-clone",
			label: "Build Your Clone",
			category: "navigation",
			shortcut: "⌘5",
			icon: Brain,
			action: () => {
				close();
				navigate("/clone");
			},
		},
		{
			id: "nav-costs",
			label: "Costs & Budget",
			category: "navigation",
			shortcut: "⌘6",
			icon: Coins,
			action: () => {
				close();
				navigate("/costs");
			},
		},
		{
			id: "nav-settings",
			label: "Settings",
			category: "navigation",
			shortcut: "⌘7",
			icon: Settings,
			action: () => {
				close();
				navigate("/settings");
			},
		},
		{
			id: "action-new-item",
			label: "New Item",
			category: "action",
			shortcut: "⌘N",
			icon: FilePlus,
			action: () => {
				close();
				window.dispatchEvent(new CustomEvent("setra:new-item"));
			},
		},
		{
			id: "action-command-palette",
			label: "Command Palette",
			category: "action",
			shortcut: "⌘K",
			icon: Zap,
			action: () => close(),
		},
	];
}

export function CommandPalette() {
	const { commandPaletteOpen, closeCommandPalette } = useDialog();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const allItems = usePaletteItems(navigate, closeCommandPalette);

	const filtered = query.trim()
		? allItems.filter(
				(item) =>
					item.label.toLowerCase().includes(query.toLowerCase()) ||
					item.category.toLowerCase().includes(query.toLowerCase()),
			)
		: allItems;

	// Reset on open/close
	useEffect(() => {
		if (commandPaletteOpen) {
			setQuery("");
			setSelectedIdx(0);
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [commandPaletteOpen]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIdx((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				filtered[selectedIdx]?.action();
			} else if (e.key === "Escape") {
				e.preventDefault();
				closeCommandPalette();
			}
		},
		[filtered, selectedIdx, closeCommandPalette],
	);

	const navItems = filtered.filter((i) => i.category === "navigation");
	const actionItems = filtered.filter((i) => i.category === "action");

	return (
		<AnimatePresence>
			{commandPaletteOpen && (
				<>
					{/* Backdrop */}
					<motion.div
						key="palette-backdrop"
						className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
						onClick={closeCommandPalette}
					/>

					{/* Modal */}
					<motion.div
						key="palette-modal"
						className="fixed left-1/2 top-1/4 z-50 w-full max-w-lg -translate-x-1/2"
						initial={{ opacity: 0, scale: 0.96, y: -8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: -8 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
					>
						<div className="bg-card/90 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl overflow-hidden">
							{/* Search input */}
							<div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
								<Search className="w-4 h-4 text-muted-foreground/50 shrink-0" />
								<input
									ref={inputRef}
									type="text"
									placeholder="Search pages, actions..."
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									onKeyDown={handleKeyDown}
									className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
								/>
								<kbd className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded font-mono text-muted-foreground/50">
									ESC
								</kbd>
							</div>

							{/* Results */}
							<div className="max-h-80 overflow-y-auto py-2">
								{filtered.length === 0 && (
									<p className="text-center text-sm text-muted-foreground/40 py-8">
										No results for &quot;{query}&quot;
									</p>
								)}

								{navItems.length > 0 && (
									<Section
										label="Navigation"
										items={navItems}
										allItems={filtered}
										selectedIdx={selectedIdx}
										onSelect={(item) => item.action()}
										onHover={(item) => setSelectedIdx(filtered.indexOf(item))}
									/>
								)}

								{actionItems.length > 0 && (
									<Section
										label="Quick Actions"
										items={actionItems}
										allItems={filtered}
										selectedIdx={selectedIdx}
										onSelect={(item) => item.action()}
										onHover={(item) => setSelectedIdx(filtered.indexOf(item))}
									/>
								)}
							</div>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}

function Section({
	label,
	items,
	allItems,
	selectedIdx,
	onSelect,
	onHover,
}: {
	label: string;
	items: PaletteItem[];
	allItems: PaletteItem[];
	selectedIdx: number;
	onSelect: (item: PaletteItem) => void;
	onHover: (item: PaletteItem) => void;
}) {
	return (
		<div>
			<div className="px-4 py-1.5">
				<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
					{label}
				</span>
			</div>
			{items.map((item) => {
				const globalIdx = allItems.indexOf(item);
				const isSelected = globalIdx === selectedIdx;
				return (
					<button
						key={item.id}
						type="button"
						className={cn(
							"w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left",
							isSelected
								? "bg-setra-600/15 text-setra-300"
								: "text-foreground hover:bg-muted/50",
						)}
						onClick={() => onSelect(item)}
						onMouseEnter={() => onHover(item)}
					>
						<item.icon className="w-4 h-4 shrink-0 text-muted-foreground" />
						<span className="flex-1">{item.label}</span>
						{item.shortcut && (
							<kbd className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded font-mono text-muted-foreground/50">
								{item.shortcut}
							</kbd>
						)}
					</button>
				);
			})}
		</div>
	);
}
