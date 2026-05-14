/**
 * AdapterStatusPill — single right-side TopBar control that shows the user's
 * preferred coding-CLI adapter, whether it's installed locally, and (in a
 * popover) lets them switch the preferred adapter and pick a global model
 * override. Replaces the older SSE-label / Cloud-mode badge / fake "model pill"
 * trio that the user explicitly called out as confusing.
 *
 * Data sources:
 *  - GET /api/cli-status → installed state + version per CLI (no auth)
 *  - GET /company/settings → preferredCli, legacyApiKeysEnabled
 *  - PATCH /company/settings → persist preferredCli changes
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Cpu, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCompany } from "../../context/CompanyContext";
import { api, companySettings as companySettingsApi } from "../../lib/api";
import { cn } from "../../lib/utils";

const FALLBACK_PREFERRED = "claude";

export function AdapterStatusPill() {
	const navigate = useNavigate();
	const { selectedCompanyId } = useCompany();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const wrapperRef = useRef<HTMLDivElement>(null);

	const { data: cliData } = useQuery({
		queryKey: ["cli-status"],
		queryFn: () => api.cliStatus.list(),
		refetchInterval: 30_000,
		retry: false,
	});

	const { data: settings } = useQuery({
		queryKey: ["company-settings", selectedCompanyId],
		queryFn: () => companySettingsApi.get(),
		enabled: !!selectedCompanyId,
		staleTime: 60_000,
	});

	const adapters = cliData?.adapters ?? [];
	const preferredId = settings?.preferredCli ?? FALLBACK_PREFERRED;
	const preferred = adapters.find((a) => a.id === preferredId) ?? adapters[0];
	const installed = preferred?.installed ?? false;

	const setPreferred = useMutation({
		mutationFn: (id: string) =>
			companySettingsApi.update({ preferredCli: id }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["company-settings", selectedCompanyId],
			});
		},
	});

	useEffect(() => {
		if (!open) return;
		const onClickOutside = (e: MouseEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onClickOutside);
		return () => document.removeEventListener("mousedown", onClickOutside);
	}, [open]);

	const dotClass = installed
		? "bg-accent-green"
		: preferred
			? "bg-accent-red"
			: "bg-muted-foreground/40";

	const title = preferred
		? installed
			? `${preferred.label} ${preferred.version ?? ""} installed`.trim()
			: `${preferred.label} not installed — click for install command`
		: "No CLI adapter selected";

	return (
		<div ref={wrapperRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				title={title}
				className={cn(
					"flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-muted/50 font-medium border border-border/30",
					installed ? "text-foreground" : "text-muted-foreground",
				)}
			>
				<Cpu className="w-3.5 h-3.5" />
				<span className="hidden sm:block">
					{preferred?.label ?? "no CLI"}
				</span>
				<span className={cn("w-1.5 h-1.5 rounded-full", dotClass)} />
				<ChevronDown className="w-3 h-3 opacity-60" />
			</button>

			{open && (
				<div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border/40 bg-ground-900/95 shadow-xl backdrop-blur-sm z-50 p-3">
					<p className="text-xs text-muted-foreground mb-2 font-medium">
						Preferred coding CLI
					</p>
					<div className="space-y-1">
						{adapters.length === 0 && (
							<p className="text-xs text-muted-foreground italic">
								Detecting installed CLIs…
							</p>
						)}
						{adapters.map((adapter) => {
							const isPreferred = adapter.id === preferredId;
							return (
								<button
									key={adapter.id}
									type="button"
									onClick={() => {
										setPreferred.mutate(adapter.id);
										setOpen(false);
									}}
									className={cn(
										"w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-muted/50",
										isPreferred && "bg-muted/40",
									)}
								>
									<span
										className={cn(
											"w-1.5 h-1.5 rounded-full shrink-0",
											adapter.installed
												? "bg-accent-green"
												: "bg-muted-foreground/40",
										)}
									/>
									<span className="text-sm text-foreground flex-1 truncate">
										{adapter.label}
									</span>
									{adapter.installed ? (
										<span className="text-[10px] font-mono text-muted-foreground">
											{adapter.version ?? "installed"}
										</span>
									) : (
										<span className="text-[10px] text-muted-foreground italic">
											not installed
										</span>
									)}
									{isPreferred && (
										<Check className="w-3.5 h-3.5 text-accent-green" />
									)}
								</button>
							);
						})}
					</div>

					{preferred && !installed && (
						<div className="mt-3 rounded-md border border-border/40 bg-muted/30 px-2 py-2">
							<p className="text-[11px] text-muted-foreground mb-1">
								Install {preferred.label}:
							</p>
							<code className="block text-[11px] font-mono text-foreground break-all">
								{preferred.installCommand}
							</code>
							{preferred.docUrl && (
								<a
									href={preferred.docUrl}
									target="_blank"
									rel="noreferrer"
									className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
								>
									Docs <ExternalLink className="w-3 h-3" />
								</a>
							)}
						</div>
					)}

					{settings?.legacyApiKeysEnabled && (
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								navigate("/settings");
							}}
							className="mt-3 w-full text-left text-[11px] text-amber-300 hover:underline"
						>
							Legacy API keys are enabled — open Settings
						</button>
					)}
				</div>
			)}
		</div>
	);
}
