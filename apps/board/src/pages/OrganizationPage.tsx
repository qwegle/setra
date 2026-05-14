import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Bot,
	Building2,
	Check,
	ChevronDown,
	Cpu,
	Crown,
	Loader2,
	Lock,
	Plus,
	Trash2,
	X,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge, Button, PageHeader } from "../components/ui";
import { useCompany } from "../context/CompanyContext";
import {
	type AgentTemplate,
	type CostTier,
	type RosterEntry,
	api,
} from "../lib/api";
import { cn } from "../lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS = [
	"claude-opus-4-7",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
	"claude-opus-4-5",
	"claude-sonnet-4-5",
] as const;

const COST_TIER_COLORS: Record<CostTier, string> = {
	low: "text-accent-green border-accent-green/30 bg-accent-green/10",
	medium: "text-accent-yellow border-accent-yellow/30 bg-accent-yellow/10",
	high: "text-accent-red border-accent-red/30 bg-accent-red/10",
};

const COST_TIER_LABELS: Record<CostTier, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CostBadge({ tier }: { tier: CostTier }) {
	return (
		<span
			className={cn(
				"text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide",
				COST_TIER_COLORS[tier],
			)}
		>
			{COST_TIER_LABELS[tier]}
		</span>
	);
}

function ModelBadge({ model }: { model: string | null }) {
	if (!model) return null;
	return (
		<span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/30 truncate max-w-[140px]">
			{model}
		</span>
	);
}

// ─── Hire Modal ───────────────────────────────────────────────────────────────

