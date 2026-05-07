import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useCompany } from "../context/CompanyContext";
import {
	type CompanyMember,
	type RosterEntry,
	api,
	companySettings,
} from "../lib/api";
import { cn } from "../lib/utils";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function nameHash(name: string): number {
	let h = 0;
	for (let i = 0; i < name.length; i++) {
		h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

const AVATAR_COLORS = [
	"bg-setra-600",
	"bg-accent-purple",
	"bg-accent-green",
	"bg-blue-500",
	"bg-accent-orange",
	"bg-yellow-500",
] as const;

function avatarBg(name: string): string {
	return AVATAR_COLORS[nameHash(name) % AVATAR_COLORS.length] ?? "bg-setra-600";
}

function initials(name: string): string {
	return name
		.split(" ")
		.slice(0, 2)
		.map((p) => p[0]?.toUpperCase() ?? "")
		.join("");
}

const ROLE_BADGE: Record<CompanyMember["role"], string> = {
	owner: "bg-accent-purple/15 text-accent-purple border-accent-purple/20",
	admin: "bg-blue-500/15 text-blue-400 border-blue-500/20",
	member: "bg-muted text-muted-foreground border-border/30",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

function MemberCard({
	member,
	onChangeRole,
	onRemove,
}: {
	member: CompanyMember;
	onChangeRole: (id: string, role: string) => void;
	onRemove: (id: string) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div className="glass rounded-lg p-4 relative group">
			<div className="absolute top-3 right-3">
				<button
					className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted/50 transition-opacity"
					onClick={() => setMenuOpen((v) => !v)}
				>
					<MoreHorizontal className="w-4 h-4 text-muted-foreground" />
				</button>
				{menuOpen && (
					<div className="absolute right-0 top-7 z-10 bg-ground-900 border border-border/50 rounded-md shadow-lg min-w-[140px] py-1">
						<button
							className="w-full px-3 py-1.5 text-sm text-left text-foreground hover:bg-muted/50"
							onClick={() => {
								onChangeRole(
									member.id,
									member.role === "admin" ? "member" : "admin",
								);
								setMenuOpen(false);
							}}
						>
							Change role
						</button>
						<button
							className="w-full px-3 py-1.5 text-sm text-left text-red-400 hover:bg-muted/50"
							onClick={() => {
								onRemove(member.id);
								setMenuOpen(false);
							}}
						>
							Remove
						</button>
					</div>
				)}
			</div>

			<div
				className={cn(
					"w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white mb-3",
					avatarBg(member.name),
				)}
			>
				{initials(member.name)}
			</div>

			<p className="text-sm font-medium text-foreground truncate">
				{member.name}
			</p>
			<p className="text-xs text-muted-foreground truncate mb-2">
				{member.email}
			</p>

			<span
				className={cn(
					"inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
					ROLE_BADGE[member.role],
				)}
			>
				{member.role}
			</span>

			<p className="text-[10px] text-muted-foreground/50 mt-2">
				Joined {new Date(member.joinedAt).toLocaleDateString()}
			</p>
		</div>
	);
}

function AgentCard({ agent }: { agent: RosterEntry }) {
	const statusLabel =
		agent.is_active === 0
			? "Inactive"
			: agent.runtime_status === "running"
				? "Running"
				: agent.runtime_status === "paused"
					? "Paused"
					: agent.runtime_status === "awaiting_key"
						? "Awaiting API key"
						: "Idle (ready)";
	const statusDot =
		agent.is_active === 0
			? "bg-muted-foreground/40"
			: agent.runtime_status === "running"
				? "bg-accent-green"
				: agent.runtime_status === "paused"
					? "bg-accent-red"
					: agent.runtime_status === "awaiting_key"
						? "bg-accent-yellow"
						: "bg-blue-400";

	return (
		<Link
			to={`/agents/${agent.agent_id ?? agent.id}`}
			className="glass rounded-lg p-4 block hover:border-setra-600/30 transition-colors"
		>
			<div
				className={cn(
					"w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white mb-3",
					avatarBg(agent.display_name ?? agent.agent ?? "?"),
				)}
			>
				{initials(agent.display_name)}
			</div>

			<p className="text-sm font-semibold text-foreground truncate">
				{agent.display_name}
			</p>

			{agent.model !== null && agent.model !== undefined && (
				<p className="font-mono text-xs text-muted-foreground truncate mt-0.5">
					{agent.model}
				</p>
			)}

			<div className="flex items-center gap-1.5 mt-2">
				<span className={cn("w-1.5 h-1.5 rounded-full", statusDot)} />
				<span className="text-[10px] text-muted-foreground">{statusLabel}</span>
			</div>

			<p className="text-[10px] text-muted-foreground/50 mt-1">
				Hired {new Date(agent.hired_at).toLocaleDateString()}
			</p>
		</Link>
	);
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function OrgMembersTab() {
	const qc = useQueryClient();
	const { selectedCompanyId } = useCompany();

	const { data: members = [], isLoading: membersLoading } = useQuery({
		queryKey: ["company-members"],
		queryFn: () => companySettings.members.list(),
	});

	const { data: roster = [], isLoading: rosterLoading } = useQuery({
		queryKey: ["agents-roster", selectedCompanyId ?? "all"],
		queryFn: () => api.agents.roster.list(selectedCompanyId ?? undefined),
	});

	const removeMember = useMutation({
		mutationFn: (id: string) => companySettings.members.remove(id),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["company-members"] }),
	});

	const changeRole = useMutation({
		mutationFn: ({ id, role }: { id: string; role: string }) =>
			companySettings.members.updateRole(id, role),
		onSuccess: () =>
			void qc.invalidateQueries({ queryKey: ["company-members"] }),
	});

	return (
		<div className="flex-1 overflow-y-auto p-6 space-y-8">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold text-foreground">Team</h1>
					<p className="text-sm text-muted-foreground mt-0.5">
						Manage human collaborators and AI agents
					</p>
				</div>
				<Link
					to="/settings/company?tab=members"
					className="flex items-center gap-2 px-3 py-1.5 bg-setra-600 hover:bg-setra-500 text-white rounded-md text-sm font-medium transition-colors"
				>
					<UserPlus className="w-4 h-4" />
					Invite member
				</Link>
			</div>

			{/* Humans section */}
			<section>
				<div className="flex items-center gap-2 mb-3">
					<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
						Humans
					</span>
					<span className="text-xs text-muted-foreground/40">
						{members.length}
					</span>
				</div>

				{membersLoading ? (
					<div className="text-sm text-muted-foreground/60">Loading…</div>
				) : members.length === 0 ? (
					<div className="glass rounded-lg p-8 text-center text-sm text-muted-foreground">
						No team members yet — invite your first collaborator
					</div>
				) : (
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
						{members.map((member) => (
							<MemberCard
								key={member.id}
								member={member}
								onChangeRole={(id, role) => changeRole.mutate({ id, role })}
								onRemove={(id) => removeMember.mutate(id)}
							/>
						))}
					</div>
				)}
			</section>

			{/* Agents section */}
			<section>
				<div className="flex items-center gap-2 mb-3">
					<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
						Agents
					</span>
					<span className="text-xs text-muted-foreground/40">
						{roster.length}
					</span>
				</div>

				{rosterLoading ? (
					<div className="text-sm text-muted-foreground/60">Loading…</div>
				) : roster.length === 0 ? (
					<div className="glass rounded-lg p-8 text-center text-sm text-muted-foreground">
						No agents configured —{" "}
						<Link to="/agents" className="text-setra-300 hover:underline">
							create your first agent
						</Link>
					</div>
				) : (
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
						{roster.map((agent) => (
							<AgentCard key={agent.id} agent={agent} />
						))}
					</div>
				)}
			</section>
		</div>
	);
}
