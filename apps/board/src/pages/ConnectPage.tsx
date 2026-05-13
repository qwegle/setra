/**
 * ConnectPage — discover and join peer Setra workspaces.
 *
 * Two tabs:
 *  - Nearby: instances auto-advertised on the local Wi-Fi via mDNS
 *  - Remote: paste a URL of a peer instance (works over the internet when
 *            the owner has port-forwarded / tunnel-exposed it)
 *
 * Joining flow:
 *  1. Click "Request to join" on a peer → POST to peer's /api/lan/join-request
 *     with the user's email + name.
 *  2. Owner of the peer approves the request from Team / Network panel.
 *  3. Once approved, the user opens the peer URL and registers with the same
 *     email — auth.register picks up the pending invite and slots them into
 *     the peer's company.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	Globe,
	Network as NetworkIcon,
	RefreshCw,
	Shield,
	Users,
	Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

type Tab = "nearby" | "remote" | "requests";

type Peer = {
	instanceId: string;
	companyId: string;
	companyName: string;
	ownerEmail: string;
	address: string;
	port: number;
	proto: "http" | "https";
	url: string;
};

function StatusPill({
	broadcasting,
	discoverable,
}: {
	broadcasting: boolean;
	discoverable: boolean;
}) {
	if (discoverable && broadcasting) {
		return (
			<Badge variant="success" className="gap-1">
				<Wifi className="h-3 w-3" /> Broadcasting
			</Badge>
		);
	}
	if (discoverable) {
		return (
			<Badge variant="warning" className="gap-1">
				<Wifi className="h-3 w-3" /> Enabled (idle)
			</Badge>
		);
	}
	return (
		<Badge variant="info" className="gap-1">
			<Shield className="h-3 w-3" /> Private
		</Badge>
	);
}

function PeerCard({
	peer,
	onJoin,
}: {
	peer: Peer;
	onJoin: (peer: Peer) => void;
}) {
	return (
		<Card className="p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<NetworkIcon className="h-4 w-4 text-setra-400" />
						<h3 className="text-base font-semibold truncate">
							{peer.companyName || "Setra workspace"}
						</h3>
					</div>
					<div className="mt-1 text-xs text-muted-foreground space-y-0.5">
						<div>Host: {peer.address}:{peer.port}</div>
						{peer.ownerEmail ? <div>Owner: {peer.ownerEmail}</div> : null}
					</div>
				</div>
				<div className="flex flex-col gap-2 items-end">
					<Button size="sm" onClick={() => onJoin(peer)}>
						<Users className="h-3.5 w-3.5 mr-1.5" /> Request to join
					</Button>
					<a
						href={peer.url}
						target="_blank"
						rel="noreferrer"
						className="text-xs text-setra-400 hover:underline"
					>
						Open in browser →
					</a>
				</div>
			</div>
		</Card>
	);
}

function JoinDialog({
	peer,
	onClose,
}: {
	peer: { url: string; companyId: string; companyName: string };
	onClose: () => void;
}) {
	const { user } = useAuth();
	const [email, setEmail] = useState(user?.email ?? "");
	const [name, setName] = useState(user?.name ?? "");
	const [message, setMessage] = useState("");
	const [submitted, setSubmitted] = useState<null | {
		id: string;
		status: string;
	}>(null);
	const [error, setError] = useState<string | null>(null);

	const submit = useMutation({
		mutationFn: () =>
			api.lan.requestJoin(peer.url, {
				companyId: peer.companyId,
				email,
				...(name ? { name } : {}),
				...(message ? { message } : {}),
			}),
		onSuccess: (res) => {
			setSubmitted({ id: res.requestId, status: res.status });
			setError(null);
		},
		onError: (e: Error) => setError(e.message),
	});

	// Poll for approval once submitted
	useEffect(() => {
		if (!submitted || submitted.status === "pending") return;
		const t = setInterval(async () => {
			try {
				const r = await api.lan.pollJoinRequest(peer.url, submitted.id);
				if (r.status !== submitted.status) {
					setSubmitted({ id: submitted.id, status: r.status });
				}
			} catch {
				/* network blip — keep polling */
			}
		}, 4000);
		return () => clearInterval(t);
	}, [peer.url, submitted]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
			<Card className="w-full max-w-md p-5 space-y-4">
				<div>
					<h3 className="text-lg font-semibold">
						Request to join {peer.companyName}
					</h3>
					<p className="text-xs text-muted-foreground mt-1">
						The owner of this workspace must approve your request before you
						can sign in.
					</p>
				</div>
				{!submitted ? (
					<>
						<div className="space-y-2">
							<label className="text-xs text-muted-foreground">Email</label>
							<input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className="w-full px-3 py-2 bg-muted/30 border border-border rounded text-sm"
								placeholder="you@example.com"
							/>
							<label className="text-xs text-muted-foreground">Name</label>
							<input
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="w-full px-3 py-2 bg-muted/30 border border-border rounded text-sm"
								placeholder="Your name"
							/>
							<label className="text-xs text-muted-foreground">
								Message (optional)
							</label>
							<textarea
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								className="w-full px-3 py-2 bg-muted/30 border border-border rounded text-sm"
								rows={3}
								placeholder="Hi, I'd like to join the dev pool."
							/>
						</div>
						{error ? (
							<p className="text-xs text-destructive">{error}</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={onClose}>
								Cancel
							</Button>
							<Button
								onClick={() => submit.mutate()}
								disabled={!email || submit.isPending}
							>
								{submit.isPending ? "Sending…" : "Send request"}
							</Button>
						</div>
					</>
				) : (
					<div className="space-y-3">
						<div
							className={cn(
								"flex items-center gap-2 text-sm",
								submitted.status === "pending"
									? "text-emerald-400"
									: "text-amber-400",
							)}
						>
							<CheckCircle2 className="h-4 w-4" />
							{submitted.status === "lan_pending" && (
								<span>Request sent — waiting for owner approval…</span>
							)}
							{submitted.status === "pending" && (
								<span>Approved! Open the workspace to sign in.</span>
							)}
							{submitted.status === "rejected" && (
								<span>The owner declined this request.</span>
							)}
							{submitted.status === "accepted" && (
								<span>You're already a member of this workspace.</span>
							)}
						</div>
						{submitted.status === "pending" ? (
							<a
								href={`${peer.url}/login?email=${encodeURIComponent(email)}`}
								target="_blank"
								rel="noreferrer"
								className="block text-center w-full px-3 py-2 bg-setra-600 hover:bg-setra-500 rounded text-sm font-medium"
							>
								Open {peer.companyName} →
							</a>
						) : null}
						<Button variant="ghost" onClick={onClose} className="w-full">
							Close
						</Button>
					</div>
				)}
			</Card>
		</div>
	);
}

