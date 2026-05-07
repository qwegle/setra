import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { useCompany } from "../context/CompanyContext";
import { type BudgetSummary, api } from "../lib/api";

/**
 * Top-of-page banner that surfaces budget hard-stop and alert states.
 *
 * Polls /api/budget/summary every 30s. When a hard stop is in effect,
 * shows a red banner with a "Resume" button that hits POST /budget/resume.
 * Below the hard-stop limit but past the alert threshold, shows an amber
 * advisory the user can dismiss for the session.
 */
export function BudgetBanner() {
	const qc = useQueryClient();
	const { selectedCompanyId } = useCompany();
	const [dismissed, setDismissed] = useState(false);

	const { data } = useQuery<BudgetSummary>({
		queryKey: ["budget", "summary", selectedCompanyId],
		queryFn: () => api.budget.summary() as Promise<BudgetSummary>,
		enabled: !!selectedCompanyId,
		refetchInterval: 30_000,
		retry: false,
	});

	const resume = useMutation({
		mutationFn: () => api.budget.resume(),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["budget"] });
			void qc.invalidateQueries({ queryKey: ["agents"] });
			void qc.invalidateQueries({ queryKey: ["agents-roster"] });
		},
	});

	if (!data) return null;

	if (data.hardStop?.triggered) {
		return (
			<div className="bg-red-500/10 border-b border-red-500/30 text-red-200 px-4 py-2 flex items-center gap-3 text-sm">
				<AlertTriangle className="w-4 h-4 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<span className="font-medium">Budget hard stop active.</span>{" "}
					<span className="text-red-200/80">
						{data.hardStop.agentsPaused} agent
						{data.hardStop.agentsPaused !== 1 ? "s" : ""} paused
						{data.hardStop.runsCancelled > 0
							? `, ${data.hardStop.runsCancelled} run${data.hardStop.runsCancelled !== 1 ? "s" : ""} cancelled`
							: ""}
						. Raise the limit in Settings or resume manually.
					</span>
				</div>
				<button
					type="button"
					onClick={() => resume.mutate()}
					disabled={resume.isPending}
					className="px-3 py-1 rounded bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-xs font-medium"
				>
					{resume.isPending ? "Resuming…" : "Resume agents"}
				</button>
			</div>
		);
	}

	if (data.alerts && data.alerts.length > 0 && !dismissed) {
		return (
			<div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-200 px-4 py-2 flex items-center gap-3 text-sm">
				<AlertTriangle className="w-4 h-4 flex-shrink-0" />
				<div className="flex-1 min-w-0 truncate">{data.alerts[0]}</div>
				<button
					type="button"
					onClick={() => setDismissed(true)}
					className="p-1 rounded hover:bg-amber-500/20"
					aria-label="Dismiss"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>
		);
	}

	return null;
}
