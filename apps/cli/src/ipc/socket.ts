/**
 * setra IPC socket client
 *
 * In the Electron app, communication to setra-core goes through
 * contextBridge (preload.ts → ipcRenderer.invoke).
 *
 * In the TUI/CLI, we connect to the same setra-core daemon via a
 * Unix domain socket at ~/.setra/daemon.sock (or via SSH tunnel for
 * remote grounds). The message protocol is newline-delimited JSON (NDJSON).
 *
 * Transport comparison:
 *   Electron:  contextBridge.invoke('plots:list') → ipcMain handler
 *   TUI/SSH:   Unix socket → setra-core HTTP/JSON-RPC handler
 *   Remote:    SSH tunnel → local Unix socket proxy → remote setra-core
 */

import { EventEmitter } from "events";
import net from "net";
import os from "os";
import path from "path";
import { getActiveInstance } from "@setra/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RPCRequest = {
	id: string;
	method: string;
	params: unknown;
};

export type RPCResponse<T = unknown> = {
	id: string;
	result?: T;
	error?: { code: number; message: string };
};

export type SocketEvent =
	| { type: "run:output"; plotId: string; chunk: string }
	| { type: "run:status"; plotId: string; status: RunStatus }
	| { type: "run:cost"; plotId: string; costUsd: number; tokens: number }
	| { type: "plot:update"; plotId: string }
	| { type: "daemon:ready" }
	| { type: "daemon:error"; message: string };

export type RunStatus = "pending" | "running" | "paused" | "done" | "error";

// ─── Default socket path ──────────────────────────────────────────────────────

export function defaultSocketPath(): string {
	// Prefer the active registered instance socket (set when `setra serve` starts)
	try {
		const inst = getActiveInstance();
		if (inst?.socketPath) return inst.socketPath;
	} catch {
		/* ignore — shared package may not be available */
	}
	// Fall back to the well-known symlink that `setra serve` creates
	return path.join(os.homedir(), ".setra", "daemon.sock");
}

// ─── SocketClient ─────────────────────────────────────────────────────────────

export class SocketClient extends EventEmitter {
	private socket: net.Socket | null = null;
	private pending: Map<string, (res: RPCResponse) => void> = new Map();
	private buffer = "";
	private _ready = false;
	private _counter = 0;

	constructor(private readonly socketPath: string = defaultSocketPath()) {
		super();
	}

