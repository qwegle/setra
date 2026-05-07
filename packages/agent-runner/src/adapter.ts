/**
 * AgentAdapter interface
 *
 * Every model integration — CLI wrapper or direct API — implements this.
 * RULE: Never add agent-specific conditionals outside of an adapter file.
 *       New agent = new adapter file. Nothing else changes.
 *
 * The adapter is a pure value object. It produces data (commands, parsed
 * output). All side effects (spawning, tmux, SSH) live in local-pty.ts
 * and ssh-pty.ts.
 */

import type { Plot, Run, SpawnOptions, TokenUsage } from "./types.js";

export type { Plot, Run, SpawnOptions, TokenUsage };

// ─── Core interface ───────────────────────────────────────────────────────────

export interface AgentAdapter {
	/** Unique key matching the `agent` column in the `runs` table. */
	readonly name: string;

	/** Human-readable name shown in the model selector UI. */
	readonly displayName: string;

	/**
	 * All model IDs this adapter accepts.
	 * Include "auto" if the adapter supports letting the provider choose.
	 */
	readonly supportsModels: readonly string[];

	/**
	 * The model used when run.model is "auto" or unknown.
	 * Must be a member of supportsModels.
	 */
	readonly defaultModel: string;

	/**
	 * Returns true if the adapter can run on the current machine.
	 * For CLI adapters: checks that the binary is on PATH.
	 * For API adapters: checks that the required env var is set.
	 * For local adapters: checks connectivity (e.g. Ollama health endpoint).
	 * This is called during the availability check in onboarding and Settings.
	 */
	isAvailable(): Promise<boolean>;

	/**
	 * Build the spawn options (binary + args + env + cwd) for this run.
	 * Called by local-pty.ts and ssh-pty.ts immediately before spawning.
	 *
	 * @param plot   The plot (worktree path, budget, etc.)
	 * @param run    The run (task, model, maxTurns, etc.)
	 * @param mcpConfigPath  Absolute path to the per-plot MCP config JSON
	 */
	buildCommand(plot: Plot, run: Run, mcpConfigPath: string): SpawnOptions;

	/**
	 * Extract token usage from a chunk of PTY output.
	 * Called continuously as output streams in.
	 * Return null if no token data found in this chunk.
	 */
	parseTokenUsage(output: string): TokenUsage | null;

	/**
	 * Extract cost in USD from a chunk of PTY output.
	 * Return null if no cost data found in this chunk.
	 */
	parseCostUSD(output: string): number | null;

	/**
	 * Return true if the output chunk contains a rate-limit signal.
	 * When true, the fallback chain takes over (see fallback-chain.ts).
	 */
	detectRateLimit(output: string): boolean;

	/**
	 * Return true if the output chunk signals the agent has finished.
	 * Used to update run status to "completed" without waiting for process exit.
	 */
	detectCompletion(output: string): boolean;

	/**
	 * Return the CLI args needed to inject a system prompt.
	 * E.g. ["--append-system-prompt", "<text>"] for Claude Code.
	 * Return [] if the adapter doesn't support system prompt injection via CLI.
	 */
	buildSystemPromptArgs(systemPrompt: string): string[];

	/**
	 * Return the CLI args needed to pass an MCP config file to the agent.
	 * E.g. ["--mcp-config", "/path/to/config.json"] for Claude Code.
	 * Return [] if the adapter manages MCP configuration via env vars or other means.
	 */
	buildMcpArgs(mcpConfigPath: string): string[];
}

// ─── Registry of all registered adapters ─────────────────────────────────────

const _registry = new Map<string, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter): void {
	if (_registry.has(adapter.name)) {
		throw new Error(`AgentAdapter "${adapter.name}" is already registered`);
	}
	_registry.set(adapter.name, adapter);
}

export function getAdapter(name: string): AgentAdapter | undefined {
	return _registry.get(name);
}

export function getAllAdapters(): AgentAdapter[] {
	return Array.from(_registry.values());
}

/**
 * Returns the adapter to use for a run, falling back to the "claude" adapter
 * if the requested adapter is not registered or unavailable.
 */
export async function resolveAdapter(agentName: string): Promise<AgentAdapter> {
	const adapter = _registry.get(agentName);
	if (adapter && (await adapter.isAvailable())) return adapter;

	// Try the default
	const fallback = _registry.get("claude");
	if (fallback && (await fallback.isAvailable())) return fallback;

	throw new Error(
		`No available adapter for agent "${agentName}" and the "claude" fallback is also unavailable.`,
	);
}
