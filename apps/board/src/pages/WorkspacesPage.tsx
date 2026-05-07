import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Cpu,
	HardDrive,
	Loader2,
	MemoryStick,
	MoreHorizontal,
	Pencil,
	Plus,
	Server,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import {
	Badge,
	Button,
	EmptyState,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { type Workspace, workspaces } from "../lib/api";
import { cn, timeAgo } from "../lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

type WorkspaceType = Workspace["type"];

type AddFormData = {
	name: string;
	type: WorkspaceType;
	// Docker
	image: string;
	volumes: string;
	// Remote SSH
	host: string;
	port: string;
	username: string;
	authType: "key" | "password";
	// Cloud
	provider: "aws" | "gcp" | "azure";
	region: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<WorkspaceType, { label: string; cls: string }> = {
	local: {
		label: "Local",
		cls: "bg-blue-500/15 text-blue-400 border-blue-500/20",
	},
	docker: {
		label: "Docker",
		cls: "bg-accent-purple/15 text-accent-purple border-accent-purple/20",
	},
	"remote-ssh": {
		label: "Remote SSH",
		cls: "bg-accent-orange/15 text-accent-orange border-accent-orange/20",
	},
	cloud: {
		label: "Cloud",
		cls: "bg-accent-green/15 text-accent-green border-accent-green/20",
	},
};

const STATUS_CONFIG: Record<
	Workspace["status"],
	{ dot: string; label: string }
> = {
	running: { dot: "bg-accent-green animate-pulse", label: "Running" },
	stopped: { dot: "bg-muted-foreground/40", label: "Stopped" },
	unknown: { dot: "bg-accent-yellow", label: "Unknown" },
};

function defaultFormData(): AddFormData {
	return {
		name: "",
		type: "local",
		image: "",
		volumes: "",
		host: "",
		port: "22",
		username: "",
		authType: "key",
		provider: "aws",
		region: "",
	};
}

// ─── Action Menu ───────────────────────────────────────────────────────────────

function ActionMenu({
	workspace,
	onEdit,
	onSetDefault,
	onDelete,
}: {
	workspace: Workspace;
	onEdit: () => void;
	onSetDefault: () => void;
	onDelete: () => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen((v) => !v);
				}}
				className="p-1 text-muted-foreground/40 hover:text-foreground transition-colors rounded"
			>
				<MoreHorizontal className="w-4 h-4" />
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
					<div className="absolute right-0 top-7 z-20 w-44 glass rounded-lg shadow-lg border border-border/30 py-1 text-sm">
						<button
							type="button"
							onClick={() => {
								onEdit();
								setOpen(false);
							}}
							className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
						>
							<Pencil className="w-3.5 h-3.5 text-muted-foreground/40" />
							Edit
						</button>
						{!workspace.isDefault && (
							<button
								type="button"
								onClick={() => {
									onSetDefault();
									setOpen(false);
								}}
								className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors"
							>
								<Star className="w-3.5 h-3.5 text-muted-foreground/40" />
								Set as default
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								onDelete();
								setOpen(false);
							}}
							className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-accent-red/80 hover:text-accent-red"
						>
							<Trash2 className="w-3.5 h-3.5" />
							Delete
						</button>
					</div>
				</>
			)}
		</div>
	);
}

