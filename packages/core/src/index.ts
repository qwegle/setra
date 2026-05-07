/**
 * SetraCore — the zero-feature engine.
 *
 * Core responsibilities:
 *   - EventBus: typed pub/sub for all inter-module communication
 *   - ModuleRegistry: discover, load, sort by dependency, init, teardown
 *   - ConfigStore: typed settings singleton (Zod-validated)
 *   - Lifecycle: boot() → teardown() with clean signal handling
 *
 * Rule: this file has NO feature code. All feature code lives in modules.
 * Modules call core.register() during their register() phase.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SetraEvent =
	| { type: "run:started"; runId: string; plotId: string }
	| { type: "run:output"; runId: string; seq: number; data: string }
	| { type: "run:cost"; runId: string; costUsd: number; tokens: TokenSummary }
	| { type: "run:finished"; runId: string; exitCode: number }
	| { type: "run:ratelimit"; runId: string; model: string }
	| { type: "plot:created"; plotId: string }
	| { type: "plot:deleted"; plotId: string }
	| { type: "mark:created"; plotId: string; sha: string; message: string }
	| { type: "trace:saved"; plotId: string; traceId: string }
	| { type: "ground:online"; groundId: string }
	| { type: "ground:offline"; groundId: string }
	| { type: "module:loaded"; moduleId: string }
	| { type: "module:failed"; moduleId: string; error: string };

export interface TokenSummary {
	promptTokens: number;
	completionTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export interface IModuleContext {
	events: IEventBus;
	config: IConfigStore;
	dataDir: string; // ~/.setra/modules/<moduleId>/
	log: ILogger;
}

export interface IEventBus {
	emit<T extends SetraEvent>(event: T): void;
	on<K extends SetraEvent["type"]>(
		type: K,
		handler: (event: Extract<SetraEvent, { type: K }>) => void,
	): () => void; // returns unsubscribe fn
	once<K extends SetraEvent["type"]>(
		type: K,
		handler: (event: Extract<SetraEvent, { type: K }>) => void,
	): void;
}

export interface IConfigStore {
	get<T>(key: string, fallback: T): T;
	set(key: string, value: unknown): void;
	getAll(): Record<string, unknown>;
}

export interface ILogger {
	info(msg: string, meta?: Record<string, unknown>): void;
	warn(msg: string, meta?: Record<string, unknown>): void;
	error(msg: string, meta?: Record<string, unknown>): void;
	debug(msg: string, meta?: Record<string, unknown>): void;
}

export interface SetraModule {
	id: string;
	displayName: string;
	version: string;
	deps?: string[]; // other module ids this one depends on

	/** Sync, no I/O. Register contribution points into the core. */
	register(core: SetraCore): void;

	/** Async. Start background work, open DB connections, etc. */
	init(ctx: IModuleContext): Promise<void>;

	/** Graceful shutdown. Called in reverse dep order. */
	teardown(): Promise<void>;
}

// ─── EventBus ────────────────────────────────────────────────────────────────

class EventBus implements IEventBus {
	private emitter = new EventEmitter();

	emit<T extends SetraEvent>(event: T): void {
		this.emitter.emit(event.type, event);
		this.emitter.emit("*", event);
	}

	on<K extends SetraEvent["type"]>(
		type: K,
		handler: (event: Extract<SetraEvent, { type: K }>) => void,
	): () => void {
		const h = handler as (e: unknown) => void;
		this.emitter.on(type, h);
		return () => this.emitter.off(type, h);
	}

	once<K extends SetraEvent["type"]>(
		type: K,
		handler: (event: Extract<SetraEvent, { type: K }>) => void,
	): void {
		this.emitter.once(type, handler as (e: unknown) => void);
	}

	onAny(handler: (event: SetraEvent) => void): () => void {
		const h = handler as (e: unknown) => void;
		this.emitter.on("*", h);
		return () => this.emitter.off("*", h);
	}
}

// ─── ConfigStore ─────────────────────────────────────────────────────────────

class ConfigStore implements IConfigStore {
	private store: Record<string, unknown> = {};

	get<T>(key: string, fallback: T): T {
		return key in this.store ? (this.store[key] as T) : fallback;
	}

	set(key: string, value: unknown): void {
		this.store[key] = value;
	}

	getAll(): Record<string, unknown> {
		return { ...this.store };
	}

	load(obj: Record<string, unknown>): void {
		Object.assign(this.store, obj);
	}
}

// ─── Logger ──────────────────────────────────────────────────────────────────

class ConsoleLogger implements ILogger {
	constructor(private prefix: string) {}

	private fmt(
		level: string,
		msg: string,
		meta?: Record<string, unknown>,
	): string {
		const ts = new Date().toISOString();
		const base = `[${ts}] [${level.toUpperCase()}] [${this.prefix}] ${msg}`;
		return meta ? `${base} ${JSON.stringify(meta)}` : base;
	}

