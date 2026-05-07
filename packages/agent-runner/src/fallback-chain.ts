/**
 * FALLBACK CHAIN SYSTEM
 *
 * When an agent run hits a rate limit or becomes unavailable, the fallback
 * chain automatically switches to the next adapter in the user's configured
 * chain and restarts the run in the same tmux session.
 *
 * Default chains:
 *   claude  → gemini → opencode → ollama/llama3.2
 *   codex   → claude → gemini
 *   gemini  → claude → codex
 *   ollama  → claude → codex
 *
 * Users can customize their chains in Settings → Agents → Fallback.
 *
 * Detection sources (checked in order):
 *   1. PTY output patterns (rate limit messages, error text)
 *   2. Process exit code non-zero
 *   3. Stderr patterns
 *
 * On fallback:
 *   1. Detect → emit 'fallback:triggered' event
 *   2. Save the current task context
 *   3. Select next adapter in chain
 *   4. Restart the tmux session with new adapter command
 *   5. Notify user via Electron notification + status bar update
 *   6. Log the fallback event to the run record
 */

import { EventEmitter } from "events";
import type { AgentAdapter } from "./adapter.js";
import { getAdapter, getAllAdapters } from "./adapter.js";
import type { Plot, Run } from "./types.js";

// ─── Rate-limit detection ─────────────────────────────────────────────────────

/**
 * Universal rate-limit patterns that apply regardless of adapter.
 * Adapter-specific patterns are in each adapter file.
 */
export const UNIVERSAL_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/overloaded/i,
	/quota\s+exceeded/i,
	/try\s+again\s+later/i,
	/too\s+many\s+requests/i,
	/service\s+unavailable/i,
	/\b503\b/,
	/capacity/i,
	/resource\s+exhausted/i,
] as const;

/**
 * Detect a rate limit from any combination of output text and exit code.
 * The adapter's own detectRateLimit() is authoritative, but this provides
 * a fallback if the adapter doesn't recognize the pattern.
 */
export function detectRateLimit(
	adapter: AgentAdapter,
	output: string,
	exitCode?: number,
): boolean {
	// Adapter-specific check first (highest confidence)
	if (adapter.detectRateLimit(output)) return true;

	// Universal patterns (catches generic HTTP error text)
	if (UNIVERSAL_RATE_LIMIT_PATTERNS.some((p) => p.test(output))) return true;

	// Exit code 1 alone is NOT a rate limit — could be any error.
	// Exit code specifically mapped by adapters (e.g., some CLIs use 2 for rate limit):
	if (exitCode === 2 && adapter.name === "gemini") return true;

	return false;
}

// ─── Fallback chain configuration ─────────────────────────────────────────────

export type FallbackChainMap = Record<string, string[]>;

/**
 * Default fallback chains.
 * Entries are adapter names in priority order.
 * Chains can reference any registered adapter.
 */
export const DEFAULT_FALLBACK_CHAINS: FallbackChainMap = {
	claude: ["gemini", "opencode", "ollama"],
	codex: ["claude", "gemini", "ollama"],
	gemini: ["claude", "codex", "ollama"],
	opencode: ["claude", "gemini", "ollama"],
	amp: ["claude", "gemini"],
	"anthropic-api": ["openai-api", "ollama"],
	"openai-api": ["anthropic-api", "ollama"],
	ollama: ["claude", "codex"],
	"custom-openai": ["claude", "gemini"],
} as const;

// ─── Fallback events ──────────────────────────────────────────────────────────

export interface FallbackEvent {
	runId: string;
	plotId: string;
	fromAdapter: string;
	toAdapter: string;
	reason: "rate_limit" | "unavailable" | "error";
	outputSnippet: string;
	timestamp: Date;
}

// ─── FallbackChain class ──────────────────────────────────────────────────────

export class FallbackChain extends EventEmitter {
	private chains: FallbackChainMap;

	constructor(chains: FallbackChainMap = DEFAULT_FALLBACK_CHAINS) {
		super();
		this.chains = chains;
	}

