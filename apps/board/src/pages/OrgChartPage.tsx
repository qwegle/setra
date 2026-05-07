import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { OrgTree } from "../components/OrgTree";
import {
	Button,
	EmptyState,
	Input,
	PageHeader,
	Select,
	Skeleton,
} from "../components/ui";
import { useCompany } from "../context/CompanyContext";
import { type RosterEntry, api } from "../lib/api";

type StatusFilter = "all" | "running" | "idle" | "error";

function rosterStatus(entry: RosterEntry): "running" | "idle" | "error" {
	if (entry.is_active === 0) return "idle";
	if (entry.runtime_status === "running") return "running";
	if (entry.paused_reason && /error|fail/i.test(entry.paused_reason))
		return "error";
	return "idle";
}

export function OrgChartTab() {
	const { selectedCompany } = useCompany();
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [search, setSearch] = useState("");

	const { data: roster = [], isLoading } = useQuery({
		queryKey: ["agents-roster", selectedCompany?.id ?? "all"],
		queryFn: () => api.agents.roster.list(selectedCompany?.id),
		refetchInterval: 10_000,
	});

	const filtered = roster.filter((entry) => {
		if (statusFilter !== "all") {
			const s = rosterStatus(entry);
			if (s !== statusFilter) return false;
		}
		if (search.trim() !== "") {
			const q = search.trim().toLowerCase();
			const nameMatch = entry.display_name.toLowerCase().includes(q);
			const agentMatch = entry.agent.toLowerCase().includes(q);
			if (!nameMatch && !agentMatch) return false;
		}
		return true;
	});

	const companyName = selectedCompany?.name ?? "Organization";

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
			<PageHeader
				title={companyName}
				subtitle={`Agent org chart — ${roster.length} agent${roster.length !== 1 ? "s" : ""} on roster.`}
			/>

			<div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
				<Input
					label="Search agents"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search agents…"
				/>
				<Select
					label="Status"
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
				>
					<option value="all">All statuses</option>
					<option value="running">Running</option>
					<option value="idle">Idle</option>
					<option value="error">Error</option>
				</Select>
			</div>

			{isLoading ? (
				<div className="space-y-3">
					<Skeleton variant="rect" height="96px" />
					<Skeleton variant="rect" height="96px" />
					<Skeleton variant="rect" height="96px" />
				</div>
			) : roster.length === 0 ? (
				<EmptyState
					icon={<Users className="h-10 w-10" aria-hidden="true" />}
					title="No agents configured"
					description="Create your first agent to start building the org chart."
					action={
						<Link to="/agents">
							<Button
								type="button"
								variant="secondary"
								icon={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
							>
								Go to Agents
							</Button>
						</Link>
					}
				/>
			) : filtered.length === 0 ? (
				<EmptyState
					icon={<Users className="h-10 w-10" aria-hidden="true" />}
					title="No matching agents"
					description="Try widening the search or changing the status filter."
				/>
			) : (
				<OrgTree entries={filtered} />
			)}
		</div>
	);
}