function HireModal({
	templates,
	roster,
	onClose,
	onHire,
}: {
	templates: AgentTemplate[];
	roster: RosterEntry[];
	onClose: () => void;
	onHire: (body: {
		templateId: string;
		displayName: string;
		reportsTo?: string | null;
	}) => void;
}) {
	const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
	const [displayName, setDisplayName] = useState(templates[0]?.name ?? "");
	const [reportsTo, setReportsTo] = useState<string>("");
	const [loading, setLoading] = useState(false);

	const selectedTemplate = templates.find((t) => t.id === templateId);

	function handleTemplateChange(id: string) {
		setTemplateId(id);
		const t = templates.find((t) => t.id === id);
		if (t) setDisplayName(t.name);
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!templateId || !displayName.trim()) return;
		setLoading(true);
		try {
			await onHire({
				templateId,
				displayName: displayName.trim(),
				reportsTo: reportsTo || null,
			});
			onClose();
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/80 backdrop-blur-sm">
			<div className="glass rounded-xl border border-border/60 w-full max-w-md p-6 flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Bot className="w-4 h-4 text-setra-400" />
						<h2 className="text-base font-semibold text-foreground">
							Add Agent
						</h2>
					</div>
					<button
						onClick={onClose}
						className="text-muted-foreground/50 hover:text-foreground transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">
							Role Template
						</label>
						<select
							value={templateId}
							onChange={(e) => handleTemplateChange(e.target.value)}
							className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
						>
							{templates.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
						{selectedTemplate?.description && (
							<p className="text-[11px] text-muted-foreground/60 mt-0.5">
								{selectedTemplate.description}
							</p>
						)}
					</div>

					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">
							Display Name
						</label>
						<input
							type="text"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
							placeholder="e.g. Alex (CEO)"
							className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
							required
						/>
					</div>

					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">
							Reports To (optional)
						</label>
						<select
							value={reportsTo}
							onChange={(e) => setReportsTo(e.target.value)}
							className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
						>
							<option value="">— No manager —</option>
							{roster.map((r) => (
								<option key={r.id} value={r.id}>
									{r.display_name} ({r.template_name})
								</option>
							))}
						</select>
					</div>

					{selectedTemplate && (
						<div className="flex items-center gap-2 p-2.5 bg-muted/20 rounded-lg border border-border/20">
							<ModelBadge model={selectedTemplate.model} />
							<CostBadge tier={selectedTemplate.estimated_cost_tier} />
						</div>
					)}

					<div className="flex gap-2 justify-end pt-1">
						<button
							type="button"
							onClick={onClose}
							className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={loading || !displayName.trim() || !templateId}
							className="flex items-center gap-1.5 px-4 py-1.5 bg-setra-600 hover:bg-setra-500 disabled:opacity-40 text-[#2b2418] text-sm rounded-md transition-colors"
						>
							{loading ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Plus className="w-3.5 h-3.5" />
							)}
							Add Agent
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// ─── Create Template Modal ────────────────────────────────────────────────────

function CreateTemplateModal({
	onClose,
	onCreate,
}: {
	onClose: () => void;
	onCreate: (body: {
		name: string;
		description?: string;
		agent: string;
		model?: string;
		estimatedCostTier: string;
	}) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [agent, setAgent] = useState("");
	const [model, setModel] = useState<string>(MODELS[1]);
	const [costTier, setCostTier] = useState<CostTier>("medium");
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim() || !agent.trim()) return;
		setLoading(true);
		try {
			await onCreate({
				name: name.trim(),
				...(description.trim() ? { description: description.trim() } : {}),
				agent: agent.trim(),
				...(model ? { model } : {}),
				estimatedCostTier: costTier,
			});
			onClose();
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/80 backdrop-blur-sm">
			<div className="glass rounded-xl border border-border/60 w-full max-w-md p-6 flex flex-col gap-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Zap className="w-4 h-4 text-setra-400" />
						<h2 className="text-base font-semibold text-foreground">
							Create Custom Template
						</h2>
					</div>
					<button
						onClick={onClose}
						className="text-muted-foreground/50 hover:text-foreground transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">Role Name *</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Data Scientist"
							className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
							required
						/>
					</div>

					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">Description</label>
						<input
							type="text"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="What does this agent do?"
							className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
						/>
					</div>

					<div className="flex flex-col gap-1">
						<label className="text-xs text-muted-foreground">
							Agent Slug *
						</label>
						<input
							type="text"
							value={agent}
							onChange={(e) => setAgent(e.target.value)}
							placeholder="e.g. data-scientist"
							className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
							required
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1">
							<label className="text-xs text-muted-foreground">Model</label>
							<select
								value={model}
								onChange={(e) => setModel(e.target.value)}
								className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-xs text-foreground focus:outline-none focus:border-setra-500"
							>
								{MODELS.map((m) => (
									<option key={m} value={m}>
										{m}
									</option>
								))}
							</select>
						</div>

						<div className="flex flex-col gap-1">
							<label className="text-xs text-muted-foreground">Cost Tier</label>
							<select
								value={costTier}
								onChange={(e) => setCostTier(e.target.value as CostTier)}
								className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
							>
								<option value="low">Low</option>
								<option value="medium">Medium</option>
								<option value="high">High</option>
							</select>
						</div>
					</div>

					<div className="flex gap-2 justify-end pt-1">
						<button
							type="button"
							onClick={onClose}
							className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={loading || !name.trim() || !agent.trim()}
							className="flex items-center gap-1.5 px-4 py-1.5 bg-setra-600 hover:bg-setra-500 disabled:opacity-40 text-[#2b2418] text-sm rounded-md transition-colors"
						>
							{loading ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<Check className="w-3.5 h-3.5" />
							)}
							Create Template
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// ─── Roster Card ──────────────────────────────────────────────────────────────

function RosterCard({
	entry,
	roster,
	onUpdate,
	onFire,
}: {
	entry: RosterEntry;
	roster: RosterEntry[];
	onUpdate: (
		id: string,
		body: {
			displayName?: string;
			reportsTo?: string | null;
			isActive?: boolean;
		},
	) => void;
	onFire: (id: string) => void;
}) {
	const managerName = entry.reports_to
		? (roster.find((r) => r.id === entry.reports_to)?.display_name ?? "Unknown")
		: null;

	return (
		<div
			className={cn(
				"glass rounded-xl p-4 border transition-all",
				entry.is_active ? "border-border/40" : "border-border/20 opacity-60",
			)}
		>
			<div className="flex items-start gap-3">
				<div className="flex items-center justify-center w-9 h-9 rounded-lg bg-setra-600/15 shrink-0">
					<Bot className="w-4 h-4 text-setra-400" />
				</div>

				<div className="flex-1 min-w-0">
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							<p className="text-sm font-medium text-foreground truncate">
								{entry.display_name}
							</p>
							<p className="text-xs text-muted-foreground/60 truncate">
								{entry.template_name}
							</p>
						</div>
						<div className="flex items-center gap-1.5 shrink-0">
							{/* Active toggle */}
							<button
								onClick={() =>
									onUpdate(entry.id, { isActive: !entry.is_active })
								}
								title={entry.is_active ? "Deactivate" : "Activate"}
								className={cn(
									"w-8 h-4 rounded-full relative transition-colors",
									entry.is_active ? "bg-setra-600" : "bg-muted/60",
								)}
							>
								<span
									className={cn(
										"absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
										entry.is_active ? "left-4.5" : "left-0.5",
									)}
								/>
							</button>
							{/* Fire */}
							<button
								onClick={() => onFire(entry.id)}
								title="Remove from roster"
								className="p-1 text-muted-foreground/30 hover:text-accent-red transition-colors"
							>
								<Trash2 className="w-3.5 h-3.5" />
							</button>
						</div>
					</div>

					<div className="flex items-center gap-2 mt-2 flex-wrap">
						<ModelBadge model={entry.model} />
						<CostBadge tier={entry.estimated_cost_tier} />
					</div>

					{/* Reports to selector */}
					<div className="flex items-center gap-1.5 mt-2">
						<ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" />
						<select
							value={entry.reports_to ?? ""}
							onChange={(e) =>
								onUpdate(entry.id, { reportsTo: e.target.value || null })
							}
							className="flex-1 bg-transparent text-xs text-muted-foreground/70 focus:outline-none focus:text-foreground cursor-pointer"
						>
							<option value="">Reports to: nobody (top-level)</option>
							{roster
								.filter((r) => r.id !== entry.id)
								.map((r) => (
									<option key={r.id} value={r.id}>
										Reports to: {r.display_name}
									</option>
								))}
						</select>
					</div>

					{managerName && (
						<p className="text-[10px] text-muted-foreground/40 mt-0.5 pl-4">
							under {managerName}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({ template }: { template: AgentTemplate }) {
	return (
		<div className="glass rounded-xl p-4 border border-border/40 flex flex-col gap-3 hover:border-setra-600/30 transition-all">
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-center gap-2.5">
					<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-setra-600/10 shrink-0">
						{template.is_builtin ? (
							<Crown className="w-3.5 h-3.5 text-setra-300" />
						) : (
							<Cpu className="w-3.5 h-3.5 text-muted-foreground" />
						)}
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-1.5">
							<p className="text-sm font-medium text-foreground">
								{template.name}
							</p>
							{template.is_builtin ? (
								<Lock className="w-3 h-3 text-setra-300/60 shrink-0" />
							) : null}
						</div>
						{template.is_builtin ? (
							<span className="text-[10px] text-setra-300/70 font-medium">
								Built-in
							</span>
						) : (
							<span className="text-[10px] text-muted-foreground/50">
								Custom
							</span>
						)}
					</div>
				</div>
				<CostBadge tier={template.estimated_cost_tier} />
			</div>

			{template.description && (
				<p className="text-xs text-muted-foreground/70 leading-relaxed">
					{template.description}
				</p>
			)}

			<div className="flex items-center gap-2 mt-auto pt-1 border-t border-border/20">
				<ModelBadge model={template.model} />
				<span className="font-mono text-[10px] text-muted-foreground/40">
					{template.agent}
				</span>
			</div>
		</div>
	);
}

// ─── Roster Tab ───────────────────────────────────────────────────────────────

function RosterTab() {
	const qc = useQueryClient();
	const { selectedCompanyId } = useCompany();
	const [showHire, setShowHire] = useState(false);

	const { data: roster = [], isLoading: rosterLoading } = useQuery({
		queryKey: ["roster", selectedCompanyId ?? "all"],
		queryFn: () => api.agents.roster.list(selectedCompanyId ?? undefined),
	});

	const { data: templates = [] } = useQuery({
		queryKey: ["agent-templates"],
		queryFn: () => api.agents.templates.list(),
	});

	const hire = useMutation({
		mutationFn: (body: {
			templateId: string;
			displayName: string;
			reportsTo?: string | null;
		}) =>
			api.agents.roster.hire({ ...body, companyId: selectedCompanyId ?? null }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["roster"] }),
	});

	const update = useMutation({
		mutationFn: ({
			id,
			body,
		}: {
			id: string;
			body: {
				displayName?: string;
				reportsTo?: string | null;
				isActive?: boolean;
			};
		}) => api.agents.roster.update(id, body),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["roster"] }),
	});

	const fire = useMutation({
		mutationFn: api.agents.roster.fire,
		onSuccess: () => qc.invalidateQueries({ queryKey: ["roster"] }),
	});

	// Build hierarchy: top-level first, then those who report to them
	const topLevel = roster.filter((r) => !r.reports_to);
	const getReports = (id: string) => roster.filter((r) => r.reports_to === id);

	function renderEntry(entry: RosterEntry, depth = 0): React.ReactNode {
		const reports = getReports(entry.id);
		return (
			<div
				key={entry.id}
				style={{ marginLeft: depth > 0 ? `${depth * 1.5}rem` : 0 }}
				className="space-y-2"
			>
				<RosterCard
					entry={entry}
					roster={roster}
					onUpdate={(id, body) => update.mutate({ id, body })}
					onFire={(id) => fire.mutate(id)}
				/>
				{reports.map((r) => renderEntry(r, depth + 1))}
			</div>
		);
	}

	// Render deeply-nested entries that may not be reached by topLevel traversal
	const rendered = new Set<string>();
	function renderTree(entry: RosterEntry, depth = 0): React.ReactNode {
		if (rendered.has(entry.id)) return null;
		rendered.add(entry.id);
		const reports = getReports(entry.id);
		return (
			<div
				key={entry.id}
				style={{ marginLeft: depth > 0 ? `${depth * 1.5}rem` : 0 }}
				className="space-y-2"
			>
				<RosterCard
					entry={entry}
					roster={roster}
					onUpdate={(id, body) => update.mutate({ id, body })}
					onFire={(id) => fire.mutate(id)}
				/>
				{reports.map((r) => renderTree(r, depth + 1))}
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Sub-header */}
			<div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
				<div>
					<h2 className="text-sm font-medium text-foreground">
						Your Workspace
					</h2>
					<p className="text-xs text-muted-foreground/60 mt-0.5">
						{roster.length} agent{roster.length !== 1 ? "s" : ""} on the roster
					</p>
				</div>
				<button
					onClick={() => setShowHire(true)}
					className="flex items-center gap-1.5 px-3 py-1.5 bg-setra-600 hover:bg-setra-500 text-[#2b2418] text-sm rounded-md transition-colors"
				>
					<Plus className="w-3.5 h-3.5" />
					Add Agent
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				{rosterLoading ? (
					<div className="flex items-center justify-center h-32">
						<Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
					</div>
				) : roster.length === 0 ? (
					/* Empty state */
					<div className="flex flex-col items-center justify-center h-full min-h-[320px] gap-4 text-center">
						<div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-setra-600/10 border border-setra-600/20">
							<Building2 className="w-8 h-8 text-setra-400" />
						</div>
						<div className="space-y-1.5 max-w-xs">
							<h3 className="text-base font-semibold text-foreground">
								Set up your workspace
							</h3>
							<p className="text-sm text-muted-foreground/70 leading-relaxed">
								Add AI agents to your team. Each agent gets a role, model, and
								reporting relationship so work can be coordinated clearly.
							</p>
						</div>
						<button
							onClick={() => setShowHire(true)}
							className="flex items-center gap-1.5 px-4 py-2 bg-setra-600 hover:bg-setra-500 text-[#2b2418] text-sm rounded-md transition-colors"
						>
							<Plus className="w-3.5 h-3.5" />
							Add your first agent
						</button>
					</div>
				) : (
					<div className="space-y-3 max-w-2xl">
						{topLevel.map((entry) => renderTree(entry))}
						{/* Orphaned entries (reportsTo points to a deleted entry) */}
						{roster
							.filter((r) => !rendered.has(r.id))
							.map((entry) => renderTree(entry))}
					</div>
				)}
			</div>

			{showHire && (
				<HireModal
					templates={templates}
					roster={roster}
					onClose={() => setShowHire(false)}
					onHire={hire.mutateAsync}
				/>
			)}
		</div>
	);
}

// ─── Templates Tab ────────────────────────────────────────────────────────────

function TemplatesTab() {
	const qc = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);

	const { data: templates = [], isLoading } = useQuery({
		queryKey: ["agent-templates"],
		queryFn: () => api.agents.templates.list(),
	});

	const create = useMutation({
		mutationFn: api.agents.templates.create,
		onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-templates"] }),
	});

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="flex items-center justify-between px-6 py-4 border-b border-border/30">
				<div>
					<h2 className="text-sm font-medium text-foreground">
						Role Templates
					</h2>
					<p className="text-xs text-muted-foreground/60 mt-0.5">
						{templates.length} template{templates.length !== 1 ? "s" : ""}{" "}
						available
					</p>
				</div>
				<button
					onClick={() => setShowCreate(true)}
					className="flex items-center gap-1.5 px-3 py-1.5 bg-setra-600 hover:bg-setra-500 text-[#2b2418] text-sm rounded-md transition-colors"
				>
					<Plus className="w-3.5 h-3.5" />
					Create Custom Template
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				{isLoading ? (
					<div className="flex items-center justify-center h-32">
						<Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
					</div>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
						{templates.map((t) => (
							<TemplateCard key={t.id} template={t} />
						))}
					</div>
				)}
			</div>

			{showCreate && (
				<CreateTemplateModal
					onClose={() => setShowCreate(false)}
					onCreate={create.mutateAsync}
				/>
			)}
		</div>
	);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "roster" | "templates";

export function OrgAgentsTab() {
	const [activeTab, setActiveTab] = useState<Tab>("roster");

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Header */}
			<div className="border-b border-border/50 px-6 py-4">
				<PageHeader
					title="Workspace"
					subtitle="Set up your AI team — roles, hierarchy, and model assignments."
					actions={<Badge variant="info">{activeTab}</Badge>}
				/>
			</div>

			{/* Tabs */}
			<div className="flex gap-1 px-6 pt-3 border-b border-border/30">
				{(["roster", "templates"] as Tab[]).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={cn(
							"px-4 py-2 text-sm font-medium rounded-t-md transition-colors border-b-2 -mb-px capitalize",
							activeTab === tab
								? "border-setra-400 text-setra-300"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{tab === "roster" ? "Roster" : "Templates"}
					</button>
				))}
			</div>

			{/* Tab content */}
			<div className="flex-1 overflow-hidden">
				{activeTab === "roster" && <RosterTab />}
				{activeTab === "templates" && <TemplatesTab />}
			</div>
		</div>
	);
}
