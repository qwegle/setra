import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { readMcpConfig } from "./config.js";
import type {
	McpServerConfig,
	McpServerState,
	McpServerStatus,
	McpTool,
} from "./types.js";

// JSON-RPC types
interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

interface ToolsListResult {
	tools: Array<{
		name: string;
		description?: string;
		inputSchema: Record<string, unknown>;
	}>;
}

interface ToolsCallResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

// Stdio JSON-RPC client
class StdioRpcClient {
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
		}
	>();

	constructor(private readonly proc: ChildProcess) {
		const rl = createInterface({ input: proc.stdout! });
		rl.on("line", (line) => {
			if (!line.trim()) return;
			try {
				const msg = JSON.parse(line) as JsonRpcResponse;
				if (typeof msg.id === "number") {
					const pending = this.pending.get(msg.id);
					if (pending) {
						this.pending.delete(msg.id);
						if (msg.error) {
							pending.reject(new Error(msg.error.message));
						} else {
							pending.resolve(msg.result ?? null);
						}
					}
				}
			} catch {
				// ignore malformed lines
			}
		});
	}

	request(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<unknown> {
		const id = this.nextId++;
		const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		this.proc.stdin!.write(JSON.stringify(msg) + "\n");

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`MCP request timeout: ${method}`));
				}
			}, 15000);

			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
		});
	}

	notify(method: string, params: Record<string, unknown> = {}): void {
		const msg = { jsonrpc: "2.0", method, params };
		this.proc.stdin!.write(JSON.stringify(msg) + "\n");
	}
}

// McpManager
// Utility type for patching state — allows explicitly clearing optional fields
type StatePatch = {
	[K in keyof McpServerState]?: McpServerState[K] | undefined;
};

export class McpManager extends EventEmitter {
	private readonly states = new Map<string, McpServerState>();
	private readonly processes = new Map<string, ChildProcess>();
	private readonly rpcClients = new Map<string, StdioRpcClient>();

	constructor(private readonly companyId?: string | null) {
		super();
		const configs = readMcpConfig(companyId);
		for (const config of configs) {
			this.states.set(config.id, { config, status: "stopped", tools: [] });
		}
		// Auto-start servers with autoStart=true
		for (const config of configs) {
			if (config.autoStart) {
				this.start(config.id).catch(() => {
					// error state is set inside start()
				});
			}
		}
	}

	private setState(id: string, patch: StatePatch): void {
		const current = this.states.get(id);
		if (!current) return;
		const next: Record<string, unknown> = { ...current };
		for (const key of Object.keys(patch) as (keyof McpServerState)[]) {
			const val = patch[key];
			if (val === undefined) {
				delete next[key];
			} else {
				next[key] = val;
			}
		}
		this.states.set(id, next as unknown as McpServerState);
		this.emit("state-changed", this.getAllStates());
	}

	registerConfig(config: McpServerConfig): void {
		if (!this.states.has(config.id)) {
			this.states.set(config.id, { config, status: "stopped", tools: [] });
			this.emit("state-changed", this.getAllStates());
		}
	}

	unregisterConfig(id: string): void {
		this.states.delete(id);
		this.emit("state-changed", this.getAllStates());
	}

