import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useDialog } from "../context/DialogContext";

interface ShortcutRow {
	keys: string;
	description: string;
}

const NAV_SHORTCUTS: ShortcutRow[] = [
	{ keys: "⌘1", description: "Dashboard" },
	{ keys: "⌘2", description: "Projects" },
	{ keys: "⌘3", description: "Agents" },
	{ keys: "⌘4", description: "Inbox" },
	{ keys: "⌘5", description: "Goals" },
	{ keys: "⌘6", description: "Costs" },
	{ keys: "⌘7", description: "Settings" },
	{ keys: "⌘B", description: "Toggle sidebar" },
	{ keys: "⌘,", description: "Settings" },
];

const ACTION_SHORTCUTS: ShortcutRow[] = [
	{ keys: "⌘N", description: "New item" },
	{ keys: "⌘K", description: "Command palette" },
	{ keys: "⌘F", description: "Search" },
	{ keys: "Escape", description: "Close / dismiss" },
	{ keys: "J", description: "Next in list" },
	{ keys: "K", description: "Previous in list" },
	{ keys: "Enter", description: "Open selected" },
	{ keys: "E", description: "Archive (inbox)" },
	{ keys: "⌘/", description: "This cheatsheet" },
];

export function KeyboardShortcutsModal() {
	const { shortcutsModalOpen, closeShortcutsModal } = useDialog();

	return (
		<AnimatePresence>
			{shortcutsModalOpen && (
				<>
					<motion.div
						key="shortcuts-backdrop"
						className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
						onClick={closeShortcutsModal}
					/>

					<motion.div
						key="shortcuts-modal"
						className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2"
						initial={{ opacity: 0, scale: 0.96 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.96 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
					>
						<div className="bg-card/90 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl overflow-hidden">
							{/* Header */}
							<div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
								<h2 className="text-sm font-semibold text-foreground">
									Keyboard Shortcuts
								</h2>
								<button
									type="button"
									onClick={closeShortcutsModal}
									className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
								>
									<X className="w-4 h-4" />
								</button>
							</div>

							{/* Two-column shortcuts table */}
							<div className="grid grid-cols-2 gap-0 divide-x divide-border/30 p-6">
								<ShortcutColumn title="Navigation" rows={NAV_SHORTCUTS} />
								<ShortcutColumn
									title="Actions"
									rows={ACTION_SHORTCUTS}
									padLeft
								/>
							</div>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}

function ShortcutColumn({
	title,
	rows,
	padLeft,
}: {
	title: string;
	rows: ShortcutRow[];
	padLeft?: boolean;
}) {
	return (
		<div className={padLeft ? "pl-6" : "pr-6"}>
			<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-3">
				{title}
			</p>
			<div className="space-y-1.5">
				{rows.map((row) => (
					<div
						key={row.keys}
						className="flex items-center justify-between gap-4"
					>
						<span className="text-xs text-muted-foreground">
							{row.description}
						</span>
						<kbd className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded font-mono text-muted-foreground/70 shrink-0">
							{row.keys}
						</kbd>
					</div>
				))}
			</div>
		</div>
	);
}