function PublicUrlEditor({
	status,
}: {
	status:
		| {
				publicUrl: string | null;
				instanceUrl: string;
				companyId: string;
		  }
		| undefined;
}) {
	const qc = useQueryClient();
	const [value, setValue] = useState("");
	const [editing, setEditing] = useState(false);
	useEffect(() => {
		setValue(status?.publicUrl ?? "");
	}, [status?.publicUrl]);
	const save = useMutation({
		mutationFn: (v: string | null) => api.lan.setPublicUrl(v),
		onSuccess: () => {
			setEditing(false);
			qc.invalidateQueries({ queryKey: ["lan"] });
		},
	});
	if (!status) return null;
	return (
		<Card className="p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium">Public URL for invite links</div>
					<p className="text-xs text-muted-foreground mt-0.5">
						Override the auto-detected URL when this instance is reachable on
						a public hostname or VPN.
					</p>
					{!editing ? (
						<code className="block mt-2 px-2 py-1 bg-black/30 rounded text-xs font-mono break-all">
							{status.publicUrl ?? status.instanceUrl}{" "}
							{!status.publicUrl ? (
								<span className="text-muted-foreground">(auto)</span>
							) : null}
						</code>
					) : (
						<input
							type="url"
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder="https://setra.acme.com"
							className="mt-2 w-full px-3 py-1.5 bg-muted/30 border border-border rounded text-xs font-mono"
						/>
					)}
				</div>
				<div className="flex gap-2">
					{!editing ? (
						<Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
							Edit
						</Button>
					) : (
						<>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setValue(status.publicUrl ?? "");
									setEditing(false);
								}}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								onClick={() =>
									save.mutate(value.trim() ? value.trim() : null)
								}
								disabled={save.isPending}
							>
								Save
							</Button>
						</>
					)}
				</div>
			</div>
		</Card>
	);
}

