import {
	DndContext,
	type DragEndEvent,
	MouseSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Plus, Settings, User, Zap } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { type Company, useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { cn } from "../lib/utils";
import { CompanyPatternIcon } from "./CompanyPatternIcon";

/* ── User avatar menu at bottom of rail ──────────────────────────────── */

function UserAvatarMenu() {
	const { user, logout, isAdmin } = useAuth();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	if (!user) return null;

	const initials = (user.name ?? user.email)
		.split(/\s+/)
		.map((w) => w[0])
		.slice(0, 2)
		.join("")
		.toUpperCase();

	return (
		<div className="relative" ref={menuRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"flex items-center justify-center w-10 h-10 rounded-full",
					"bg-gradient-to-br from-setra-600/80 to-setra-700/80 text-[#2b2418] text-xs font-bold",
					"border-2 border-transparent hover:border-setra-400/50 transition-all",
					"shadow-md shadow-setra-900/30",
					open && "border-setra-400/50 ring-2 ring-setra-500/20",
				)}
				title={user.name ?? user.email}
			>
				{initials}
			</button>

			{createPortal(
				<AnimatePresence>
					{open && (
						<>
							{/* Backdrop */}
							<div
								className="fixed inset-0 z-[99]"
								onClick={() => setOpen(false)}
								onKeyDown={() => {}}
								role="presentation"
							/>
							<motion.div
								initial={{ opacity: 0, y: 6, scale: 0.95 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, y: 6, scale: 0.95 }}
								transition={{ duration: 0.15 }}
								style={{
									position: "fixed",
									bottom: menuRef.current
										? window.innerHeight -
											menuRef.current.getBoundingClientRect().top +
											8
										: 60,
									left: menuRef.current
										? menuRef.current.getBoundingClientRect().right + 8
										: 64,
								}}
								className="z-[100] w-56 rounded-xl border border-border/50 bg-[#fdfaf3]/95 backdrop-blur-xl shadow-2xl overflow-hidden"
							>
								{/* User info header */}
								<div className="px-3 py-3 border-b border-border/30">
									<p className="text-sm font-medium text-foreground truncate">
										{user.name ?? "User"}
									</p>
									<p className="text-[11px] text-muted-foreground truncate">
										{user.email}
									</p>
									<span className="mt-1 inline-block text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-setra-600/15 text-setra-300">
										{user.role}
									</span>
								</div>

								{/* Menu items */}
								<div className="py-1">
									{isAdmin && (
										<button
											type="button"
											onClick={() => {
												setOpen(false);
												navigate("/settings/company");
											}}
											className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
										>
											<Settings className="w-3.5 h-3.5" />
											Company Settings
										</button>
									)}
									<button
										type="button"
										onClick={() => {
											setOpen(false);
											navigate("/settings");
										}}
										className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
									>
										<User className="w-3.5 h-3.5" />
										Profile &amp; Settings
									</button>
									<div className="border-t border-border/20 my-1" />
									<button
										type="button"
										onClick={() => {
											setOpen(false);
											void logout();
										}}
										className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
									>
										<LogOut className="w-3.5 h-3.5" />
										Sign out
									</button>
								</div>
							</motion.div>
						</>
					)}
				</AnimatePresence>,
				document.body,
			)}
		</div>
	);
}

/* ── OrgRail ──────────────────────────────────────────────────────────── */

