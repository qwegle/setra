import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Building2,
	ChevronDown,
	Database,
	Download,
	Edit2,
	Eye,
	EyeOff,
	Globe,
	Loader2,
	Mail,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Save,
	Shield,
	Trash2,
	Upload,
	Users,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, PageHeader } from "../components/ui";
import { useCompany } from "../context/CompanyContext";
import { type CompanyMember, api, companySettings } from "../lib/api";
import { cn } from "../lib/utils";

// ─── Tab type ──────────────────────────────────────────────────────────────────

type Tab =
	| "general"
	| "members"
	| "invites"
	| "environment"
	| "skills"
	| "importexport"
	| "danger";

const TABS: { id: Tab; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "members", label: "Members" },
	{ id: "invites", label: "Invites" },
	{ id: "environment", label: "Environment" },
	{ id: "skills", label: "Skills" },
	{ id: "importexport", label: "Import/Export" },
	{ id: "danger", label: "Danger" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
	return name
		.split(" ")
		.slice(0, 2)
		.map((w) => w[0] ?? "")
		.join("")
		.toUpperCase();
}

function useToast() {
	const [message, setMessage] = useState<string | null>(null);
	function toast(msg: string) {
		setMessage(msg);
		setTimeout(() => setMessage(null), 3500);
	}
	return { message, toast };
}

// ─── Role badge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: CompanyMember["role"] | string }) {
	const cfg: Record<string, string> = {
		owner: "bg-accent-purple/10 text-accent-purple border-accent-purple/30",
		admin: "bg-blue-500/10 text-blue-400 border-blue-500/30",
		member: "bg-muted text-muted-foreground border-border/30",
	};
	return (
		<span
			className={cn(
				"text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
				cfg[role] ?? "bg-muted text-muted-foreground border-border/30",
			)}
		>
			{role}
		</span>
	);
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({
	checked,
	onChange,
}: { checked: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative w-9 h-5 rounded-full transition-colors focus:outline-none",
				checked ? "bg-setra-600" : "bg-muted",
			)}
		>
			<span
				className={cn(
					"absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform",
					checked && "translate-x-4",
				)}
			/>
		</button>
	);
}

// ─── General Tab ───────────────────────────────────────────────────────────────