export default function ConnectPage() {
	const [tab, setTab] = useState<Tab>("nearby");
	const [remoteUrl, setRemoteUrl] = useState("");
	const [remoteCompanyId, setRemoteCompanyId] = useState("");
	const [remoteCompanyName, setRemoteCompanyName] = useState("");
	const [joinTarget, setJoinTarget] = useState<{
		url: string;
		companyId: string;
		companyName: string;
	} | null>(null);
	const qc = useQueryClient();

	const status = useQuery({
		queryKey: ["lan", "status"],
		queryFn: () => api.lan.status(),
		refetchInterval: 10_000,
	});
	const peers = useQuery({
		queryKey: ["lan", "peers"],
		queryFn: () => api.lan.peers(),
		refetchInterval: 5_000,
	});
	const requests = useQuery({
		queryKey: ["lan", "join-requests"],
		queryFn: () => api.lan.joinRequests(),
		refetchInterval: 7_000,
	});

	const toggle = useMutation({
		mutationFn: (enabled: boolean) => api.lan.setDiscoverable(enabled),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["lan"] }),
	});
	const approve = useMutation({
		mutationFn: (id: string) => api.lan.approve(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["lan"] }),
	});
	const reject = useMutation({
		mutationFn: (id: string) => api.lan.reject(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["lan"] }),
	});

	const pendingCount = requests.data?.requests.length ?? 0;
	const tabs: { id: Tab; label: string; icon: typeof Wifi; count?: number }[] =
		[
			{ id: "nearby", label: "Nearby (Wi-Fi)", icon: Wifi },
			{ id: "remote", label: "Remote URL", icon: Globe },
			{
				id: "requests",
				label: "Join requests",
				icon: Users,
				count: pendingCount,
			},
		];

	return (
		<div className="space-y-5">
			<PageHeader
				title="Connect"
				subtitle="Find and join other Setra workspaces on your network — or invite teammates to join yours."
				actions={
					<div className="flex items-center gap-2">
						<StatusPill
							discoverable={status.data?.discoverable ?? false}
							broadcasting={status.data?.broadcasting ?? false}
						/>
						<Button
							size="sm"
							variant={
								status.data?.discoverable ? "secondary" : "primary"
							}
							onClick={() => toggle.mutate(!(status.data?.discoverable ?? false))}
							disabled={toggle.isPending}
						>
							{status.data?.discoverable
								? "Stop broadcasting"
								: "Make discoverable on Wi-Fi"}
						</Button>
					</div>
				}
			/>

			{status.data?.discoverable && status.data.addresses.length > 0 ? (
				<Card className="p-4 bg-setra-600/10 border-setra-600/30">
					<div className="text-sm">
						Teammates on this Wi-Fi can reach this workspace at:
					</div>
					<div className="mt-2 flex flex-wrap gap-2">
						{status.data.addresses.map((addr) => (
							<code
								key={addr}
								className="px-2 py-1 bg-black/30 rounded text-xs font-mono"
							>
								http://{addr}:{status.data.port}
							</code>
						))}
					</div>
				</Card>
			) : null}

			<PublicUrlEditor status={status.data} />

			<div className="flex gap-1 border-b border-border">
				{tabs.map((t) => (
					<button
						type="button"
						key={t.id}
						onClick={() => setTab(t.id)}
						className={cn(
							"flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
							tab === t.id
								? "border-setra-500 text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<t.icon className="h-3.5 w-3.5" />
						{t.label}
						{t.count ? (
							<span className="ml-1 px-1.5 py-0.5 text-[10px] bg-setra-600 rounded-full">
								{t.count}
							</span>
						) : null}
					</button>
				))}
			</div>

			{tab === "nearby" && (
				<div className="space-y-3">
					<div className="flex justify-between items-center">
						<p className="text-sm text-muted-foreground">
							{peers.data?.peers.length ?? 0} workspace(s) discovered on
							your network.
						</p>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => peers.refetch()}
						>
							<RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
						</Button>
					</div>
					{peers.data && peers.data.peers.length === 0 ? (
						<Card className="p-8 text-center text-sm text-muted-foreground">
							<Wifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
							No nearby workspaces found. Ask a teammate to enable
							discoverability on their machine, or use the Remote URL tab.
						</Card>
					) : null}
					<div className="grid gap-3">
						{peers.data?.peers.map((p) => (
							<PeerCard
								key={p.instanceId}
								peer={p}
								onJoin={() =>
									setJoinTarget({
										url: p.url,
										companyId: p.companyId,
										companyName: p.companyName,
									})
								}
							/>
						))}
					</div>
				</div>
			)}

			{tab === "remote" && (
				<Card className="p-5 space-y-3">
					<div>
						<h3 className="text-base font-semibold">Connect to a remote workspace</h3>
						<p className="text-xs text-muted-foreground mt-1">
							Enter the URL of a teammate's Setra server. They must have
							exposed it on a network you can reach (LAN, VPN, or
							port-forwarded internet).
						</p>
					</div>
					<div className="space-y-2">
						<label className="text-xs text-muted-foreground">
							Workspace URL
						</label>
						<input
							type="url"
							value={remoteUrl}
							onChange={(e) => setRemoteUrl(e.target.value)}
							placeholder="http://192.168.1.42:3141"
							className="w-full px-3 py-2 bg-muted/30 border border-border rounded text-sm font-mono"
						/>
						<label className="text-xs text-muted-foreground">
							Company / workspace ID
						</label>
						<input
							type="text"
							value={remoteCompanyId}
							onChange={(e) => setRemoteCompanyId(e.target.value)}
							placeholder="Ask the owner — shown in their Connect page"
							className="w-full px-3 py-2 bg-muted/30 border border-border rounded text-sm font-mono"
						/>
						<label className="text-xs text-muted-foreground">
							Display name (optional)
						</label>
						<input
							type="text"
							value={remoteCompanyName}
							onChange={(e) => setRemoteCompanyName(e.target.value)}
							placeholder="Acme Dev Pool"
							className="w-full px-3 py-2 bg-muted/30 border border-border rounded text-sm"
						/>
					</div>
					<Button
						disabled={!remoteUrl || !remoteCompanyId}
						onClick={() =>
							setJoinTarget({
								url: remoteUrl,
								companyId: remoteCompanyId,
								companyName: remoteCompanyName || remoteUrl,
							})
						}
					>
						<Users className="h-3.5 w-3.5 mr-1.5" /> Request to join
					</Button>
				</Card>
			)}

			{tab === "requests" && (
				<div className="space-y-3">
					<p className="text-sm text-muted-foreground">
						Pending requests from people who want to join this workspace.
					</p>
					{requests.data?.requests.length === 0 ? (
						<Card className="p-8 text-center text-sm text-muted-foreground">
							No pending join requests.
						</Card>
					) : null}
					{requests.data?.requests.map((r) => (
						<Card key={r.id} className="p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<div className="font-medium">{r.name ?? r.email}</div>
									<div className="text-xs text-muted-foreground">
										{r.email} · {new Date(r.sentAt).toLocaleString()}
									</div>
									{r.message ? (
										<p className="mt-2 text-sm text-muted-foreground italic">
											"{r.message}"
										</p>
									) : null}
								</div>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="ghost"
										onClick={() => reject.mutate(r.id)}
										disabled={reject.isPending}
									>
										Decline
									</Button>
									<Button
										size="sm"
										onClick={() => approve.mutate(r.id)}
										disabled={approve.isPending}
									>
										Approve
									</Button>
								</div>
							</div>
						</Card>
					))}
				</div>
			)}

			{joinTarget && (
				<JoinDialog peer={joinTarget} onClose={() => setJoinTarget(null)} />
			)}
		</div>
	);
}
