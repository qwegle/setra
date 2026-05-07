import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CompanyProvider } from "../../context/CompanyContext";
import { type Company, useCompany } from "../../context/CompanyContext";
import { DialogProvider } from "../../context/DialogContext";
import { useDialog } from "../../context/DialogContext";
import { useEventStream } from "../../hooks/useEventStream";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { BudgetBanner } from "../BudgetBanner";
import { CommandPalette } from "../CommandPalette";
import { ErrorBoundary } from "../ErrorBoundary";
import { KeyboardShortcutsModal } from "../KeyboardShortcutsModal";
import { OnboardingWizard } from "../OnboardingWizard";
import { OrgRail } from "../OrgRail";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const ONBOARDING_DISMISSED_KEY = "setra:onboarding_dismissed";

function AppShellInner() {
	const sseStatus = useEventStream();
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const { onboardingOpen, openOnboarding, closeOnboarding } = useDialog();
	const {
		companies,
		addCompany,
		setSelectedCompanyId,
		switchState,
		loading,
		loadError,
	} = useCompany();
	const navigate = useNavigate();
	const location = useLocation();

	useKeyboardShortcuts({
		onToggleSidebar: () => {
			if (typeof window !== "undefined" && window.innerWidth < 768) {
				setMobileSidebarOpen((open) => !open);
			}
		},
	});

	useEffect(() => {
		if (loading || loadError) return;
		if (companies.length === 0) {
			if (location.pathname !== "/onboarding") {
				navigate("/onboarding", { replace: true });
			}
			if (!onboardingOpen) openOnboarding();
			return;
		}
		if (location.pathname === "/onboarding") {
			navigate("/overview", { replace: true });
		}
	}, [
		companies.length,
		loadError,
		loading,
		location.pathname,
		navigate,
		onboardingOpen,
		openOnboarding,
	]);

	function handleClose() {
		localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
		closeOnboarding();
	}

	return (
		<div className="flex h-screen w-screen overflow-hidden bg-background">
			<OrgRail />
			<Sidebar
				sseStatus={sseStatus}
				mobileOpen={mobileSidebarOpen}
				onMobileOpenChange={setMobileSidebarOpen}
			/>
			<div className="flex min-w-0 flex-1 flex-col md:pl-56">
				<TopBar
					sseStatus={sseStatus}
					onToggleSidebar={() => setMobileSidebarOpen((open) => !open)}
				/>
				<BudgetBanner />
				<main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 animate-fade-in">
					<ErrorBoundary>
						<Outlet />
					</ErrorBoundary>
				</main>
			</div>
			<AnimatePresence>
				{switchState.active && (
					<motion.div
						className="fixed inset-0 z-[60] flex items-center justify-center bg-ground-900/70 backdrop-blur-sm"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
					>
						<motion.div
							initial={{ opacity: 0, y: 10, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: 10, scale: 0.98 }}
							className="w-[440px] max-w-[92vw] rounded-xl border border-border/40 bg-ground-900/95 p-5 shadow-2xl"
						>
							<p className="text-xs uppercase tracking-wider text-muted-foreground/70">
								Switching workspace
							</p>
							<p className="mt-2 text-sm text-foreground/90">
								Switching from{" "}
								<span className="font-semibold">{switchState.fromName}</span> to{" "}
								<span className="font-semibold">{switchState.toName}</span>…
							</p>
							<div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
								<motion.div
									className="h-full bg-setra-500"
									initial={{ width: "0%" }}
									animate={{ width: "100%" }}
									transition={{ duration: 1, ease: "easeInOut" }}
								/>
							</div>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
			<CommandPalette />
			<KeyboardShortcutsModal />
			{onboardingOpen && (
				<OnboardingWizard
					onClose={handleClose}
					onCompanyCreated={(company) => {
						const validTypes = [
							"startup",
							"agency",
							"enterprise",
							"government",
							"personal",
						] as const;
						const validSizes = [
							"0-10",
							"10-50",
							"50-200",
							"200-1000",
							"1000+",
						] as const;
						addCompany({
							id: company.id,
							name: company.name,
							issuePrefix: company.issuePrefix,
							...(company.brandColor !== undefined
								? { brandColor: company.brandColor }
								: {}),
							...(validTypes.includes(
								company.type as (typeof validTypes)[number],
							)
								? { type: company.type as Company["type"] }
								: {}),
							...(validSizes.includes(
								company.size as (typeof validSizes)[number],
							)
								? { size: company.size as Company["size"] }
								: {}),
						} as Omit<Company, "order">);
						setSelectedCompanyId(company.id);
						localStorage.setItem("setra:show_ai_ceo", "true");
						localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
						closeOnboarding();
						navigate("/overview");
					}}
				/>
			)}
		</div>
	);
}

export function AppShell() {
	return (
		<CompanyProvider>
			<DialogProvider>
				<AppShellInner />
			</DialogProvider>
		</CompanyProvider>
	);
}

// Re-export SSE status type for Sidebar / TopBar consumers
export type { SSEStatus } from "../../hooks/useEventStream";