	/**
	 * Update the chain for a specific adapter (from user Settings).
	 */
	setChain(adapterId: string, chain: string[]): void {
		this.chains[adapterId] = chain;
	}

	/**
	 * Get the ordered fallback sequence for an adapter.
	 * Returns an empty array if no chain is configured.
	 */
	getChain(adapterId: string): string[] {
		return this.chains[adapterId] ?? [];
	}

	/**
	 * Select the next available adapter in the fallback chain.
	 * Skips adapters that are not registered or not available.
	 *
	 * @param currentAdapterId  The adapter that just failed
	 * @param alreadyTried      Set of adapter names tried in this run's fallback sequence
	 */
	async selectNext(
		currentAdapterId: string,
		alreadyTried = new Set<string>([currentAdapterId]),
	): Promise<AgentAdapter | null> {
		const chain = this.getChain(currentAdapterId);

		for (const candidateId of chain) {
			if (alreadyTried.has(candidateId)) continue;

			const candidate = getAdapter(candidateId);
			if (!candidate) continue;

			const available = await candidate.isAvailable();
			if (available) return candidate;

			// Not available — mark as tried and continue
			alreadyTried.add(candidateId);
		}

		return null; // Chain exhausted
	}

	/**
	 * Execute the fallback: select the next adapter, rebuild the command,
	 * and return the new spawn info so the PTY runner can restart.
	 *
	 * Emits 'fallback:triggered' with a FallbackEvent.
	 * Emits 'fallback:exhausted' if no adapter is available in the chain.
	 */
	async trigger(opts: {
		run: Run;
		plot: Plot;
		mcpConfigPath: string;
		currentAdapter: AgentAdapter;
		outputSnippet: string;
		reason: FallbackEvent["reason"];
		alreadyTried?: Set<string>;
	}): Promise<{
		adapter: AgentAdapter;
		spawnOptions: ReturnType<AgentAdapter["buildCommand"]>;
	} | null> {
		const alreadyTried =
			opts.alreadyTried ?? new Set([opts.currentAdapter.name]);
		const next = await this.selectNext(opts.currentAdapter.name, alreadyTried);

		if (!next) {
			this.emit("fallback:exhausted", {
				runId: opts.run.id,
				plotId: opts.plot.id,
				fromAdapter: opts.currentAdapter.name,
				alreadyTried: [...alreadyTried],
			});
			return null;
		}

		const event: FallbackEvent = {
			runId: opts.run.id,
			plotId: opts.plot.id,
			fromAdapter: opts.currentAdapter.name,
			toAdapter: next.name,
			reason: opts.reason,
			outputSnippet: opts.outputSnippet.slice(-500), // last 500 chars
			timestamp: new Date(),
		};

		this.emit("fallback:triggered", event);

		// Rebuild the run with the new agent name
		const updatedRun: Run = {
			...opts.run,
			agent: next.name,
			// If the new adapter supports the same model, keep it. Otherwise use default.
			model: next.supportsModels.includes(opts.run.model as never)
				? opts.run.model
				: next.defaultModel,
		};

		const spawnOptions = next.buildCommand(
			opts.plot,
			updatedRun,
			opts.mcpConfigPath,
		);

		return { adapter: next, spawnOptions };
	}
}

// ─── Global singleton ─────────────────────────────────────────────────────────

export const fallbackChain = new FallbackChain();

// ─── PTY output monitor ───────────────────────────────────────────────────────

/**
 * Stateful monitor that wraps a PTY output stream and triggers fallback
 * when rate limits are detected.
 *
 * Usage (in local-pty.ts):
 *   const monitor = createRateLimitMonitor({ adapter, run, plot, mcpConfigPath });
 *   ptyProcess.onData(chunk => {
 *     const action = monitor.feed(chunk);
 *     if (action?.type === 'fallback') {
 *       // restart tmux with action.spawnOptions
 *     }
 *   });
 */
export interface RateLimitMonitorOptions {
	adapter: AgentAdapter;
	run: Run;
	plot: Plot;
	mcpConfigPath: string;
	chain?: FallbackChain;
}