// ─── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ workspace }: { workspace: Workspace }) {
	const configEntries = Object.entries(workspace.config);
	const agentSlugs =
		workspace.config["agents"]
			?.split(",")
			.map((s) => s.trim())
			.filter(Boolean) ?? [];

	return (
		<div className="border-t border-border/30 p-4 space-y-4">
			{/* Full config */}
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
					Configuration
				</p>
				{configEntries.length === 0 ? (
					<p className="text-xs text-muted-foreground/40">No configuration.</p>
				) : (
					<table className="w-full text-xs font-mono">
						<tbody>
							{configEntries.map(([k, v]) => (
								<tr
									key={k}
									className="border-t border-border/20 first:border-0"
								>
									<td className="py-1.5 pr-4 text-muted-foreground/60 w-40">
										{k}
									</td>
									<td className="py-1.5 text-foreground/80">{v}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* Resource stats */}
			<div>
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
					Resources
				</p>
				<div className="grid grid-cols-3 gap-3">
					{[
						{ icon: Cpu, label: "CPU" },
						{ icon: MemoryStick, label: "Memory" },
						{ icon: HardDrive, label: "Disk" },
					].map(({ icon: Icon, label }) => (
						<div
							key={label}
							className="glass rounded-md p-3 flex items-center gap-2"
						>
							<Icon className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
							<div>
								<p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">
									{label}
								</p>
								<p className="text-sm font-mono">—</p>
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Agents */}
			{agentSlugs.length > 0 && (
				<div>
					<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2">
						Agents using this environment
					</p>
					<div className="flex flex-wrap gap-2">
						{agentSlugs.map((slug) => (
							<span
								key={slug}
								className="text-xs font-mono px-2 py-0.5 rounded bg-setra-600/10 text-setra-400 border border-setra-600/20"
							>
								{slug}
							</span>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ─── Workspace Card ────────────────────────────────────────────────────────────

function WorkspaceCard({
	workspace,
	onEdit,
	onSetDefault,
	onDelete,
}: {
	workspace: Workspace;
	onEdit: () => void;
	onSetDefault: () => void;
	onDelete: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const typeCfg = TYPE_CONFIG[workspace.type];
	const statusCfg = STATUS_CONFIG[workspace.status];
	const configPreview = Object.entries(workspace.config).slice(0, 2);

	return (
		<div className="glass rounded-lg overflow-hidden">
			<div
				className="p-4 cursor-pointer hover:bg-white/5 transition-colors"
				onClick={() => setExpanded((v) => !v)}
			>
				<div className="flex items-start gap-3">
					<Server className="w-5 h-5 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-sm font-medium">{workspace.name}</span>
							<span
								className={cn(
									"text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
									typeCfg.cls,
								)}
							>
								{typeCfg.label}
							</span>
							{workspace.isDefault && (
								<span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-setra-600/40 text-setra-400 bg-setra-600/10">
									Default
								</span>
							)}
						</div>

						<div className="flex items-center gap-3 mt-1.5">
							<span className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
								<span
									className={cn("w-1.5 h-1.5 rounded-full", statusCfg.dot)}
								/>
								{statusCfg.label}
							</span>
							<span className="text-xs text-muted-foreground/40">
								{workspace.agentCount} agent
								{workspace.agentCount !== 1 ? "s" : ""}
							</span>
							{workspace.lastUsedAt != null && (
								<span className="text-xs text-muted-foreground/40">
									Used {timeAgo(workspace.lastUsedAt)}
								</span>
							)}
						</div>

						{configPreview.length > 0 && (
							<div className="mt-2 space-y-0.5">
								{configPreview.map(([k, v]) => (
									<p
										key={k}
										className="text-xs font-mono text-muted-foreground/40"
									>
										<span className="text-muted-foreground/60">{k}:</span> {v}
									</p>
								))}
							</div>
						)}
					</div>

					<div className="flex items-center gap-1 flex-shrink-0">
						<ActionMenu
							workspace={workspace}
							onEdit={onEdit}
							onSetDefault={onSetDefault}
							onDelete={onDelete}
						/>
						{expanded ? (
							<ChevronDown className="w-4 h-4 text-muted-foreground/40" />
						) : (
							<ChevronRight className="w-4 h-4 text-muted-foreground/40" />
						)}
					</div>
				</div>
			</div>

			{expanded && <DetailPanel workspace={workspace} />}
		</div>
	);
}

// ─── Add / Edit Modal ──────────────────────────────────────────────────────────

function WorkspaceModal({
	initial,
	onClose,
	onSaved,
}: {
	initial?: Workspace | undefined;
	onClose: () => void;
	onSaved: () => void;
}) {
	const isEdit = initial != null;
	const [form, setForm] = useState<AddFormData>(() => {
		if (initial == null) return defaultFormData();
		return {
			name: initial.name,
			type: initial.type,
			image: initial.config["image"] ?? "",
			volumes: initial.config["volumes"] ?? "",
			host: initial.config["host"] ?? "",
			port: initial.config["port"] ?? "22",
			username: initial.config["username"] ?? "",
			authType:
				(initial.config["authType"] as "key" | "password" | undefined) ?? "key",
			provider:
				(initial.config["provider"] as "aws" | "gcp" | "azure" | undefined) ??
				"aws",
			region: initial.config["region"] ?? "",
		};
	});

	const set = <K extends keyof AddFormData>(key: K, value: AddFormData[K]) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	function buildConfig(): Record<string, string> {
		const base: Record<string, string> = {};
		if (form.type === "docker") {
			if (form.image) base["image"] = form.image;
			if (form.volumes) base["volumes"] = form.volumes;
		} else if (form.type === "remote-ssh") {
			if (form.host) base["host"] = form.host;
			if (form.port) base["port"] = form.port;
			if (form.username) base["username"] = form.username;
			base["authType"] = form.authType;
		} else if (form.type === "cloud") {
			base["provider"] = form.provider;
			if (form.region) base["region"] = form.region;
		}
		return base;
	}

	const createMut = useMutation({
		mutationFn: () =>
			workspaces.create({
				name: form.name,
				type: form.type,
				isDefault: false,
				config: buildConfig(),
			}),
		onSuccess: () => {
			onSaved();
			onClose();
		},
	});

	const updateMut = useMutation({
		mutationFn: () =>
			workspaces.update(initial!.id, {
				name: form.name,
				type: form.type,
				config: buildConfig(),
			}),
		onSuccess: () => {
			onSaved();
			onClose();
		},
	});

	const isPending = createMut.isPending || updateMut.isPending;

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (isEdit) {
			updateMut.mutate();
		} else {
			createMut.mutate();
		}
	}

	const inputCls =
		"w-full bg-input border border-border rounded-md px-3 py-1.5 text-sm outline-none focus:border-setra-600 transition-colors";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
			<div className="glass rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
				<div className="flex items-center justify-between p-5 border-b border-border/30">
					<h2 className="text-base font-semibold">
						{isEdit ? "Edit environment" : "Add environment"}
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-muted-foreground/40 hover:text-foreground transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="p-5 space-y-4">
					{/* Name */}
					<div className="space-y-1">
						<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
							Name
						</label>
						<input
							type="text"
							required
							value={form.name}
							onChange={(e) => set("name", e.target.value)}
							placeholder="my-workspace"
							className={inputCls}
						/>
					</div>

					{/* Type */}
					<div className="space-y-1">
						<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
							Type
						</label>
						<select
							value={form.type}
							onChange={(e) => set("type", e.target.value as WorkspaceType)}
							className={inputCls}
						>
							<option value="local">Local</option>
							<option value="docker">Docker</option>
							<option value="remote-ssh">Remote SSH</option>
							<option value="cloud">Cloud Runner</option>
						</select>
					</div>

					{/* Docker */}
					{form.type === "docker" && (
						<>
							<div className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Image
								</label>
								<input
									type="text"
									value={form.image}
									onChange={(e) => set("image", e.target.value)}
									placeholder="ubuntu:24.04"
									className={inputCls}
								/>
							</div>
							<div className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Volumes (one per line)
								</label>
								<textarea
									value={form.volumes}
									onChange={(e) => set("volumes", e.target.value)}
									placeholder="/host/path:/container/path"
									rows={3}
									className={cn(inputCls, "font-mono resize-none")}
								/>
							</div>
						</>
					)}

					{/* Remote SSH */}
					{form.type === "remote-ssh" && (
						<>
							<div className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Host
								</label>
								<input
									type="text"
									value={form.host}
									onChange={(e) => set("host", e.target.value)}
									placeholder="192.168.1.100"
									className={inputCls}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1">
									<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Port
									</label>
									<input
										type="number"
										value={form.port}
										onChange={(e) => set("port", e.target.value)}
										className={inputCls}
									/>
								</div>
								<div className="space-y-1">
									<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Auth type
									</label>
									<select
										value={form.authType}
										onChange={(e) =>
											set("authType", e.target.value as "key" | "password")
										}
										className={inputCls}
									>
										<option value="key">SSH Key</option>
										<option value="password">Password</option>
									</select>
								</div>
							</div>
							<div className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Username
								</label>
								<input
									type="text"
									value={form.username}
									onChange={(e) => set("username", e.target.value)}
									placeholder="ubuntu"
									className={inputCls}
								/>
							</div>
						</>
					)}

					{/* Cloud */}
					{form.type === "cloud" && (
						<>
							<div className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Provider
								</label>
								<select
									value={form.provider}
									onChange={(e) =>
										set("provider", e.target.value as "aws" | "gcp" | "azure")
									}
									className={inputCls}
								>
									<option value="aws">AWS</option>
									<option value="gcp">GCP</option>
									<option value="azure">Azure</option>
								</select>
							</div>
							<div className="space-y-1">
								<label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
									Region
								</label>
								<input
									type="text"
									value={form.region}
									onChange={(e) => set("region", e.target.value)}
									placeholder="us-east-1"
									className={inputCls}
								/>
							</div>
						</>
					)}

					<div className="flex items-center justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isPending || !form.name.trim()}
							className="flex items-center gap-1.5 px-4 py-2 text-sm bg-setra-600 text-white rounded-md hover:bg-setra-500 transition-colors disabled:opacity-50"
						>
							{isPending ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<CheckCircle className="w-3.5 h-3.5" />
							)}
							{isEdit ? "Save changes" : "Create workspace"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function WorkspacesPage() {
	const qc = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);
	const [editTarget, setEditTarget] = useState<Workspace | undefined>(
		undefined,
	);

	const { data: wsList = [], isLoading } = useQuery({
		queryKey: ["workspaces"],
		queryFn: workspaces.list,
	});

	const deleteMut = useMutation({
		mutationFn: (id: string) => workspaces.delete(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["workspaces"] }),
	});

	const defaultMut = useMutation({
		mutationFn: (id: string) => workspaces.setDefault(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["workspaces"] }),
	});

	function openAdd() {
		setEditTarget(undefined);
		setModalOpen(true);
	}

	function openEdit(ws: Workspace) {
		setEditTarget(ws);
		setModalOpen(true);
	}

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6">
			<PageHeader
				title="Environments"
				subtitle="Isolated execution environments for your agents."
				actions={
					<div className="flex items-center gap-2">
						<Badge variant="info">{wsList.length} configured</Badge>
						<Button
							type="button"
							onClick={openAdd}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							Add environment
						</Button>
					</div>
				}
			/>

			{/* List */}
			{isLoading ? (
				<div className="space-y-4">
					<Skeleton variant="rect" height="132px" />
					<Skeleton variant="rect" height="132px" />
				</div>
			) : wsList.length === 0 ? (
				<EmptyState
					icon={<Server className="h-10 w-10" aria-hidden="true" />}
					title="No environments configured"
					description="Create your first environment to give agents an isolated execution context."
					action={
						<Button
							type="button"
							onClick={openAdd}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							Create your first environment
						</Button>
					}
				/>
			) : (
				<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
					{wsList.map((ws) => (
						<WorkspaceCard
							key={ws.id}
							workspace={ws}
							onEdit={() => openEdit(ws)}
							onSetDefault={() => defaultMut.mutate(ws.id)}
							onDelete={() => deleteMut.mutate(ws.id)}
						/>
					))}
				</div>
			)}

			{/* Modal */}
			{modalOpen && (
				<WorkspaceModal
					initial={editTarget}
					onClose={() => setModalOpen(false)}
					onSaved={() =>
						void qc.invalidateQueries({ queryKey: ["workspaces"] })
					}
				/>
			)}
		</div>
	);
}
