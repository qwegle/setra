/**
 * LAN discovery — mDNS publisher + browser for finding peer Setra instances on
 * the local Wi-Fi network.
 *
 * Service type: `_setra._tcp.local.`
 * TXT records:
 *   instanceId  — stable random uuid for this server process
 *   companyId   — the company being advertised
 *   companyName — display name
 *   ownerEmail  — owner contact (so requesters know who they're asking to join)
 *   proto       — "http" | "https"
 *
 * Owners explicitly opt-in per company via `companies.lan_discoverable`.
 */
import { hostname, networkInterfaces } from "node:os";
import { Bonjour, type Service } from "bonjour-service";

export interface NearbyPeer {
	instanceId: string;
	companyId: string;
	companyName: string;
	ownerEmail: string;
	host: string;
	address: string;
	port: number;
	proto: "http" | "https";
	url: string;
	lastSeen: number;
}

const SERVICE_TYPE = "setra";
const INSTANCE_ID = (globalThis.crypto?.randomUUID?.() ??
	`setra-${Date.now().toString(36)}`) as string;

let bonjour: Bonjour | null = null;
let published: Service | null = null;
const peers = new Map<string, NearbyPeer>();

function ensureBonjour(): Bonjour {
	if (!bonjour) bonjour = new Bonjour();
	return bonjour;
}

export function getInstanceId(): string {
	return INSTANCE_ID;
}

export function isBroadcasting(): boolean {
	return published !== null;
}

export interface BroadcastOptions {
	companyId: string;
	companyName: string;
	ownerEmail: string;
	port: number;
	proto?: "http" | "https";
}

export function startBroadcast(opts: BroadcastOptions): void {
	stopBroadcast();
	const b = ensureBonjour();
	published = b.publish({
		name: `${opts.companyName} (Setra)`.slice(0, 60),
		type: SERVICE_TYPE,
		port: opts.port,
		host: hostname(),
		txt: {
			instanceId: INSTANCE_ID,
			companyId: opts.companyId,
			companyName: opts.companyName,
			ownerEmail: opts.ownerEmail,
			proto: opts.proto ?? "http",
		},
	});
	published.start?.();
}

export function stopBroadcast(): void {
	if (!published) return;
	try {
		published.stop?.();
	} catch {
		/* swallow — mdns shutdown is best-effort */
	}
	published = null;
}

let browser: ReturnType<Bonjour["find"]> | null = null;

export function startBrowser(): void {
	if (browser) return;
	const b = ensureBonjour();
	browser = b.find({ type: SERVICE_TYPE }, (svc) => {
		const txt = (svc.txt ?? {}) as Record<string, string>;
		const instanceId = txt.instanceId;
		if (!instanceId || instanceId === INSTANCE_ID) return;
		const address =
			(svc.addresses ?? []).find((a) => a.includes(".")) ??
			svc.addresses?.[0] ??
			svc.host;
		const proto = (txt.proto === "https" ? "https" : "http") as
			| "http"
			| "https";
		const peer: NearbyPeer = {
			instanceId,
			companyId: txt.companyId ?? "",
			companyName: txt.companyName ?? svc.name,
			ownerEmail: txt.ownerEmail ?? "",
			host: svc.host,
			address,
			port: svc.port,
			proto,
			url: `${proto}://${address}:${svc.port}`,
			lastSeen: Date.now(),
		};
		peers.set(instanceId, peer);
	});
	browser.on?.("down", (svc: Service) => {
		const txt = (svc.txt ?? {}) as Record<string, string>;
		if (txt.instanceId) peers.delete(txt.instanceId);
	});
}

export function listPeers(): NearbyPeer[] {
	const cutoff = Date.now() - 5 * 60_000;
	const out: NearbyPeer[] = [];
	for (const p of peers.values()) {
		if (p.lastSeen >= cutoff) out.push(p);
	}
	out.sort((a, b) => a.companyName.localeCompare(b.companyName));
	return out;
}

export function getLanAddresses(): string[] {
	const addrs: string[] = [];
	const ifaces = networkInterfaces();
	for (const list of Object.values(ifaces)) {
		for (const iface of list ?? []) {
			if (iface.family === "IPv4" && !iface.internal)
				addrs.push(iface.address);
		}
	}
	return addrs;
}

export function shutdown(): void {
	stopBroadcast();
	try {
		browser?.stop?.();
	} catch {
		/* */
	}
	browser = null;
	try {
		bonjour?.destroy();
	} catch {
		/* */
	}
	bonjour = null;
	peers.clear();
}