export interface FallbackAction {
	type: "fallback";
	event: FallbackEvent;
	adapter: AgentAdapter;
	spawnOptions: ReturnType<AgentAdapter["buildCommand"]>;
}

export function createRateLimitMonitor(opts: RateLimitMonitorOptions) {
	const chain = opts.chain ?? fallbackChain;
	const alreadyTried = new Set([opts.adapter.name]);
	let currentAdapter = opts.adapter;
	let triggered = false;
	let buffer = "";

	return {
		get currentAdapter() {
			return currentAdapter;
		},

		/**
		 * Feed a chunk of PTY output. Returns a FallbackAction if
		 * a fallback should be triggered, null otherwise.
		 */
		async feed(chunk: string): Promise<FallbackAction | null> {
			if (triggered) return null;

			buffer += chunk;
			// Keep last 2KB of output for rate-limit detection
			if (buffer.length > 2048) buffer = buffer.slice(-2048);

			const isRateLimit = detectRateLimit(currentAdapter, buffer);
			if (!isRateLimit) return null;

			triggered = true;

			const result = await chain.trigger({
				run: opts.run,
				plot: opts.plot,
				mcpConfigPath: opts.mcpConfigPath,
				currentAdapter,
				outputSnippet: buffer,
				reason: "rate_limit",
				alreadyTried,
			});

			if (!result) return null;

			// Update state for the next potential fallback in the same run
			alreadyTried.add(result.adapter.name);
			currentAdapter = result.adapter;
			triggered = false;
			buffer = "";

			const event: FallbackEvent = {
				runId: opts.run.id,
				plotId: opts.plot.id,
				fromAdapter: opts.adapter.name,
				toAdapter: result.adapter.name,
				reason: "rate_limit",
				outputSnippet: buffer,
				timestamp: new Date(),
			};

			return { type: "fallback", event, ...result };
		},

		reset(): void {
			triggered = false;
			buffer = "";
		},

		/**
		 * List all adapters in the current fallback chain, for display in the UI.
		 */
		getChainDisplay(): string[] {
			return [opts.adapter.name, ...chain.getChain(opts.adapter.name)];
		},
	};
}

// ─── Availability check (used in Settings and onboarding) ────────────────────

export interface AdapterStatus {
	name: string;
	displayName: string;
	available: boolean;
	reason?: string;
}

/**
 * Check all registered adapters and return their availability status.
 * Used in the Settings → Agents panel to show which tools are installed.
 */
export async function checkAllAdapters(): Promise<AdapterStatus[]> {
	const adapters = getAllAdapters();

	const results = await Promise.allSettled(
		adapters.map(async (a): Promise<AdapterStatus> => {
			try {
				const available = await a.isAvailable();
				const status: AdapterStatus = {
					name: a.name,
					displayName: a.displayName,
					available,
				};
				if (!available) status.reason = getUnavailableReason(a.name);
				return status;
			} catch (err) {
				return {
					name: a.name,
					displayName: a.displayName,
					available: false,
					reason: err instanceof Error ? err.message : "Unknown error",
				};
			}
		}),
	);

	return results.map((r) =>
		r.status === "fulfilled"
			? r.value
			: { name: "unknown", displayName: "Unknown", available: false },
	);
}

function getUnavailableReason(adapterName: string): string {
	const cliAdapters = new Set(["claude", "gemini", "codex", "opencode", "amp"]);
	const apiAdapters: Record<string, string> = {
		"anthropic-api": "ANTHROPIC_API_KEY not set",
		"openai-api": "OPENAI_API_KEY not set",
		"custom-openai": "CUSTOM_OPENAI_API_KEY or OPENAI_API_KEY not set",
	};

	if (cliAdapters.has(adapterName)) {
		return `"${adapterName}" binary not found in PATH. Install it first.`;
	}
	if (adapterName === "ollama") {
		return "Ollama is not running. Start with: ollama serve";
	}
	return apiAdapters[adapterName] ?? "Not configured";
}
