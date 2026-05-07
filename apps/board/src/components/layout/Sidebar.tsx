import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
	Activity,
	Bot,
	Coins,
	ExternalLink,
	FolderKanban,
	FolderTree,
	Heart,
	LayoutDashboard,
	LayoutGrid,
	type LucideIcon,
	MessageSquare,
	Plug,
	Settings,
	ShieldCheck,
	Target,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useCompany } from "../../context/CompanyContext";
import type { SSEStatus } from "../../hooks/useEventStream";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { CompanyPatternIcon } from "../CompanyPatternIcon";

const workNav = [
	{ to: "/overview", label: "Overview", icon: LayoutDashboard },
	{ to: "/projects", label: "Projects", icon: FolderKanban },
	{ to: "/goals", label: "Goals", icon: Target },
	{ to: "/activity", label: "Activity", icon: Activity },
];

const teamNav = [
	{ to: "/agents", label: "Agents", icon: Bot },
	{ to: "/collaboration", label: "Collaboration", icon: MessageSquare },
	{ to: "/approvals", label: "Approvals", icon: ShieldCheck },
];

const toolsNav = [
	{ to: "/mcp", label: "AI Tools", icon: Plug },
	{ to: "/integrations", label: "Integrations", icon: ExternalLink },
	{ to: "/environments", label: "Environments", icon: LayoutGrid },
	{ to: "/files", label: "Files", icon: FolderTree },
];

const settingsNav = [
	{ to: "/settings", label: "Settings", icon: Settings },
	{ to: "/costs", label: "Costs & Budget", icon: Coins },
	{ to: "/health", label: "Health", icon: Heart },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
	return cn(
		"flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
		isActive
			? "bg-setra-600/15 text-setra-300 font-medium"
			: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
	);
}

function SectionLabel({ children }: { children: ReactNode }) {
	return (
		<div className="px-3 pb-1 pt-3">
			<span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
				{children}
			</span>
		</div>
	);
}

function NavSection({
	items,
	onItemClick,
}: {
	items: Array<{
		to: string;
		label: string;
		icon: LucideIcon;
	}>;
	onItemClick?: (() => void) | undefined;
}) {
	return items.map(({ to, label, icon: Icon }) => (
		<NavLink key={to} to={to} className={navLinkClass} onClick={onItemClick}>
			<Icon className="h-4 w-4 shrink-0" />
			<span className="truncate">{label}</span>
		</NavLink>
	));
}

function SidebarContent({
	onItemClick,
	showCloseButton = false,
	onClose,
}: {
	onItemClick?: () => void;
	showCloseButton?: boolean;
	onClose?: () => void;
}) {
	const { selectedCompany } = useCompany();
	const { isAdmin, user } = useAuth();
	const { data: pendingApprovals = [] } = useQuery({
		queryKey: ["sidebar-pending-approvals", selectedCompany?.id ?? null],
		queryFn: () => api.approvals.list("pending"),
		enabled: Boolean(selectedCompany?.id),
		refetchInterval: 10_000,
	});

	// Members see a trimmed Team section (no Agents)
	const memberTeamNav = teamNav.filter((item) => item.to !== "/agents");

	// Members see trimmed settings (no costs controls — admin only)
	const memberSettingsNav = settingsNav.filter((item) => item.to !== "/costs");

	return (
		<>
			<div className="flex items-center gap-2.5 border-b border-border/30 px-4 py-4">
				{selectedCompany ? (
					<>
						<CompanyPatternIcon
							companyName={selectedCompany.name}
							logoUrl={selectedCompany.logoUrl ?? null}
							brandColor={selectedCompany.brandColor}
							size="sm"
						/>
						<span className="flex-1 truncate text-sm font-semibold tracking-tight text-foreground">
							{selectedCompany.name}
						</span>
					</>
				) : (
					<span className="text-sm italic text-muted-foreground/60">
						Select workspace...
					</span>
				)}
				{showCloseButton && onClose ? (
					<button
						type="button"
						onClick={onClose}
						className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:hidden"
						aria-label="Close navigation menu"
					>
						<X className="h-4 w-4" />
					</button>
				) : null}
			</div>

			<nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
				<SectionLabel>Work</SectionLabel>
				<NavSection items={workNav} onItemClick={onItemClick} />

				<SectionLabel>Team</SectionLabel>
				<NavSection
					items={isAdmin ? teamNav : memberTeamNav}
					onItemClick={onItemClick}
				/>
				{isAdmin && pendingApprovals.length > 0 ? (
					<div className="px-3">
						<span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent-orange/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent-orange">
							{pendingApprovals.length} pending approval
							{pendingApprovals.length === 1 ? "" : "s"}
						</span>
					</div>
				) : null}

				<SectionLabel>Tools</SectionLabel>
				<NavSection items={toolsNav} onItemClick={onItemClick} />

				<SectionLabel>Settings</SectionLabel>
				<NavSection
					items={isAdmin ? settingsNav : memberSettingsNav}
					onItemClick={onItemClick}
				/>
			</nav>

			<div className="border-t border-border/30 px-3 py-3">
				<NavLink
					to="/profile"
					onClick={onItemClick}
					className={({ isActive }) =>
						cn(
							"flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
							isActive
								? "bg-accent-blue/10"
								: "hover:bg-muted/50",
						)
					}
				>
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-blue/20 text-xs font-semibold text-accent-blue">
						{user?.name
							? user.name
									.split(/\s+/)
									.map((p) => p[0]?.toUpperCase())
									.slice(0, 2)
									.join("")
							: user?.email?.[0]?.toUpperCase() ?? "?"}
					</div>
					<div className="min-w-0 flex-1">
						<p className="truncate text-sm font-medium text-foreground">
							{user?.name || user?.email || "Account"}
						</p>
						<p className="truncate text-[11px] capitalize text-muted-foreground/60">
							{user?.role ?? "member"}
						</p>
					</div>
				</NavLink>
			</div>
		</>
	);
}

export function Sidebar({
	sseStatus = "connecting",
	mobileOpen = false,
	onMobileOpenChange,
}: {
	sseStatus?: SSEStatus;
	mobileOpen?: boolean;
	onMobileOpenChange?: (open: boolean) => void;
}) {
	const location = useLocation();

	useEffect(() => {
		onMobileOpenChange?.(false);
	}, [location.pathname, onMobileOpenChange]);

	return (
		<>
			<aside className="fixed inset-y-0 left-[72px] z-30 hidden w-56 flex-col border-r border-border/50 bg-ground-900/80 backdrop-blur-xl md:flex">
				<SidebarContent />
			</aside>
			<AnimatePresence>
				{mobileOpen ? (
					<>
						<motion.button
							type="button"
							className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							onClick={() => onMobileOpenChange?.(false)}
							aria-label="Close navigation menu"
						/>
						<motion.aside
							className="fixed inset-y-0 left-0 z-50 flex w-full max-w-xs flex-col border-r border-border/50 bg-ground-900/95 shadow-2xl backdrop-blur-xl md:hidden"
							initial={{ x: "-100%" }}
							animate={{ x: 0 }}
							exit={{ x: "-100%" }}
							transition={{ type: "tween", duration: 0.2 }}
						>
							<SidebarContent
								onItemClick={() => onMobileOpenChange?.(false)}
								showCloseButton
								onClose={() => onMobileOpenChange?.(false)}
							/>
						</motion.aside>
					</>
				) : null}
			</AnimatePresence>
		</>
	);
}
