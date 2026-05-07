/**
 * SMALL MODEL PATTERN
 *
 * Inspired by Superset's small-model approach (get-small-model.ts).
 * Extended with Ollama fallback and a ledger-aware cost logger.
 *
 * Use the small model for cheap, fast, single-turn tasks:
 *   - Branch name generation       ~$0.00025/call (Haiku)
 *   - Run title generation         ~$0.00010/call (Haiku)
 *   - Trace summary                ~$0.00025/call (Haiku)
 *   - Cold-start codebase analysis ~$0.00080/call (Haiku, longer input)
 *
 * Resolution order:
 *   1. ANTHROPIC_API_KEY set  → claude-haiku-4-5-20251001 (direct SDK)
 *   2. OPENAI_API_KEY set     → gpt-4o-mini (direct SDK)
 *   3. Ollama running         → llama3.2 (local, free)
 *   4. None available         → skip gracefully (task returns null)
 *
 * Cost is logged to the ledger after every call. This is the data that
 * powers the "small model overhead" row in the Ledger dashboard.
 */

import { callAnthropicOnce } from "./adapters/anthropic-api.js";
import { callOllamaOnce, checkOllamaHealth } from "./adapters/ollama.js";
import { callOpenAiOnce } from "./adapters/openai-api.js";
import type {
	SmallModelCostEntry,
	SmallModelProvider,
	SmallModelTask,
} from "./types.js";

// ─── Provider resolution ──────────────────────────────────────────────────────

/** Pinned model IDs for reproducibility in traces and cost comparison. */
const SMALL_MODEL_IDS: Record<Exclude<SmallModelProvider, "none">, string> = {
	anthropic: "claude-haiku-4-5-20251001",
	openai: "gpt-4o-mini",
	ollama: "llama3.2",
} as const;

let _resolvedProvider: SmallModelProvider | null = null;

/**
 * Resolve the provider once per process lifetime and cache.
 * The resolution is deterministic within a session:
 *   env vars don't change at runtime, and Ollama state is assumed stable.
 */
export async function resolveSmallModelProvider(): Promise<SmallModelProvider> {
	if (_resolvedProvider !== null) return _resolvedProvider;

	if (process.env["ANTHROPIC_API_KEY"]) {
		_resolvedProvider = "anthropic";
		return _resolvedProvider;
	}
	if (process.env["OPENAI_API_KEY"]) {
		_resolvedProvider = "openai";
		return _resolvedProvider;
	}
	if (await checkOllamaHealth()) {
		_resolvedProvider = "ollama";
		return _resolvedProvider;
	}

	_resolvedProvider = "none";
	return _resolvedProvider;
}

/** Reset the cached provider (useful in tests or after env changes). */
export function resetSmallModelProviderCache(): void {
	_resolvedProvider = null;
}

// ─── Core call ────────────────────────────────────────────────────────────────

interface SmallModelCallOptions {
	systemPrompt: string;
	userMessage: string;
	maxTokens?: number;
	task: SmallModelTask;
	runId?: string;
	plotId?: string;
	/** Called after every successful call to persist cost to the ledger. */
	onCost?: (entry: SmallModelCostEntry) => void | Promise<void>;
}

interface SmallModelResult {
	content: string;
	provider: SmallModelProvider;
	model: string;
	costEntry: SmallModelCostEntry;
}

/**
 * Core entry point. Resolves provider, calls the model, logs cost.
 * Returns null if no provider is available (graceful degradation).
 */
export async function callSmallModel(
	opts: SmallModelCallOptions,
): Promise<SmallModelResult | null> {
	const provider = await resolveSmallModelProvider();
	if (provider === "none") return null;

	const model = SMALL_MODEL_IDS[provider];
	const maxTokens = opts.maxTokens ?? 256;

	let content: string;
	let promptTokens: number;
	let completionTokens: number;
	let costUsd: number;

	switch (provider) {
		case "anthropic": {
			const r = await callAnthropicOnce(
				model,
				opts.systemPrompt,
				opts.userMessage,
				maxTokens,
			);
			content = r.content;
			promptTokens = r.usage.promptTokens;
			completionTokens = r.usage.completionTokens;
			costUsd = r.costUsd;
			break;
		}

		case "openai": {
			const r = await callOpenAiOnce(
				model,
				opts.systemPrompt,
				opts.userMessage,
				maxTokens,
			);
			content = r.content;
			promptTokens = r.usage.promptTokens;
			completionTokens = r.usage.completionTokens;
			costUsd = r.costUsd;
			break;
		}

		case "ollama": {
			const r = await callOllamaOnce(
				model,
				opts.systemPrompt,
				opts.userMessage,
				maxTokens,
			);
			content = r.content;
			promptTokens = r.usage.promptTokens;
			completionTokens = r.usage.completionTokens;
			costUsd = 0;
			break;
		}
	}

	const costEntry: SmallModelCostEntry = {
		task: opts.task,
		provider,
		model,
		promptTokens,
		completionTokens,
		costUsd,
		createdAt: new Date(),
		...(opts.runId !== undefined && { runId: opts.runId }),
		...(opts.plotId !== undefined && { plotId: opts.plotId }),
	};

	await opts.onCost?.(costEntry);

	return { content, provider, model, costEntry };
}