	async start(id: string): Promise<void> {
		const state = this.states.get(id);
		if (!state) throw new Error(`Unknown MCP server: ${id}`);

		const { config } = state;

		if (state.status === "starting" || state.status === "connected") return;

		this.setState(id, { status: "starting" });
		// Clear error if previously set
		const cur = this.states.get(id);
		if (cur && "error" in cur) {
			const next = { ...cur };
			delete next.error;
			this.states.set(id, next);
		}

		try {
			if (config.transport === "stdio") {
				await this.startStdio(id, config);
			} else {
				await this.startRemote(id, config);
			}
		} catch (err) {
			this.setState(id, {
				status: "error",
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	}

	private async startStdio(id: string, config: McpServerConfig): Promise<void> {
		const command = config.command;
		if (!command) throw new Error("stdio server requires a command");

		const proc = spawn(command, config.args ?? [], {
			env: { ...process.env, ...(config.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});

		proc.on("error", (err) => {
			this.setState(id, { status: "error", error: err.message });
			this.processes.delete(id);
			this.rpcClients.delete(id);
		});

		proc.on("exit", () => {
			const s = this.states.get(id);
			if (s?.status !== "stopped") {
				const stopped = { ...s } as McpServerState;
				stopped.status = "stopped";
				delete stopped.pid;
				this.states.set(id, stopped);
				this.emit("state-changed", this.getAllStates());
			}
			this.processes.delete(id);
			this.rpcClients.delete(id);
		});

		proc.stderr?.on("data", () => {
			// Discard stderr to avoid blocking
		});

		this.processes.set(id, proc);
		const rpc = new StdioRpcClient(proc);
		this.rpcClients.set(id, rpc);

		if (proc.pid !== undefined) {
			this.setState(id, { pid: proc.pid });
		}

		// MCP handshake
		await rpc.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "setra", version: "0.1.0" },
		});
		rpc.notify("initialized", {});

		const toolsResult = (await rpc.request(
			"tools/list",
			{},
		)) as ToolsListResult;
		const tools: McpTool[] = (toolsResult?.tools ?? []).map((t) => ({
			serverId: id,
			name: t.name,
			description: t.description ?? "",
			inputSchema: t.inputSchema ?? {},
		}));

		this.setState(id, {
			status: "connected",
			tools,
			lastConnectedAt: Date.now(),
		});
	}

	private async startRemote(
		id: string,
		config: McpServerConfig,
	): Promise<void> {
		if (!config.url) throw new Error("sse/http server requires a url");

		// Attempt to fetch tool list via HTTP JSON-RPC
		let tools: McpTool[] = [];
		try {
			const resp = await fetch(config.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
					params: {},
				}),
				signal: AbortSignal.timeout(10000),
			});
			if (resp.ok) {
				const data = (await resp.json()) as JsonRpcResponse;
				const result = data.result as ToolsListResult | undefined;
				if (result?.tools) {
					tools = result.tools.map((t) => ({
						serverId: id,
						name: t.name,
						description: t.description ?? "",
						inputSchema: t.inputSchema ?? {},
					}));
				}
			}
		} catch {
			// Tools list may be unavailable for remote servers
		}

		this.setState(id, {
			status: "connected",
			tools,
			lastConnectedAt: Date.now(),
		});
	}

	async stop(id: string): Promise<void> {
		const proc = this.processes.get(id);
		if (proc) {
			proc.kill("SIGTERM");
			this.processes.delete(id);
		}
		this.rpcClients.delete(id);
		const stoppedState = this.states.get(id);
		if (stoppedState) {
			const next = { ...stoppedState, status: "stopped" as const, tools: [] };
			delete next.pid;
			this.states.set(id, next);
			this.emit("state-changed", this.getAllStates());
		}
	}

	getState(id: string): McpServerState {
		const state = this.states.get(id);
		if (!state) throw new Error(`Unknown MCP server: ${id}`);
		return state;
	}

	getAllStates(): McpServerState[] {
		return Array.from(this.states.values());
	}

	async callTool(
		serverId: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		const state = this.states.get(serverId);
		if (!state) throw new Error(`Unknown MCP server: ${serverId}`);
		if (state.status !== "connected") {
			throw new Error(`Server ${serverId} is not connected`);
		}

		const { config } = state;

		if (config.transport === "stdio") {
			const rpc = this.rpcClients.get(serverId);
			if (!rpc) throw new Error(`No RPC client for server: ${serverId}`);
			return rpc.request("tools/call", { name: toolName, arguments: args });
		}

		// HTTP/SSE: POST JSON-RPC to the URL
		if (!config.url) throw new Error("Remote server has no URL");
		const resp = await fetch(config.url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: toolName, arguments: args },
			}),
			signal: AbortSignal.timeout(30000),
		});

		const data = (await resp.json()) as JsonRpcResponse;
		if (data.error) throw new Error(data.error.message);
		return data.result as ToolsCallResult;
	}
}

// Singleton per company
const instances = new Map<string, McpManager>();

export function getMcpManager(companyId?: string | null): McpManager {
	const key = companyId?.trim() || "__default__";
	let instance = instances.get(key);
	if (!instance) {
		instance = new McpManager(companyId);
		instances.set(key, instance);
	}
	return instance;
}
