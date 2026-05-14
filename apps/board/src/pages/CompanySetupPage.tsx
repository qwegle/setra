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

import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
	const [tab, setTab] = useState<Tab>("create");

	useEffect(() => {
		if (user && user.companyId) navigate("/overview", { replace: true });
	}, [user, navigate]);

	async function applyJoin(token: string) {
		await refreshSession(token);
		navigate("/overview", { replace: true });
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-[#fbf6ec] via-[#f7efe0] to-[#f1e6d0]">
			<div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
				<header className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold text-[#2b2418]">
							Welcome to Setra
						</h1>
						<p className="mt-1 max-w-xl text-sm text-[#5b4f3a]">
							Connect to a workspace before you start. Create your own, or
							join one your team already runs.
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

				<div className="rounded-2xl border border-[#e5d6b8] bg-white/90 p-2 shadow-[0_24px_48px_-24px_rgba(74,55,28,0.18)]">
					<nav className="grid grid-cols-4 gap-1 p-1">
						<TabButton active={tab === "create"} onClick={() => setTab("create")}>
							Create
						</TabButton>
						<TabButton active={tab === "lan"} onClick={() => setTab("lan")}>
							On my network
						</TabButton>
						<TabButton
							active={tab === "cloud"}
							onClick={() => setTab("cloud")}
						>
							Internet
						</TabButton>
						<TabButton active={tab === "code"} onClick={() => setTab("code")}>
							Invite code
						</TabButton>
					</nav>

					<div className="p-6">
						{tab === "create" && <CreateTab onJoined={applyJoin} />}
						{tab === "lan" && <LanTab onJoined={applyJoin} />}
						{tab === "cloud" && <CloudTab onJoined={applyJoin} />}
						{tab === "code" && <CodeTab onJoined={applyJoin} />}
					</div>
				</div>
			</div>
		</div>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
				active
					? "bg-[#2b2418] text-[#fbf6ec]"
					: "text-[#5b4f3a] hover:bg-[#f3e7cf]"
			}`}
		>
			{children}
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
			) : peers.length === 0 ? (
				<div className="rounded-md border border-dashed border-[#d9c6a3] bg-[#fbf6ec] px-4 py-6 text-center text-sm text-[#5b4f3a]">
					No nearby Setra instances yet. Make sure both devices are on the
					same network and discoverable.
				</div>
			) : (
				<ul className="divide-y divide-[#ead7b0] rounded-md border border-[#e5d6b8]">
					{peers.map((peer) => (
						<li
							key={peer.instanceId}
							className="flex items-center justify-between gap-3 px-4 py-3"
						>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium text-[#2b2418]">
									{peer.companyName}
								</div>
								<div className="truncate text-xs text-[#6f6044]">
									{peer.host} · {peer.url}
								</div>
							</div>
							<Button
								type="button"
								onClick={() => join(peer)}
								disabled={busy === peer.instanceId}
							>
								{busy === peer.instanceId ? "Joining..." : "Join"}
							</Button>
						</li>
					))}
				</ul>
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
				<ul className="divide-y divide-[#ead7b0] rounded-md border border-[#e5d6b8]">
					{results.map((co) => (
						<li
							key={co.id}
							className="flex items-center justify-between gap-3 px-4 py-3"
						>
							<div className="min-w-0">
								<div className="truncate text-sm font-medium text-[#2b2418]">
									{co.name}
								</div>
								<div className="truncate text-xs text-[#6f6044]">
									{co.region ?? "Unspecified region"}
								</div>
							</div>
							<Button
								type="button"
								onClick={() => join(co)}
								disabled={busy === co.id}
							>
								{busy === co.id ? "Joining..." : "Join"}
							</Button>
						</li>
					))}
				</ul>
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