function GeneralTab({ toast }: { toast: (msg: string) => void }) {
	const qc = useQueryClient();
	const { data: settings, isLoading } = useQuery({
		queryKey: ["company-settings"],
		queryFn: companySettings.get,
	});

	const [name, setName] = useState("");
	const [goal, setGoal] = useState("");
	const [prefix, setPrefix] = useState("");
	const [timezone, setTimezone] = useState("");
	const [brandColor, setBrandColor] = useState("#4f7eff");
	const [offlineOnly, setOfflineOnly] = useState(false);
	const [saving, setSaving] = useState(false);
	const [initialized, setInitialized] = useState(false);

	if (settings && !initialized) {
		setName(settings.name);
		setGoal(settings.goal ?? "");
		setPrefix(settings.issuePrefix);
		setTimezone(settings.timezone);
		setBrandColor(settings.brandColor ?? "#4f7eff");
		setOfflineOnly(settings.isOfflineOnly);
		setInitialized(true);
	}

	const saveMutation = useMutation({
		mutationFn: () =>
			companySettings.update({
				name,
				goal: goal || null,
				issuePrefix: prefix,
				timezone,
				brandColor,
				isOfflineOnly: offlineOnly,
			}),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["company-settings"] });
			toast("Settings saved.");
		},
		onError: () => toast("Failed to save."),
	});

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
				<Loader2 className="w-4 h-4 animate-spin" /> Loading…
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="glass rounded-lg p-4 space-y-4">
				{/* Company name */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-start">
					<div>
						<p className="text-xs font-medium text-foreground/80">
							Company name
						</p>
					</div>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50 w-full"
					/>
				</div>

				{/* Goal */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-start">
					<div>
						<p className="text-xs font-medium text-foreground/80">
							Goal / description
						</p>
						<p className="text-xs text-muted-foreground/60 mt-0.5">
							Shared with all agents
						</p>
					</div>
					<textarea
						value={goal}
						onChange={(e) => setGoal(e.target.value)}
						rows={3}
						className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50 w-full resize-none"
					/>
				</div>

				{/* Issue prefix */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-center">
					<p className="text-xs font-medium text-foreground/80">Issue prefix</p>
					<input
						value={prefix}
						onChange={(e) => setPrefix(e.target.value)}
						placeholder="e.g. TSK"
						className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50 w-40 font-mono"
					/>
				</div>

				{/* Timezone */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-center">
					<p className="text-xs font-medium text-foreground/80">Timezone</p>
					<input
						value={timezone}
						onChange={(e) => setTimezone(e.target.value)}
						placeholder="e.g. America/New_York"
						className="bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50 w-56"
					/>
				</div>

				{/* Read-only badges */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-center">
					<p className="text-xs font-medium text-foreground/80">Company type</p>
					<span className="text-xs px-2 py-0.5 rounded bg-muted border border-border/30 text-muted-foreground w-fit capitalize">
						{settings?.type ?? "—"}
					</span>
				</div>
				<div className="grid grid-cols-[180px_1fr] gap-4 items-center">
					<p className="text-xs font-medium text-foreground/80">Company size</p>
					<span className="text-xs px-2 py-0.5 rounded bg-muted border border-border/30 text-muted-foreground w-fit">
						{settings?.size ?? "—"}
					</span>
				</div>

				{/* Brand color */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-center">
					<p className="text-xs font-medium text-foreground/80">Brand color</p>
					<div className="flex items-center gap-3">
						<div
							className="w-8 h-8 rounded-md border border-border/40"
							style={{ backgroundColor: brandColor }}
						/>
						<input
							type="color"
							value={brandColor}
							onChange={(e) => setBrandColor(e.target.value)}
							className="w-10 h-8 cursor-pointer rounded border border-border/40 bg-transparent"
						/>
						<span className="font-mono text-xs text-muted-foreground">
							{brandColor}
						</span>
					</div>
				</div>

				{/* Offline-only toggle */}
				<div className="grid grid-cols-[180px_1fr] gap-4 items-center">
					<div>
						<p className="text-xs font-medium text-foreground/80">
							Offline-only
						</p>
						<p className="text-xs text-muted-foreground/60 mt-0.5">
							Disable all external calls
						</p>
					</div>
					<Toggle checked={offlineOnly} onChange={setOfflineOnly} />
				</div>
			</div>

			<div className="flex justify-end">
				<button
					disabled={saving || saveMutation.isPending}
					onClick={() => saveMutation.mutate()}
					className="flex items-center gap-2 px-4 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
				>
					{saveMutation.isPending ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Save className="w-4 h-4" />
					)}
					Save
				</button>
			</div>
		</div>
	);
}

// ─── Members Tab ───────────────────────────────────────────────────────────────

function MembersTab({ toast }: { toast: (msg: string) => void }) {
	const qc = useQueryClient();
	const [showInviteModal, setShowInviteModal] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
	const [openMenuId, setOpenMenuId] = useState<string | null>(null);

	const { data: members = [], isLoading } = useQuery({
		queryKey: ["company-members"],
		queryFn: companySettings.members.list,
	});

	const removeM = useMutation({
		mutationFn: (id: string) => companySettings.members.remove(id),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["company-members"] });
			toast("Member removed.");
		},
	});

	const roleM = useMutation({
		mutationFn: ({ id, role }: { id: string; role: string }) =>
			companySettings.members.updateRole(id, role),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["company-members"] }),
	});

	const inviteM = useMutation({
		mutationFn: () => companySettings.invites.create(inviteEmail, inviteRole),
		onSuccess: () => {
			setShowInviteModal(false);
			setInviteEmail("");
			toast("Invite sent.");
		},
		onError: () => toast("Failed to send invite."),
	});

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
				<p className="text-xs text-zinc-400">
					<strong className="text-zinc-300">Prerequisites:</strong>{" "}
					To send email invites, add a Resend API key in Settings → AI Providers. Without it, invites are created but emails won't be sent — members can still register with the invited email to auto-join.
				</p>
			</div>
			<div className="flex justify-end">
				<button
					className="flex items-center gap-1.5 px-3 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-white text-sm font-medium transition-colors"
					onClick={() => setShowInviteModal(true)}
				>
					<Plus className="w-4 h-4" /> Invite member
				</button>
			</div>

			{/* Invite modal */}
			{showInviteModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="glass rounded-xl p-6 w-full max-w-sm space-y-4 shadow-xl">
						<div className="flex items-center justify-between">
							<p className="font-semibold text-sm">Invite member</p>
							<button
								onClick={() => setShowInviteModal(false)}
								className="text-muted-foreground/50 hover:text-foreground"
							>
								<X className="w-4 h-4" />
							</button>
						</div>
						<input
							type="email"
							value={inviteEmail}
							onChange={(e) => setInviteEmail(e.target.value)}
							placeholder="Email address"
							className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
						<select
							value={inviteRole}
							onChange={(e) =>
								setInviteRole(e.target.value as "admin" | "member")
							}
							className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						>
							<option value="member">Member</option>
							<option value="admin">Admin</option>
						</select>
						<div className="flex justify-end gap-2">
							<button
								onClick={() => setShowInviteModal(false)}
								className="px-3 py-2 rounded bg-muted hover:bg-muted/70 text-sm transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={() => inviteM.mutate()}
								disabled={!inviteEmail || inviteM.isPending}
								className="flex items-center gap-1.5 px-3 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
							>
								{inviteM.isPending ? (
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
								) : (
									<Mail className="w-3.5 h-3.5" />
								)}
								Send invite
							</button>
						</div>
					</div>
				</div>
			)}

			{isLoading ? (
				<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
					<Loader2 className="w-4 h-4 animate-spin" /> Loading…
				</div>
			) : (
				<div className="glass rounded-lg overflow-hidden">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border/20 text-muted-foreground/60">
								<th className="text-left px-4 py-2.5 text-xs font-medium">
									Member
								</th>
								<th className="text-left px-4 py-2.5 text-xs font-medium">
									Email
								</th>
								<th className="text-left px-4 py-2.5 text-xs font-medium">
									Role
								</th>
								<th className="text-left px-4 py-2.5 text-xs font-medium">
									Joined
								</th>
								<th className="px-4 py-2.5 w-10" />
							</tr>
						</thead>
						<tbody>
							{members.map((m) => (
								<tr
									key={m.id}
									className="border-b border-border/10 last:border-0 hover:bg-muted/20"
								>
									<td className="px-4 py-3">
										<div className="flex items-center gap-2.5">
											<div className="w-7 h-7 rounded-full bg-setra-600/30 flex items-center justify-center text-[10px] font-bold text-setra-300 shrink-0">
												{initials(m.name)}
											</div>
											<span className="text-sm">{m.name}</span>
										</div>
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground/70">
										{m.email}
									</td>
									<td className="px-4 py-3">
										<RoleBadge role={m.role} />
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground/60">
										{new Date(m.joinedAt).toLocaleDateString()}
									</td>
									<td className="px-4 py-3 relative">
										<button
											className="p-1 rounded hover:bg-muted/60 text-muted-foreground/50"
											onClick={() =>
												setOpenMenuId(openMenuId === m.id ? null : m.id)
											}
										>
											<MoreHorizontal className="w-4 h-4" />
										</button>
										{openMenuId === m.id && (
											<div className="absolute right-0 top-8 z-10 w-40 glass rounded-lg border border-border/30 shadow-lg overflow-hidden">
												{(["member", "admin"] as const).map((r) => (
													<button
														key={r}
														className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 transition-colors"
														onClick={() => {
															roleM.mutate({ id: m.id, role: r });
															setOpenMenuId(null);
														}}
													>
														Make {r}
													</button>
												))}
												<button
													className="w-full text-left px-3 py-2 text-xs text-accent-red hover:bg-accent-red/10 transition-colors"
													onClick={() => {
														removeM.mutate(m.id);
														setOpenMenuId(null);
													}}
												>
													Remove
												</button>
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

// ─── Invites Tab ───────────────────────────────────────────────────────────────

function InvitesTab({ toast }: { toast: (msg: string) => void }) {
	const qc = useQueryClient();

	const { data: invites = [], isLoading } = useQuery({
		queryKey: ["company-invites"],
		queryFn: companySettings.invites.list,
	});

	const revokeMutation = useMutation({
		mutationFn: (id: string) => companySettings.invites.revoke(id),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["company-invites"] });
			toast("Invite revoked.");
		},
	});

	const resendMutation = useMutation({
		mutationFn: (id: string) => companySettings.invites.resend(id),
		onSuccess: () => toast("Invite resent."),
	});

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
				<Loader2 className="w-4 h-4 animate-spin" /> Loading…
			</div>
		);
	}

	if (invites.length === 0) {
		return (
			<div className="glass rounded-lg p-8 text-center text-muted-foreground/60 text-sm">
				<Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
				No pending invites
			</div>
		);
	}

	return (
		<div className="glass rounded-lg overflow-hidden">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border/20 text-muted-foreground/60">
						<th className="text-left px-4 py-2.5 text-xs font-medium">Email</th>
						<th className="text-left px-4 py-2.5 text-xs font-medium">Role</th>
						<th className="text-left px-4 py-2.5 text-xs font-medium">Sent</th>
						<th className="text-left px-4 py-2.5 text-xs font-medium">
							Expires
						</th>
						<th className="px-4 py-2.5 w-32" />
					</tr>
				</thead>
				<tbody>
					{invites.map((inv) => (
						<tr
							key={inv.id}
							className="border-b border-border/10 last:border-0 hover:bg-muted/20"
						>
							<td className="px-4 py-3 text-sm">{inv.email}</td>
							<td className="px-4 py-3">
								<RoleBadge role={inv.role} />
							</td>
							<td className="px-4 py-3 text-xs text-muted-foreground/60">
								{new Date(inv.sentAt).toLocaleDateString()}
							</td>
							<td className="px-4 py-3 text-xs text-muted-foreground/60">
								{new Date(inv.expiresAt).toLocaleDateString()}
							</td>
							<td className="px-4 py-3">
								<div className="flex items-center gap-1.5 justify-end">
									<button
										className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/70 border border-border/30 transition-colors flex items-center gap-1"
										onClick={() => resendMutation.mutate(inv.id)}
									>
										<RefreshCw className="w-3 h-3" /> Resend
									</button>
									<button
										className="text-xs px-2 py-1 rounded bg-accent-red/10 text-accent-red hover:bg-accent-red/20 border border-accent-red/20 transition-colors flex items-center gap-1"
										onClick={() => revokeMutation.mutate(inv.id)}
									>
										<X className="w-3 h-3" /> Revoke
									</button>
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// ─── Environment Tab ───────────────────────────────────────────────────────────

interface EnvRow {
	key: string;
	value: string;
	show: boolean;
}

function EnvironmentTab({ toast }: { toast: (msg: string) => void }) {
	const [rows, setRows] = useState<EnvRow[]>([
		{ key: "", value: "", show: false },
	]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let alive = true;
		companySettings
			.get()
			.then((s) => {
				if (!alive) return;
				const ev = s.envVars ?? {};
				const entries = Object.entries(ev);
				setRows(
					entries.length > 0
						? entries.map(([k, v]) => ({
								key: k,
								value: String(v ?? ""),
								show: false,
							}))
						: [{ key: "", value: "", show: false }],
				);
			})
			.catch(() => {
				/* leave default empty row */
			});
		return () => {
			alive = false;
		};
	}, []);

	function addRow() {
		setRows((prev) => [...prev, { key: "", value: "", show: false }]);
	}

	function updateRow(i: number, patch: Partial<EnvRow>) {
		setRows((prev) =>
			prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
		);
	}

	function removeRow(i: number) {
		setRows((prev) => prev.filter((_, idx) => idx !== i));
	}

	async function handleSave() {
		setSaving(true);
		try {
			const env_vars = rows
				.filter((r) => r.key.trim())
				.reduce<Record<string, string>>((acc, r) => {
					acc[r.key.trim()] = r.value;
					return acc;
				}, {});
			await companySettings.update({ env_vars });
			toast("Environment variables saved.");
		} catch (err) {
			toast(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-4">
			<div className="glass rounded-lg p-4 flex items-start gap-3 border border-setra-600/20">
				<Database className="w-4 h-4 text-setra-400 shrink-0 mt-0.5" />
				<p className="text-xs text-muted-foreground/70">
					These variables are available to all agents in this company as
					environment variables.
				</p>
			</div>

			<div className="glass rounded-lg divide-y divide-border/20">
				{rows.map((row, i) => (
					<div key={i} className="flex items-center gap-2 p-3">
						<input
							value={row.key}
							onChange={(e) => updateRow(i, { key: e.target.value })}
							placeholder="KEY"
							className="w-48 font-mono bg-muted/40 border border-border/40 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-setra-600/50"
						/>
						<div className="relative flex-1">
							<input
								type={row.show ? "text" : "password"}
								value={row.value}
								onChange={(e) => updateRow(i, { value: e.target.value })}
								placeholder="value"
								className="w-full bg-muted/40 border border-border/40 rounded px-3 py-1.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-setra-600/50"
							/>
							<button
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
								onClick={() => updateRow(i, { show: !row.show })}
								type="button"
							>
								{row.show ? (
									<EyeOff className="w-3.5 h-3.5" />
								) : (
									<Eye className="w-3.5 h-3.5" />
								)}
							</button>
						</div>
						<button
							className="p-1.5 rounded hover:bg-accent-red/10 text-muted-foreground/50 hover:text-accent-red transition-colors"
							onClick={() => removeRow(i)}
						>
							<Trash2 className="w-3.5 h-3.5" />
						</button>
					</div>
				))}
			</div>

			<div className="flex items-center justify-between">
				<button
					className="flex items-center gap-1.5 text-xs text-setra-300 hover:text-setra-200"
					onClick={addRow}
				>
					<Plus className="w-3.5 h-3.5" /> Add variable
				</button>
				<button
					disabled={saving}
					onClick={() => void handleSave()}
					className="flex items-center gap-2 px-4 py-2 rounded bg-setra-600 hover:bg-setra-600/80 text-white text-sm font-medium transition-colors disabled:opacity-50"
				>
					{saving ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Save className="w-4 h-4" />
					)}
					Save
				</button>
			</div>
		</div>
	);
}

// ─── Skills Tab ────────────────────────────────────────────────────────────────

function SkillsTab({ toast }: { toast: (msg: string) => void }) {
	const qc = useQueryClient();

	const { data: skillsPage, isLoading } = useQuery({
		queryKey: ["skills"],
		queryFn: () => api.skills.list({ page: 1, pageSize: 200 }),
	});
	const skills = skillsPage?.items ?? [];

	const toggleMutation = useMutation({
		mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
			api.skills.toggle(id, isActive),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["skills"] }),
		onError: () => toast("Failed to toggle skill."),
	});

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 text-muted-foreground/60 text-sm">
				<Loader2 className="w-4 h-4 animate-spin" /> Loading…
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="glass rounded-lg divide-y divide-border/20">
				{skills.length === 0 ? (
					<p className="text-center py-8 text-muted-foreground/40 text-sm">
						No skills configured
					</p>
				) : (
					skills.map((skill) => (
						<div key={skill.id} className="flex items-center gap-3 p-4">
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium">{skill.name}</p>
								<p className="text-xs text-muted-foreground/60 mt-0.5 truncate">
									{skill.description}
								</p>
							</div>
							<span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-muted text-muted-foreground border-border/30">
								{skill.category}
							</span>
							<Toggle
								checked={skill.isActive}
								onChange={(v) =>
									toggleMutation.mutate({ id: skill.id, isActive: v })
								}
							/>
						</div>
					))
				)}
			</div>
			<div>
				<a
					href="/skills"
					className="text-xs text-setra-300 hover:text-setra-200 underline underline-offset-2"
				>
					Manage skills
				</a>
			</div>
		</div>
	);
}

// ─── Import/Export Tab ─────────────────────────────────────────────────────────

function ImportExportTab({ toast }: { toast: (msg: string) => void }) {
	return (
		<div className="space-y-4">
			<div className="glass rounded-lg p-4 space-y-3">
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">
					Export
				</p>
				<button
					className="flex items-center gap-2 px-3 py-2 rounded bg-muted hover:bg-muted/70 border border-border/40 text-sm transition-colors w-full justify-start"
					onClick={() => toast("Export started")}
				>
					<Download className="w-4 h-4" /> Export company config (JSON)
				</button>
				<button
					className="flex items-center gap-2 px-3 py-2 rounded bg-muted hover:bg-muted/70 border border-border/40 text-sm transition-colors w-full justify-start"
					onClick={() => toast("Export started")}
				>
					<Download className="w-4 h-4" /> Export all issues as CSV
				</button>
			</div>

			<div className="glass rounded-lg p-4 space-y-3">
				<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">
					Import
				</p>
				<label className="flex items-center gap-2 px-3 py-2 rounded bg-muted hover:bg-muted/70 border border-border/40 text-sm transition-colors w-full justify-start cursor-pointer">
					<Upload className="w-4 h-4" /> Import from JSON
					<input
						type="file"
						accept=".json"
						className="hidden"
						onChange={() => toast("Import started")}
					/>
				</label>
			</div>
		</div>
	);
}

// ─── Danger Tab ────────────────────────────────────────────────────────────────

function DangerTab({ toast }: { toast: (msg: string) => void }) {
	const qc = useQueryClient();
	const {
		selectedCompanyId,
		selectedCompany,
		setSelectedCompanyId,
		removeCompany,
		companies,
	} = useCompany();
	const [showDeleteModal, setShowDeleteModal] = useState(false);
	const [confirmName, setConfirmName] = useState("");

	const { data: settings } = useQuery({
		queryKey: ["company-settings"],
		queryFn: companySettings.get,
	});

	const companyName = selectedCompany?.name ?? settings?.name ?? "this company";

	const deleteCompany = useMutation({
		mutationFn: () => {
			if (!selectedCompanyId) throw new Error("No company selected");
			return api.companies.delete(selectedCompanyId);
		},
		onSuccess: () => {
			toast(`"${companyName}" deleted.`);
			setShowDeleteModal(false);
			setConfirmName("");
			const deletedId = selectedCompanyId!;
			// Switch to another company if available, else clear
			const next = companies.find((c) => c.id !== deletedId);
			setSelectedCompanyId(next?.id ?? null);
			removeCompany(deletedId);
			void qc.invalidateQueries();
		},
		onError: (err: Error) => toast(err.message || "Delete failed"),
	});

	return (
		<div className="space-y-4">
			<div className="glass rounded-lg p-4 border border-accent-red/30 space-y-4">
				<p className="text-[10px] font-semibold uppercase tracking-wider text-accent-red/70 mb-1">
					Danger Zone
				</p>

				{/* Delete */}
				<div className="flex items-center justify-between gap-4 py-2 border-b border-border/20">
					<div>
						<p className="text-sm font-medium">Delete Company</p>
						<p className="text-xs text-muted-foreground/60 mt-0.5">
							Permanently delete this company and all associated data.
						</p>
					</div>
					<button
						className="px-3 py-2 rounded bg-accent-red/10 text-accent-red hover:bg-accent-red/20 border border-accent-red/30 text-sm font-medium transition-colors whitespace-nowrap"
						onClick={() => setShowDeleteModal(true)}
					>
						Delete Company
					</button>
				</div>

				{/* Transfer ownership */}
				<div className="flex items-center justify-between gap-4 py-2">
					<div>
						<p className="text-sm font-medium">Transfer ownership</p>
						<p className="text-xs text-muted-foreground/60 mt-0.5">
							Transfer this company to another owner.
						</p>
					</div>
					<div title="Contact support to transfer ownership">
						<button
							disabled
							className="px-3 py-2 rounded bg-muted text-muted-foreground/40 border border-border/30 text-sm font-medium cursor-not-allowed"
						>
							Transfer
						</button>
					</div>
				</div>
			</div>

			{/* Delete confirmation modal */}
			{showDeleteModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
					<div className="glass rounded-xl p-6 w-full max-w-sm shadow-xl space-y-4 border border-accent-red/30">
						<div className="flex items-start gap-3">
							<AlertTriangle className="w-5 h-5 text-accent-red shrink-0 mt-0.5" />
							<div>
								<p className="font-semibold text-sm">
									Delete &ldquo;{companyName}&rdquo;
								</p>
								<p className="text-xs text-muted-foreground/70 mt-1">
									This action cannot be undone. Type the company name to
									confirm.
								</p>
							</div>
						</div>
						<input
							value={confirmName}
							onChange={(e) => setConfirmName(e.target.value)}
							placeholder={companyName}
							className="w-full bg-muted/40 border border-border/40 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent-red/50"
						/>
						<div className="flex justify-end gap-2">
							<button
								onClick={() => {
									setShowDeleteModal(false);
									setConfirmName("");
								}}
								className="px-3 py-2 rounded bg-muted hover:bg-muted/70 text-sm transition-colors"
							>
								Cancel
							</button>
							<button
								disabled={
									confirmName !== companyName ||
									deleteCompany.isPending ||
									!selectedCompanyId
								}
								onClick={() => deleteCompany.mutate()}
								className="px-3 py-2 rounded bg-accent-red text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-red/80"
							>
								{deleteCompany.isPending ? "Deleting…" : "Delete permanently"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function CompanySettingsPage() {
	const [tab, setTab] = useState<Tab>("general");
	const { message, toast } = useToast();

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<PageHeader
				title="Company Settings"
				subtitle="Manage company profile, members, environment, and data controls."
				actions={<Badge variant="info">{tab}</Badge>}
			/>

			{/* Toast */}
			{message && (
				<div className="glass rounded-lg px-4 py-2 text-sm border border-setra-600/30 text-setra-300">
					{message}
				</div>
			)}

			{/* Tabs */}
			<div className="flex gap-1 border-b border-border/30 flex-wrap">
				{TABS.map((t) => (
					<button
						key={t.id}
						onClick={() => setTab(t.id)}
						className={cn(
							"px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
							tab === t.id
								? "text-foreground border-setra-600"
								: "text-muted-foreground border-transparent hover:text-foreground/70",
							t.id === "danger" &&
								tab !== "danger" &&
								"text-accent-red/60 hover:text-accent-red",
							t.id === "danger" &&
								tab === "danger" &&
								"text-accent-red border-accent-red",
						)}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* Content */}
			{tab === "general" && <GeneralTab toast={toast} />}
			{tab === "members" && <MembersTab toast={toast} />}
			{tab === "invites" && <InvitesTab toast={toast} />}
			{tab === "environment" && <EnvironmentTab toast={toast} />}
			{tab === "skills" && <SkillsTab toast={toast} />}
			{tab === "importexport" && <ImportExportTab toast={toast} />}
			{tab === "danger" && <DangerTab toast={toast} />}
		</div>
	);
}
