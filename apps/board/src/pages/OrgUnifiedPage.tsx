import { Bot, Network, Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "../lib/utils";
import { OrgChartTab } from "./OrgChartPage";
import { OrgMembersTab } from "./OrgPage";
import { OrgAgentsTab } from "./OrganizationPage";

/**
 * Unified Organization page.
 *
 * Replaces the three previously-separate routes (/org, /organization,
 * /org-chart) with a single page and three tabs:
 *
 *  - Members: humans (owner/admin/member roles, invite flow)
 *  - Agents:  AI roster (templates, hire/fire flow, models, costs)
 *  - Chart:   org structure (flat today; Phase 3 ports the paperclip SVG tree)
 *
 * The active tab lives in the ?tab=... query string so it survives reloads
 * and can be linked to. Legacy URLs `/organization` and `/org-chart` are
 * redirected to `/org?tab=agents` and `/org?tab=chart` respectively.
 */

type TabId = "members" | "agents" | "chart";
const VALID_TABS: TabId[] = ["members", "agents", "chart"];

const TABS: Array<{ id: TabId; label: string; icon: typeof Users }> = [
	{ id: "members", label: "Members", icon: Users },
	{ id: "agents", label: "Agents", icon: Bot },
	{ id: "chart", label: "Chart", icon: Network },
];

export function OrgPage() {
	const [params, setParams] = useSearchParams();
	const raw = params.get("tab") ?? "members";
	const active: TabId = (VALID_TABS as string[]).includes(raw)
		? (raw as TabId)
		: "members";

	function setTab(id: TabId): void {
		const next = new URLSearchParams(params);
		next.set("tab", id);
		setParams(next, { replace: true });
	}

	return (
		<div className="flex flex-col h-full">
			{/* Tab strip */}
			<div className="px-6 pt-5 border-b border-border/40">
				<div className="flex items-end gap-1">
					{TABS.map(({ id, label, icon: Icon }) => {
						const isActive = id === active;
						return (
							<button
								key={id}
								onClick={() => setTab(id)}
								className={cn(
									"flex items-center gap-2 px-3 py-2 -mb-px border-b-2 text-sm transition-colors",
									isActive
										? "border-setra-400 text-foreground font-medium"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
								aria-selected={isActive}
								role="tab"
							>
								<Icon className="w-4 h-4" />
								{label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Tab body */}
			<div className="flex-1 overflow-auto">
				{active === "members" && <OrgMembersTab />}
				{active === "agents" && <OrgAgentsTab />}
				{active === "chart" && <OrgChartTab />}
			</div>
		</div>
	);
}