// ─── Task-specific helpers ────────────────────────────────────────────────────

/**
 * Generate a kebab-case git branch name from a task description.
 * Output: max 40 chars, lowercase, hyphens only.
 * Cost: ~$0.00010/call with Haiku.
 */
export async function generateBranchName(
	task: string,
	opts?: Pick<SmallModelCallOptions, "runId" | "plotId" | "onCost">,
): Promise<string | null> {
	const result = await callSmallModel({
		task: "branch_name",
		systemPrompt: [
			"You are a git branch name generator.",
			"Output ONLY a single kebab-case branch name, max 40 characters.",
			'Rules: lowercase, hyphens only, no special characters, no "setra/" prefix.',
			"Examples: fix-auth-token-refresh, add-csv-export, refactor-db-schema",
		].join("\n"),
		userMessage: `Task: ${task}`,
		maxTokens: 32,
		...opts,
	});

	if (!result) return null;

	// Sanitize: strip any quotes, whitespace, ensure kebab-case, truncate
	return result.content
		.trim()
		.replace(/['"]/g, "")
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.slice(0, 40);
}

/**
 * Generate a concise title for a run from its task description.
 * Output: max 60 chars, Title Case.
 * Cost: ~$0.00005/call with Haiku.
 */
export async function generateRunTitle(
	task: string,
	opts?: Pick<SmallModelCallOptions, "runId" | "plotId" | "onCost">,
): Promise<string | null> {
	const result = await callSmallModel({
		task: "run_title",
		systemPrompt: [
			"You are a task title generator.",
			"Output ONLY a short title in Title Case, max 60 characters.",
			"No quotes. No punctuation at the end.",
			'Examples: "Fix Auth Token Refresh", "Add CSV Export to Reports", "Refactor Database Schema"',
		].join("\n"),
		userMessage: `Task: ${task}`,
		maxTokens: 24,
		...opts,
	});

	if (!result) return null;

	return result.content.trim().replace(/['"]/g, "").slice(0, 60);
}

/**
 * Summarize a run transcript (PTY output) into a structured session summary.
 * Used to populate .setra/runs/<timestamp>.md and the trace store.
 * Cost: ~$0.00025/call with Haiku (assuming ~400 token input).
 *
 * @param transcript  The PTY output string (stripped of ANSI codes)
 */
export async function generateTraceSummary(
	transcript: string,
	opts?: Pick<SmallModelCallOptions, "runId" | "plotId" | "onCost">,
): Promise<string | null> {
	// Truncate transcript to avoid hitting context limits on small models.
	// 8,000 chars ≈ 2,000 tokens, which fits Haiku's context well.
	const truncated =
		transcript.length > 8_000
			? `[...truncated, showing last 8000 chars...]\n${transcript.slice(-8_000)}`
			: transcript;

	const result = await callSmallModel({
		task: "trace_summary",
		systemPrompt: [
			"You are a technical session summarizer.",
			"Summarize the AI coding session transcript below in exactly 3 sections.",
			"Use Markdown. Each section max 3 sentences. Total response: max 200 words.",
			"",
			"## What was accomplished",
			"## Current state",
			"## Key files changed (list with one-line description each)",
		].join("\n"),
		userMessage: `Session transcript:\n\n${truncated}`,
		maxTokens: 512,
		...opts,
	});

	return result?.content ?? null;
}

/**
 * Analyze a codebase on first import (cold-start analysis).
 * Inputs: package.json + README excerpt + recent git log.
 * Output: structured codebase context injected into every future run.
 * Cost: ~$0.00080/call with Haiku (longer input, ~1000 tokens).
 *
 * From the blueprint: "Even session 1 gets relevant context.
 * Cold start problem eliminated."
 */
export async function generateColdStartAnalysis(
	files: {
		packageJson?: string;
		readme?: string;
		gitLog?: string;
		topLevelDirs?: string[];
	},
	opts?: Pick<SmallModelCallOptions, "plotId" | "onCost">,
): Promise<string | null> {
	const sections: string[] = [];

	if (files.packageJson)
		sections.push(`package.json:\n\`\`\`json\n${files.packageJson}\n\`\`\``);
	if (files.readme)
		sections.push(
			`README (first 2000 chars):\n${files.readme.slice(0, 2_000)}`,
		);
	if (files.gitLog) sections.push(`Recent git log:\n${files.gitLog}`);
	if (files.topLevelDirs?.length) {
		sections.push(`Top-level directories: ${files.topLevelDirs.join(", ")}`);
	}

	const result = await callSmallModel({
		task: "cold_start_analysis",
		systemPrompt: [
			"You are a codebase analyzer for an AI coding assistant.",
			"Analyze the provided codebase context and extract exactly 4 sections.",
			"Be concise. Total response: max 250 words.",
			"",
			"## Tech Stack",
			"List main language, framework, and key dependencies.",
			"",
			"## Project Structure",
			"Describe the directory layout and key modules.",
			"",
			"## Conventions",
			"Naming patterns, coding style, test framework.",
			"",
			"## Gotchas",
			"Non-obvious things a new contributor must know.",
		].join("\n"),
		userMessage: sections.join("\n\n"),
		maxTokens: 768,
		...opts,
	});

	return result?.content ?? null;
}