	get ready(): boolean {
		return this._ready;
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const sock = net.createConnection(this.socketPath);

			sock.on("connect", () => {
				this._ready = true;
				this.socket = sock;
				resolve();
			});

			sock.on("error", (err) => {
				if (!this._ready) {
					reject(
						new Error(
							`Cannot connect to setra-core daemon.\n` +
								`Run \`setra serve\` first, or check ${this.socketPath}\n` +
								`Cause: ${err.message}`,
						),
					);
				} else {
					this.emit("error", err);
				}
			});

			sock.on("data", (chunk: Buffer) => {
				this.buffer += chunk.toString("utf8");
				let idx: number;
				while ((idx = this.buffer.indexOf("\n")) !== -1) {
					const line = this.buffer.slice(0, idx).trim();
					this.buffer = this.buffer.slice(idx + 1);
					if (!line) continue;
					this.handleLine(line);
				}
			});

			sock.on("close", () => {
				this._ready = false;
				this.emit("disconnect");
			});
		});
	}

	private handleLine(line: string): void {
		let msg: RPCResponse | SocketEvent;
		try {
			msg = JSON.parse(line);
		} catch {
			return; // ignore malformed lines
		}

		// RPC response
		if ("id" in msg && msg.id) {
			const cb = this.pending.get(msg.id);
			if (cb) {
				this.pending.delete(msg.id);
				cb(msg as RPCResponse);
			}
			return;
		}

		// Push event (no id)
		if ("type" in msg) {
			this.emit("event", msg as SocketEvent);
		}
	}

	async call<T>(method: string, params: unknown = {}): Promise<T> {
		if (!this.socket || !this._ready) {
			throw new Error("Socket not connected");
		}

		const id = String(++this._counter);
		const req: RPCRequest = { id, method, params };

		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC timeout: ${method}`));
			}, 15_000);

			this.pending.set(id, (res) => {
				clearTimeout(timeout);
				if (res.error) {
					reject(new Error(`${method} failed: ${res.error.message}`));
				} else {
					resolve(res.result as T);
				}
			});

			this.socket!.write(JSON.stringify(req) + "\n");
		});
	}

	disconnect(): void {
		this.socket?.destroy();
		this.socket = null;
		this._ready = false;
		this.pending.clear();
	}
}

// ─── Singleton for use across TUI components ─────────────────────────────────

let _instance: SocketClient | null = null;

export function getClient(): SocketClient {
	if (!_instance) {
		_instance = new SocketClient(defaultSocketPath());
	}
	return _instance;
}

// ─── High-level typed API (mirrors contextBridge shape in Electron) ───────────
//
// Electron:  window.setra.plots.list()
// TUI:       api.plots.list()
//
// Same call signature, different transport under the hood.

export const api = {
	plots: {
		list: () => getClient().call<Plot[]>("plots:list"),
		get: (id: string) => getClient().call<Plot>("plots:get", { id }),
		create: (input: CreatePlotInput) =>
			getClient().call<Plot>("plots:create", input),
		delete: (id: string) => getClient().call<void>("plots:delete", { id }),
	},
	runs: {
		start: (plotId: string, opts?: RunOptions) =>
			getClient().call<Run>("runs:start", { plotId, ...opts }),
		stop: (runId: string) => getClient().call<void>("runs:stop", { runId }),
		pause: (runId: string) => getClient().call<void>("runs:pause", { runId }),
		resume: (runId: string) => getClient().call<void>("runs:resume", { runId }),
		list: (plotId?: string) => getClient().call<Run[]>("runs:list", { plotId }),
		get: (runId: string) => getClient().call<Run>("runs:get", { runId }),
		output: (runId: string, opts?: { last?: number }) =>
			getClient().call<string>("runs:output", { runId, ...opts }),
	},
	grounds: {
		list: () => getClient().call<Ground[]>("grounds:list"),
		get: (id: string) => getClient().call<Ground>("grounds:get", { id }),
		create: (input: CreateGroundInput) =>
			getClient().call<Ground>("grounds:create", input),
		test: (id: string) =>
			getClient().call<GroundTestResult>("grounds:test", { id }),
	},
	traces: {
		search: (query: string, opts?: TraceSearchOpts) =>
			getClient().call<TraceResult[]>("traces:search", { query, ...opts }),
		list: (plotId?: string) =>
			getClient().call<TraceResult[]>("traces:list", { plotId }),
	},
	ledger: {
		summary: (opts?: LedgerOpts) =>
			getClient().call<LedgerSummary>("ledger:summary", opts ?? {}),
		byPlot: () => getClient().call<LedgerByPlot[]>("ledger:by-plot"),
		byDay: () => getClient().call<LedgerByDay[]>("ledger:by-day"),
	},
	marks: {
		create: (plotId: string, msg?: string) =>
			getClient().call<Mark>("marks:create", { plotId, message: msg }),
		list: (plotId: string) =>
			getClient().call<Mark[]>("marks:list", { plotId }),
	},
	daemon: {
		status: () => getClient().call<DaemonStatus>("daemon:status"),
		version: () => getClient().call<string>("daemon:version"),
	},
} as const;

// ─── Inline types (full types live in packages/types) ────────────────────────

export type Plot = {
	id: string;
	name: string;
	status: PlotStatus;
	branch: string;
	groundId?: string;
	projectId: string;
	agentAdapter: string;
	createdAt: string;
	updatedAt: string;
};
export type PlotStatus = "idle" | "running" | "paused" | "error" | "archived";
export type CreatePlotInput = Pick<
	Plot,
	"name" | "projectId" | "agentAdapter"
> & { groundId?: string; branch?: string };

export type Run = {
	id: string;
	plotId: string;
	status: RunStatus;
	startedAt?: string;
	finishedAt?: string;
	costUsd: number;
	totalTokens: number;
	tmuxSession?: string;
	groundId?: string;
};
export type RunOptions = { task?: string; budget?: number; dryRun?: boolean };

export type Ground = {
	id: string;
	name: string;
	host: string;
	user: string;
	port: number;
	status: "connected" | "disconnected" | "unknown";
};
export type CreateGroundInput = Omit<Ground, "id" | "status"> & {
	identityPath?: string;
};
export type GroundTestResult = {
	ok: boolean;
	latencyMs: number;
	error?: string;
};

export type TraceResult = {
	id: string;
	plotId: string;
	runId: string;
	summary: string;
	content: string;
	score: number;
	createdAt: string;
};
export type TraceSearchOpts = { limit?: number; plotId?: string };

export type LedgerSummary = {
	totalUsd: number;
	totalTokens: number;
	runCount: number;
};
export type LedgerByPlot = {
	plotId: string;
	plotName: string;
	totalUsd: number;
	runCount: number;
};
export type LedgerByDay = { date: string; totalUsd: number; runCount: number };
export type LedgerOpts = { since?: string; plotId?: string };

export type Mark = {
	id: string;
	plotId: string;
	sha: string;
	message: string;
	createdAt: string;
};

export type DaemonStatus = {
	pid: number;
	version: string;
	uptime: number;
	activeRuns: number;
	socketPath: string;
};
