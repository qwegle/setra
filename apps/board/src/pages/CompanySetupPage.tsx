/**
 * Post-registration company setup.
 *
 * Four ways in:
 *   - Create — start a new company; you become its owner.
 *   - LAN — pick a peer instance discovered via mDNS on the same network.
 *   - Internet — search the Supabase directory for public companies.
 *   - Code — paste an invite code an admin shared with you.
 *
 * On success the page calls auth.refreshSession(token) with the new JWT
 * (which now carries the active companyId), then routes to /overview.
 */

import { ArrowLeft, Building2, KeyRound, PlusCircle, Wifi } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CompanyReels } from "../components/CompanyReels";
import { Button, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { request } from "../lib/api";
import {
	type CloudCompany,
	searchCloudCompanies,
	supabaseEnabled,
} from "../lib/supabase";

type Tab = "create" | "lan" | "cloud" | "code";

interface LanPeer {
	instanceId: string;
	companyId: string;
	companyName: string;
	host: string;
	url: string;
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

export default function CompanySetupPage() {
	const navigate = useNavigate();
	const { user, refreshSession, logout } = useAuth();
	const [tab, setTab] = useState<Tab | null>(null);

	useEffect(() => {
		if (user && user.companyId) navigate("/overview", { replace: true });
	}, [user, navigate]);

	async function applyJoin(token: string) {
		await refreshSession(token);
		navigate("/overview", { replace: true });
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-[#fdfaf3] via-[#faf3e3] to-[#f4ead3]">
			<div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
				<header className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold text-[#2b2418]">
							Welcome to Setra
						</h1>
						<p className="mt-1 max-w-xl text-sm text-[#5b4f3a]">
							Pick how you want to get started. You can always join more
							workspaces later from Settings.
						</p>
					</div>
					<button
						type="button"
						onClick={() => logout()}
						className="text-xs font-medium text-[#7a5421] hover:text-[#5b3d18]"
					>
						Sign out
					</button>
				</header>

				{tab === null ? (
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<OptionCard
							icon={<PlusCircle className="h-6 w-6" />}
							title="Create a new company"
							description="Start fresh. You become the owner and can invite your team."
							onClick={() => setTab("create")}
						/>
						<OptionCard
							icon={<Wifi className="h-6 w-6" />}
							title="Join on my network"
							description="Auto-discover companies running on the same Wi-Fi or LAN."
							onClick={() => setTab("lan")}
						/>
						<OptionCard
							icon={<Building2 className="h-6 w-6" />}
							title="Find on the internet"
							description="Search the public Setra directory by company name."
							onClick={() => setTab("cloud")}
						/>
						<OptionCard
							icon={<KeyRound className="h-6 w-6" />}
							title="Use an invite code"
							description="Paste the code an admin shared with you to join their workspace."
							onClick={() => setTab("code")}
						/>
					</div>
				) : (
					<div className="rounded-2xl border border-[#e5d6b8] bg-white/95 shadow-[0_24px_48px_-24px_rgba(74,55,28,0.18)]">
						<div className="flex items-center justify-between gap-3 border-b border-[#ead7b0] px-6 py-4">
							<button
								type="button"
								onClick={() => setTab(null)}
								className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7a5421] hover:text-[#5b3d18]"
							>
								<ArrowLeft className="h-4 w-4" />
								Back
							</button>
							<span className="text-xs text-[#6f6044]">
								{tab === "create"
									? "Create a company"
									: tab === "lan"
										? "Companies on your network"
										: tab === "cloud"
											? "Public directory"
											: "Enter invite code"}
							</span>
						</div>
						<div className="p-6">
							{tab === "create" && <CreateTab onJoined={applyJoin} />}
							{tab === "lan" && <LanTab onJoined={applyJoin} />}
							{tab === "cloud" && <CloudTab onJoined={applyJoin} />}
							{tab === "code" && <CodeTab onJoined={applyJoin} />}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function OptionCard({
	icon,
	title,
	description,
	onClick,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="group flex flex-col items-start gap-3 rounded-2xl border border-[#e5d6b8] bg-white/95 p-6 text-left shadow-[0_18px_36px_-24px_rgba(74,55,28,0.18)] transition-all hover:-translate-y-0.5 hover:border-[#c9a26a] hover:shadow-[0_24px_44px_-24px_rgba(74,55,28,0.28)]"
		>
			<div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#f7eed8] text-[#7a5421] transition-colors group-hover:bg-[#2b2418] group-hover:text-[#fbf6ec]">
				{icon}
			</div>
			<div>
				<h3 className="text-base font-semibold text-[#2b2418]">{title}</h3>
				<p className="mt-1 text-sm leading-relaxed text-[#5b4f3a]">
					{description}
				</p>
			</div>
		</button>
	);
}

/* ── Create ─────────────────────────────────────────────────────────── */

function CreateTab({ onJoined }: { onJoined: (token: string) => void }) {
	const [name, setName] = useState("");
	const [designation, setDesignation] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setBusy(true);
		try {
			const { token } = await request<{ token: string }>(
				"/onboarding/create",
				{
					method: "POST",
					body: JSON.stringify({ name: name.trim(), designation: designation.trim() }),
				},
			);
			onJoined(token);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<h2 className="text-lg font-semibold text-[#2b2418]">
				Create a new company
			</h2>
			<Field label="Company name">
				<Input
					required
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Acme Robotics"
				/>
			</Field>
			<Field label="Your designation">
				<Input
					value={designation}
					onChange={(e) => setDesignation(e.target.value)}
					placeholder="Founder, CEO, Engineer..."
				/>
			</Field>
			{error && <FormError>{error}</FormError>}
			<Button type="submit" disabled={busy} className="w-full">
				{busy ? "Creating..." : "Create and continue"}
			</Button>
		</form>
	);
}

/* ── LAN ────────────────────────────────────────────────────────────── */

function LanTab({ onJoined }: { onJoined: (token: string) => void }) {
	const [peers, setPeers] = useState<LanPeer[]>([]);
	const [loading, setLoading] = useState(true);
	const [designation, setDesignation] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;
		const load = async () => {
			try {
				const data = await request<{ peers: LanPeer[] }>("/lan/peers");
				if (mounted) setPeers(data.peers);
			} catch (err) {
				if (mounted) setError(getErrorMessage(err));
			} finally {
				if (mounted) setLoading(false);
			}
		};
		void load();
		const id = setInterval(load, 4000);
		return () => {
			mounted = false;
			clearInterval(id);
		};
	}, []);

	async function join(peer: LanPeer) {
		setBusy(peer.instanceId);
		setError(null);
		try {
			const { token } = await request<{ token: string }>("/onboarding/join", {
				method: "POST",
				body: JSON.stringify({
					mode: "lan",
					companyId: peer.companyId,
					companyName: peer.companyName,
					designation: designation.trim(),
				}),
			});
			onJoined(token);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="space-y-4">
			<h2 className="text-lg font-semibold text-[#2b2418]">
				Companies on your network
			</h2>
			<p className="text-sm text-[#5b4f3a]">
				Setra uses mDNS to discover other Setra instances on the same Wi-Fi or
				LAN. Have a teammate open their app and enable "Discoverable" in
				Settings → Network.
			</p>
			<Field label="Your designation">
				<Input
					value={designation}
					onChange={(e) => setDesignation(e.target.value)}
					placeholder="Engineer, Designer..."
				/>
			</Field>
			{loading ? (
				<p className="text-sm text-[#6f6044]">Searching the local network...</p>
			) : (
				<CompanyReels
					kind="lan"
					busyId={busy}
					items={peers.map((p) => ({
						id: p.instanceId,
						name: p.companyName,
						subtitle: `${p.host} · ${p.url}`,
						_peer: p,
					}))}
					onJoin={(it) => join((it as { _peer: LanPeer })._peer)}
					emptyState={
						<div>
							<p className="font-medium text-[#2b2418]">No nearby instances yet</p>
							<p className="mt-1 text-xs text-[#6f6044]">
								Make sure both devices are on the same network and have
								"Discoverable" enabled.
							</p>
						</div>
					}
				/>
			)}
			{error && <FormError>{error}</FormError>}
		</div>
	);
}

/* ── Internet (Supabase) ────────────────────────────────────────────── */

function CloudTab({ onJoined }: { onJoined: (token: string) => void }) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<CloudCompany[]>([]);
	const [designation, setDesignation] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	if (!supabaseEnabled()) {
		return (
			<div className="space-y-3">
				<h2 className="text-lg font-semibold text-[#2b2418]">
					Internet directory
				</h2>
				<div className="rounded-md border border-dashed border-[#d9c6a3] bg-[#fbf6ec] px-4 py-6 text-sm text-[#5b4f3a]">
					Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and{" "}
					<code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your board environment
					to enable internet-wide company discovery.
				</div>
			</div>
		);
	}

	async function search(e: FormEvent) {
		e.preventDefault();
		setError(null);
		try {
			const rows = await searchCloudCompanies(query.trim());
			setResults(rows);
			if (rows.length === 0) setError("No public companies match that name.");
		} catch (err) {
			setError(getErrorMessage(err));
		}
	}

	async function join(co: CloudCompany) {
		setBusy(co.id);
		setError(null);
		try {
			const { token } = await request<{ token: string }>("/onboarding/join", {
				method: "POST",
				body: JSON.stringify({
					mode: "cloud",
					companyId: co.id,
					companyName: co.name,
					designation: designation.trim(),
				}),
			});
			onJoined(token);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="space-y-4">
			<h2 className="text-lg font-semibold text-[#2b2418]">
				Find a company on the internet
			</h2>
			<p className="text-sm text-[#5b4f3a]">
				Search the public Setra directory. Owners can list their company by
				opting in from Settings → Directory.
			</p>
			<Field label="Your designation">
				<Input
					value={designation}
					onChange={(e) => setDesignation(e.target.value)}
					placeholder="Engineer, Designer..."
				/>
			</Field>
			<form onSubmit={search} className="flex gap-2">
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search by name..."
				/>
				<Button type="submit">Search</Button>
			</form>
			{results.length > 0 && (
				<CompanyReels
					kind="cloud"
					busyId={busy}
					items={results.map((co) => ({
						id: co.id,
						name: co.name,
						subtitle: co.region ?? "Unspecified region",
						_co: co,
					}))}
					onJoin={(it) => join((it as { _co: CloudCompany })._co)}
					emptyState={
						<p>Type a name above and press Search to discover companies.</p>
					}
				/>
			)}
			{error && <FormError>{error}</FormError>}
		</div>
	);
}

/* ── Invite code ────────────────────────────────────────────────────── */

function CodeTab({ onJoined }: { onJoined: (token: string) => void }) {
	const [code, setCode] = useState("");
	const [designation, setDesignation] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setBusy(true);
		try {
			const { token } = await request<{ token: string }>("/onboarding/join", {
				method: "POST",
				body: JSON.stringify({
					mode: "code",
					code: code.trim().toUpperCase(),
					designation: designation.trim(),
				}),
			});
			onJoined(token);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<h2 className="text-lg font-semibold text-[#2b2418]">
				Join with an invite code
			</h2>
			<p className="text-sm text-[#5b4f3a]">
				Owners and admins can mint short codes from Settings → Invite codes.
			</p>
			<Field label="Invite code">
				<Input
					required
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder="ABCD1234"
					className="font-mono uppercase tracking-widest"
				/>
			</Field>
			<Field label="Your designation">
				<Input
					value={designation}
					onChange={(e) => setDesignation(e.target.value)}
					placeholder="Engineer, Designer..."
				/>
			</Field>
			{error && <FormError>{error}</FormError>}
			<Button type="submit" disabled={busy} className="w-full">
				{busy ? "Joining..." : "Join company"}
			</Button>
		</form>
	);
}

/* ── shared ─────────────────────────────────────────────────────────── */

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<label className="block">
			<span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#6f6044]">
				{label}
			</span>
			{children}
		</label>
	);
}

function FormError({ children }: { children: React.ReactNode }) {
	return (
		<div
			role="alert"
			className="rounded-md border border-[#e6b6b0] bg-[#fbeeec] px-3 py-2 text-sm text-[#8e2f23]"
		>
			{children}
		</div>
	);
}