export function OrgRail() {
	const { companies, selectedCompanyId, switchCompany, reorderCompanies } =
		useCompany();
	const { openOnboarding } = useDialogActions();
	const { isAdmin } = useAuth();
	const navigate = useNavigate();
	const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
	const [switching, setSwitching] = useState(false);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
	);

	const sorted = useMemo(
		() => [...companies].sort((a, b) => a.order - b.order),
		[companies],
	);
	const currentCompany = useMemo(
		() => sorted.find((c) => c.id === selectedCompanyId) ?? null,
		[selectedCompanyId, sorted],
	);
	const pendingCompany = useMemo(
		() => sorted.find((c) => c.id === pendingSwitchId) ?? null,
		[pendingSwitchId, sorted],
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const oldIdx = sorted.findIndex((c) => c.id === active.id);
			const newIdx = sorted.findIndex((c) => c.id === over.id);
			const reordered = arrayMove(sorted, oldIdx, newIdx);
			reorderCompanies(reordered.map((c) => c.id));
		},
		[sorted, reorderCompanies],
	);

	return (
		<>
			<aside className="hidden md:flex md:flex-col items-center w-[72px] shrink-0 border-r border-border/50 bg-[#fdfaf3]/90 backdrop-blur-xl pt-10 pb-4 gap-1 overflow-y-auto no-scrollbar">
				{/* Setra logo mark */}
				<div className="flex items-center justify-center w-10 h-10 rounded-xl bg-setra-600/90 shadow-lg shadow-setra-600/20 mb-3 shrink-0">
					<Zap className="w-5 h-5 text-[#2b2418]" strokeWidth={2.5} />
				</div>

				{/* Company list */}
				<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
					<SortableContext
						items={sorted.map((c) => c.id)}
						strategy={verticalListSortingStrategy}
					>
						{sorted.map((company) => (
							<SortableCompanyItem
								key={company.id}
								company={company}
								isSelected={company.id === selectedCompanyId}
								onSelect={() => {
									if (company.id === selectedCompanyId) return;
									setPendingSwitchId(company.id);
								}}
							/>
						))}
					</SortableContext>
				</DndContext>

				{/* Add company button — admin only */}
				{isAdmin && (
					<button
						type="button"
						onClick={() => openOnboarding()}
						className={cn(
							"flex items-center justify-center w-10 h-10 mt-1 rounded-[12px]",
							"border border-dashed border-border/50 transition-all duration-150",
							"text-muted-foreground/40",
							"hover:border-setra-500/50 hover:text-setra-400",
						)}
						title="Add workspace"
					>
						<Plus className="w-4 h-4" />
					</button>
				)}

				{/* Spacer */}
				<div className="flex-1" />

				{/* User avatar at bottom */}
				<UserAvatarMenu />
			</aside>
			{createPortal(
				<AnimatePresence>
					{pendingCompany && (
						<motion.div
							className="fixed inset-0 z-[90] bg-[#fdfaf3]/70 backdrop-blur-sm flex items-center justify-center"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
						>
							<motion.div
								initial={{ opacity: 0, y: 8, scale: 0.98 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, y: 8, scale: 0.98 }}
								className="w-[420px] max-w-[92vw] rounded-xl border border-border/40 bg-[#fdfaf3]/95 p-5 shadow-2xl"
							>
								<p className="text-xs uppercase tracking-wider text-muted-foreground/70">
									Switch workspace
								</p>
								<p className="mt-2 text-sm text-foreground/90">
									Switch from{" "}
									<span className="font-semibold">
										{currentCompany?.name ?? "Current workspace"}
									</span>{" "}
									to{" "}
									<span className="font-semibold">{pendingCompany.name}</span>?
								</p>
								<p className="mt-1 text-xs text-muted-foreground/70">
									We will refresh scoped data and move you to Overview.
								</p>
								<div className="mt-4 flex justify-end gap-2">
									<button
										type="button"
										className="px-3 py-1.5 text-xs rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
										onClick={() => setPendingSwitchId(null)}
										disabled={switching}
									>
										Cancel
									</button>
									<button
										type="button"
										className="px-3 py-1.5 text-xs rounded-md bg-setra-600 text-[#2b2418] hover:bg-setra-500 transition-colors disabled:opacity-60"
										disabled={switching}
										onClick={async () => {
											setSwitching(true);
											try {
												await switchCompany(pendingCompany.id);
												navigate("/overview");
											} finally {
												setSwitching(false);
												setPendingSwitchId(null);
											}
										}}
									>
										{switching ? "Switching…" : "Switch workspace"}
									</button>
								</div>
							</motion.div>
						</motion.div>
					)}
				</AnimatePresence>,
				document.body,
			)}
		</>
	);
}

function SortableCompanyItem({
	company,
	isSelected,
	onSelect,
}: {
	company: Company;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: company.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			className={cn(
				"relative flex items-center justify-center w-12 h-12 cursor-pointer group rounded-[14px] transition-all duration-150",
				isSelected
					? "bg-setra-600/15 ring-2 ring-setra-500/40"
					: "hover:bg-muted/30",
			)}
			onClick={onSelect}
			title={company.name}
		>
			{/* Left edge pill */}
			<motion.div
				className="absolute left-[-14px] w-1 rounded-r-full bg-foreground"
				animate={{
					height: isSelected ? "20px" : "0px",
				}}
				whileHover={{ height: isSelected ? "20px" : "8px" }}
				transition={{ duration: 0.15 }}
			/>

			{/* Company icon */}
			<div className="relative">
				<CompanyPatternIcon
					companyName={company.name}
					logoUrl={company.logoUrl ?? null}
					brandColor={company.brandColor}
					size="lg"
				/>

				{/* Blue dot: live agents */}
				{company.hasLiveAgents && (
					<span
						className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-blue-400/90 animate-pulse border border-background"
						aria-hidden
					/>
				)}

				{/* Red dot: unread inbox */}
				{company.hasUnreadInbox && (
					<span
						className="absolute top-0 right-0 w-2 h-2 rounded-full bg-red-500 border border-background"
						aria-hidden
					/>
				)}
			</div>
		</div>
	);
}
