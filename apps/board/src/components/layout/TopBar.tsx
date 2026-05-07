import { useQuery } from "@tanstack/react-query";
import { Bot, Cpu, Menu, Search, Settings, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCompany } from "../../context/CompanyContext";
import { useDialog } from "../../context/DialogContext";
import type { SSEStatus } from "../../hooks/useEventStream";
import { api, request } from "../../lib/api";
import { cn } from "../../lib/utils";
import { AiCeoPanel } from "../AiCeoPanel";

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

const sseLabels: Record<SSEStatus, string> = {
	connected: "live",
	connecting: "connecting",
	disconnected: "offline",
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
	const { companies, selectedCompanyId } = useCompany();
	const base = "/" + pathname.split("/")[1];
	const pageName = PAGE_NAMES[base] ?? "setra";
	const [aiCeoOpen, setAiCeoOpen] = useState(false);
	const { openCommandPalette } = useDialog();

	const { data: llmStatus } = useQuery({
		queryKey: ["llm-status", selectedCompanyId],
		queryFn: () => api.llm.status(),
		enabled: !!selectedCompanyId,
		refetchInterval: 30_000,
		retry: false,
	});

	const { data: settingsData } = useQuery({
		queryKey: ["app-settings", selectedCompanyId],
		queryFn: () =>
			request<{
				isOfflineOnly: boolean;
				hasAnthropicKey: boolean;
				hasOpenaiKey: boolean;
				hasGeminiKey: boolean;
				hasOpenrouterKey: boolean;
			}>("/settings"),
		enabled: !!selectedCompanyId,
		refetchInterval: 60_000,
		retry: false,
	});

	const isOffline = settingsData?.isOfflineOnly ?? false;
	const hasAnyKey =
		settingsData?.hasAnthropicKey ||
		settingsData?.hasOpenaiKey ||
		settingsData?.hasGeminiKey ||
		settingsData?.hasOpenrouterKey;
	const noKeyWarning = !isOffline && !hasAnyKey;

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
			<header className="h-12 flex items-center px-4 border-b border-border/30 bg-ground-900/60 backdrop-blur-sm shrink-0 gap-3 md:gap-4">
				<button
					type="button"
					onClick={onToggleSidebar}
					className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground md:hidden"
					aria-label="Open navigation menu"
				>
					<Menu className="h-4 w-4" />
				</button>
				{/* Left: breadcrumb */}
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

				{/* Center: flexible space */}
				<div className="flex-1" />

				{/* Right: search + SSE status + settings */}
				<div className="flex items-center gap-2">
					{/* Search trigger */}
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

					{/* Divider */}
					<div className="w-px h-4 bg-border/40" />

					{/* SSE status indicator */}
					<div
						className={cn(
							"flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors",
							sseStatus === "connected"
								? "text-accent-green/80"
								: sseStatus === "connecting"
									? "text-accent-yellow/80"
									: "text-accent-red/80",
						)}
						title={`SSE: ${sseStatus}`}
					>
						<span className={cn("status-dot", sseColors[sseStatus])} />
						<span className="text-[11px] font-mono hidden sm:block">
							{sseLabels[sseStatus]}
						</span>
					</div>

					{/* Divider */}
					<div className="w-px h-4 bg-border/40" />

					{/* Online/Offline mode badge */}
					<button
						type="button"
						onClick={() => navigate("/settings")}
						title={
							isOffline
								? "Local mode — only local models (Ollama). Click to change."
								: noKeyWarning
									? "Cloud mode — no API key saved! Click to add one."
									: "Cloud mode — AI providers active. Click to configure."
						}
						className={cn(
							"flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-muted/50 font-medium",
							isOffline
								? "text-accent-yellow/90"
								: noKeyWarning
									? "text-accent-red/90"
									: "text-accent-green/90",
						)}
					>
						{isOffline ? (
							<WifiOff className="w-3.5 h-3.5" />
						) : (
							<Wifi className="w-3.5 h-3.5" />
						)}
						<span className="hidden sm:block">
							{isOffline ? "Local" : noKeyWarning ? "No key!" : "Cloud"}
						</span>
					</button>

					{/* Divider */}
					<div className="w-px h-4 bg-border/40" />

					{/* Active model pill */}
					<button
						type="button"
						onClick={() => navigate("/settings")}
						className={cn(
							"flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-muted/50",
							llmStatus?.live
								? "text-accent-green/90"
								: llmStatus?.configured
									? "text-accent-yellow/90"
									: "text-accent-red/90",
						)}
						title={
							llmStatus?.live
								? `Active model: ${llmStatus.modelName} (${llmStatus.provider})`
								: llmStatus?.modelId
									? `Model selected but provider key missing for ${llmStatus.provider}`
									: "No default model selected — click to configure"
						}
					>
						<Cpu className="w-3.5 h-3.5" />
						<span className="hidden sm:block max-w-[140px] truncate font-medium">
							{llmStatus?.modelName ?? "no model"}
						</span>
						<span
							className={cn(
								"w-1.5 h-1.5 rounded-full",
								llmStatus?.live
									? "bg-accent-green animate-pulse"
									: llmStatus?.configured
										? "bg-accent-yellow"
										: "bg-accent-red",
							)}
						/>
					</button>

					{/* Divider */}
					<div className="w-px h-4 bg-border/40" />

					{/* Settings icon */}
					<button
						type="button"
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
						title="Settings"
						onClick={() => navigate("/settings")}
					>
						<Settings className="w-4 h-4" />
					</button>

					{/* Divider */}
					<div className="w-px h-4 bg-border/40" />

					{/* Assistant button */}
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