	info(msg: string, meta?: Record<string, unknown>): void {
		console.log(this.fmt("info", msg, meta));
	}
	warn(msg: string, meta?: Record<string, unknown>): void {
		console.warn(this.fmt("warn", msg, meta));
	}
	error(msg: string, meta?: Record<string, unknown>): void {
		console.error(this.fmt("err", msg, meta));
	}
	debug(msg: string, meta?: Record<string, unknown>): void {
		if (process.env["SETRA_DEBUG"]) console.debug(this.fmt("debug", msg, meta));
	}
}

// ─── SetraCore ────────────────────────────────────────────────────────────────

export class SetraCore {
	readonly events: IEventBus = new EventBus();
	readonly config: IConfigStore = new ConfigStore();

	private modules = new Map<string, SetraModule>();
	private initOrder: string[] = []; // topologically sorted
	private log = new ConsoleLogger("core");

	// contribution point registries (modules push INTO these)
	readonly ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
	readonly menuItems = new Map<string, unknown>();
	readonly trayItems = new Map<string, unknown>();

	// ── Module registration ─────────────────────────────────────────────────

	registerModule(mod: SetraModule): void {
		if (this.modules.has(mod.id)) {
			throw new Error(`Module "${mod.id}" already registered`);
		}
		this.modules.set(mod.id, mod);
	}

	// ── IPC contribution point ──────────────────────────────────────────────

	registerIpc(channel: string, handler: (...args: unknown[]) => unknown): void {
		this.ipcHandlers.set(channel, handler);
	}

	// ── Boot sequence ───────────────────────────────────────────────────────

	async boot(): Promise<void> {
		this.log.info("booting", { modules: [...this.modules.keys()] });

		// 1. Topological sort
		this.initOrder = this.topoSort();

		// 2. register() phase — sync, no I/O
		for (const id of this.initOrder) {
			const mod = this.modules.get(id)!;
			try {
				mod.register(this);
				this.log.debug("registered", { id });
			} catch (e) {
				this.events.emit({
					type: "module:failed",
					moduleId: id,
					error: String(e),
				});
				throw e;
			}
		}

		// 3. init() phase — async, parallel groups
		for (const id of this.initOrder) {
			const mod = this.modules.get(id)!;
			const ctx = this.makeContext(id);
			try {
				await mod.init(ctx);
				this.events.emit({ type: "module:loaded", moduleId: id });
				this.log.info("init ok", { id });
			} catch (e) {
				this.events.emit({
					type: "module:failed",
					moduleId: id,
					error: String(e),
				});
				throw e;
			}
		}

		this.log.info("boot complete");

		// 4. Graceful shutdown hooks
		const shutdown = async (sig: string) => {
			this.log.info("shutting down", { sig });
			await this.teardown();
			process.exit(0);
		};
		process.once("SIGINT", () => {
			void shutdown("SIGINT");
		});
		process.once("SIGTERM", () => {
			void shutdown("SIGTERM");
		});
	}

	async teardown(): Promise<void> {
		// Reverse init order
		const order = [...this.initOrder].reverse();
		for (const id of order) {
			const mod = this.modules.get(id)!;
			try {
				await mod.teardown();
				this.log.debug("teardown ok", { id });
			} catch (e) {
				this.log.error("teardown failed", { id, error: String(e) });
			}
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────────────

	private makeContext(moduleId: string): IModuleContext {
		const dataDir = path.join(os.homedir(), ".setra", "modules", moduleId);
		fs.mkdirSync(dataDir, { recursive: true });
		return {
			events: this.events,
			config: this.config,
			dataDir,
			log: new ConsoleLogger(moduleId),
		};
	}

	private topoSort(): string[] {
		const visited = new Set<string>();
		const result: string[] = [];

		const visit = (id: string, chain = new Set<string>()) => {
			if (visited.has(id)) return;
			if (chain.has(id))
				throw new Error(`Circular dependency: ${[...chain, id].join(" → ")}`);
			chain.add(id);

			const mod = this.modules.get(id);
			if (!mod) throw new Error(`Unknown module "${id}"`);

			for (const dep of mod.deps ?? []) visit(dep, new Set(chain));
			visited.add(id);
			result.push(id);
		};

		for (const id of this.modules.keys()) visit(id);
		return result;
	}
}

// ── Singleton factory (one per process) ────────────────────────────────────────

let _core: SetraCore | undefined;

export function getCore(): SetraCore {
	if (!_core) _core = new SetraCore();
	return _core;
}

export function resetCore(): void {
	_core = undefined;
}

export * from "./user-profile.js";
export * from "./integrations.js";
