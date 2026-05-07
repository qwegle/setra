/**
 * Shared types for the agent-runner package.
 * These are lightweight runtime types. The full Zod-validated schemas
 * live in @setra/types — import from there in application code.
 */

// ─── Token accounting ─────────────────────────────────────────────────────────

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	/** Tokens read from Anthropic prompt cache (charged at 0.1×). */
	cacheReadTokens: number;
	/** Tokens written into Anthropic prompt cache (charged at 1.25×). */
	cacheWriteTokens: number;
}

export function totalTokens(u: TokenUsage): number {
	return u.promptTokens + u.completionTokens;
}

export const ZERO_USAGE: TokenUsage = {
	promptTokens: 0,
	completionTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
};

// ─── Spawn options ────────────────────────────────────────────────────────────

/**
 * What the runner needs to launch an agent process (local PTY or remote SSH).
 * `env` is merged on top of the parent process env — pass only what needs
 * to be set or overridden, not the full environment.
 */
export interface SpawnOptions {
	/** Binary to execute, e.g. "claude" or "gemini". Must be on PATH. */
	cmd: string;
	/** Command-line arguments. Task/prompt is always the last element. */
	args: string[];
	/**
	 * Extra env vars to inject (merged with parent env at spawn time).
	 * Use undefined values to *unset* a variable in the child process.
	 */
	env: Record<string, string | undefined>;
	/** Working directory — the plot's git worktree path. */
	cwd: string;
}

// ─── Domain types (lightweight versions of @setra/types schemas) ──────────────

/**
 * A Plot is setra's term for an isolated agent workspace.
 * Each plot has its own git worktree and branch.
 */
export interface Plot {
	id: string;
	name: string;
	/** Absolute path to this plot's git worktree on disk. */
	worktreePath: string;
	/** The branch this plot operates on, e.g. "setra/plot-abc123". */
	branch: string;
	/** Optional plot-level agent override (overrides user default). */
	defaultAgent?: string;
	/** Optional plot-level model override (overrides agent default). */
	defaultModel?: string;
	/** Hard cost ceiling in USD for this plot. */
	budgetUsd?: number;
}

/**
 * A Run is a single agent invocation within a plot.
 * Corresponds to a row in the `runs` SQLite table.
 */
export interface Run {
	id: string;
	plotId: string;
	/** Agent adapter name, e.g. "claude", "gemini", "ollama". */
	agent: string;
	/**
	 * Model identifier, e.g. "claude-sonnet-4-5" or "auto".
	 * "auto" means let the adapter pick its defaultModel.
	 */
	model: string;
	/** Natural language task description sent to the agent. */
	task: string;
	/** Hard cost ceiling for this specific run in USD. */
	budgetUsd?: number;
	/** Maximum agent turns (default per adapter). */
	maxTurns?: number;
	/**
	 * Appended to the agent's system prompt for this run only.
	 * Use for per-run instructions, not persistent config.
	 */
	systemPromptAppend?: string;
}

// ─── Cost ledger entry (for small-model tasks) ────────────────────────────────

export type SmallModelTask =
	| "branch_name"
	| "run_title"
	| "trace_summary"
	| "cold_start_analysis";

export type SmallModelProvider = "anthropic" | "openai" | "ollama" | "none";

export interface SmallModelCostEntry {
	task: SmallModelTask;
	provider: SmallModelProvider;
	model: string;
	promptTokens: number;
	completionTokens: number;
	costUsd: number;
	runId?: string;
	plotId?: string;
	createdAt: Date;
}
