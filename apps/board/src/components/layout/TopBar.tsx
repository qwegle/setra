import { Bot, Menu, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCompany } from "../../context/CompanyContext";
import { useDialog } from "../../context/DialogContext";
import type { SSEStatus } from "../../hooks/useEventStream";
import { cn } from "../../lib/utils";
import { AiCeoPanel } from "../AiCeoPanel";
import { AdapterStatusPill } from "./AdapterStatusPill";

const PAGE_NAMES: Record<string, string> = {
	"/overview": "Overview",
	"/projects": "Projects",
	"/agents": "Agents",
	"/approvals": "Approvals",
	"/org": "Org",
	"/goals": "Goals",
	"/routines": "Routines",
	"/inbox": "Inbox",
	"/activity": "Activity",
	"/costs": "Costs & Budget",
	"/collaboration": "Collaboration",
	"/files": "Files",
	"/clone": "Build Your Clone",
	"/integrations": "Integrations",
	"/skills": "Skills",
	"/artifacts": "Artifacts",
	"/wiki": "Wiki",
	"/review": "Review Queue",
	"/organization": "Organization",
	"/settings": "Settings",
};

const sseColors: Record<SSEStatus, string> = {
	connected: "bg-accent-green animate-pulse",
	connecting: "bg-accent-yellow animate-pulse",
	disconnected: "bg-accent-red",
};

export function TopBar({
	sseStatus = "connecting",
	onToggleSidebar,
}: {
	sseStatus?: SSEStatus;
	onToggleSidebar?: () => void;
}) {
	const { pathname } = useLocation();
	const navigate = useNavigate();
	const { companies } = useCompany();
	const base = "/" + pathname.split("/")[1];
	const pageName = PAGE_NAMES[base] ?? "setra";
	const [aiCeoOpen, setAiCeoOpen] = useState(false);
	const { openCommandPalette } = useDialog();

	// Auto-open Assistant panel after onboarding
	useEffect(() => {
		const flag = localStorage.getItem("setra:show_ai_ceo");
		if (flag === "true") {
			localStorage.removeItem("setra:show_ai_ceo");
			setAiCeoOpen(true);
		}
	}, []);

	return (
		<>
			<header className="h-12 flex items-center px-4 border-b border-border/30 bg-[#fdfaf3]/60 backdrop-blur-sm shrink-0 gap-3 md:gap-4">
				<button
					type="button"
					onClick={onToggleSidebar}
					className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:hidden"
					aria-label="Open navigation menu"
				>
					<Menu className="h-4 w-4" />
				</button>
				{/* Left: breadcrumb only — Paperclip-style minimal */}
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-xs text-muted-foreground/50 hidden sm:block">
						setra
					</span>
					<span className="text-xs text-muted-foreground/30 hidden sm:block">
						/
					</span>
					<span className="text-sm font-medium text-foreground truncate">
						{pageName}
					</span>
				</div>

				<div className="flex-1" />

				{/* Right: search + tiny SSE dot + adapter pill + settings + assistant */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors border border-border/30"
						onClick={openCommandPalette}
					>
						<Search className="w-3.5 h-3.5" />
						<span className="hidden sm:block">Search</span>
						<kbd className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded font-mono ml-1 hidden sm:block">
							⌘K
						</kbd>
					</button>

					{/* Live-stream status reduced to a single dot (no label) per Paperclip-minimal redesign */}
					<span
						className={cn("status-dot", sseColors[sseStatus])}
						title={`Live updates: ${sseStatus}`}
					/>

					<AdapterStatusPill />

					<button
						type="button"
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
						title="Settings"
						onClick={() => navigate("/settings")}
					>
						<Settings className="w-4 h-4" />
					</button>

					<button
						type="button"
						className="relative flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
						title="Assistant"
						onClick={() => setAiCeoOpen(true)}
					>
						<Bot className="w-4 h-4" />
						<span className="hidden sm:block">Assistant</span>
						{companies.length > 0 && (
							<span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" />
						)}
					</button>
				</div>
			</header>
			<AiCeoPanel isOpen={aiCeoOpen} onClose={() => setAiCeoOpen(false)} />
		</>
	);
}
