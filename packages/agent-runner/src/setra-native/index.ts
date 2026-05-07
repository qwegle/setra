/**
 * SETRA-NATIVE AGENT (Long-term vision)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Instead of wrapping CLI tools (claude, gemini, codex), setra calls
 * LLM APIs directly using its own:
 *   - System prompt       (setra's own coding agent persona)
 *   - Tool set            (file I/O, bash, git, MCP bridge — as AI SDK tools)
 *   - Multi-turn loop     (managed here, not inside a foreign binary)
 *   - Token accounting    (exact token counts per turn, per tool call)
 *   - Cost streaming      (UI gets real-time cost updates)
 *   - Approval hooks      (pause before destructive tool calls)
 *
 * Foundation: Vercel AI SDK (ai package)
 *   - Provider-agnostic: same code works with Anthropic, OpenAI, Ollama
 *   - `streamText` with `maxSteps` handles the multi-turn agentic loop
 *   - Tool definitions use Zod schemas (already used everywhere in setra)
 *   - Works in Node.js (no browser required)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY BUILD THIS vs KEEPING CLI WRAPPERS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CLI wrappers (claude, gemini, codex) give you:
 *   ✅ Immediate value — leverage existing, battle-tested agents
 *   ✅ Always up-to-date — agent improvements are free upgrades
 *   ✅ Zero prompt engineering — the CLI maintainers do that work
 *   ✅ No PTY parsing fragility — text output is self-describing
 *
 * CLI wrappers cost you:
 *   ❌ Opaque token counts — "cost: $0.12" is all you get
 *   ❌ No mid-turn hooks — can't inject context between tool calls
 *   ❌ No custom approval UX — you're stuck with their permission model
 *   ❌ CLI quirks — flags change, output format changes, binary goes missing
 *   ❌ No streaming to UI — output arrives in chunks, not events
 *   ❌ Multi-model workflows require multiple binaries installed
 *
 * The setra-native agent gives you everything CLI wrappers don't:
 *   ✅ Per-turn, per-tool token visibility (ledger becomes exact, not estimated)
 *   ✅ Real-time streaming events to the xterm.js UI
 *   ✅ Custom approval gates (approve individual tool calls in the UI)
 *   ✅ Inject context between turns (memory search results, cost warnings)
 *   ✅ Works with any provider — user's API key, any model
 *   ✅ No installed binaries required (pure API)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHEN TO BUILD IT
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Phase 1-2: Ship CLI wrappers. They're faster to build and already
 *            have sophisticated coding agent logic (tool calling, MCP, etc.)
 *
 * Phase 3 trigger: Build setra-native when ANY of these are true:
 *   1. Users complain that cost tracking is inaccurate or missing
 *   2. Enterprise customers need per-tool-call audit trails
 *   3. The approval workflow needs fine-grained tool-level control
 *   4. A major CLI breaks (flag changes, binary API change)
 *   5. setra needs to support a model with no CLI (e.g. a new provider)
 *
 * The two approaches can coexist:
 *   - CLI wrappers remain as "bring your own tool" adapters
 *   - setra-native is the "managed" mode, enabled per-plot
 *
 * ═══════════════════════════════════════════════════════════════════════
 * IMPLEMENTATION SKETCH (Vercel AI SDK)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Dependencies to add when building this:
 *   ai                    — Vercel AI SDK core
 *   @ai-sdk/anthropic     — Anthropic provider
 *   @ai-sdk/openai        — OpenAI provider
 *   @ai-sdk/google        — Google Gemini provider
 *   zod                   — already in @setra/types
 */

// ─── Stub implementation (Phase 3 placeholder) ───────────────────────────────
//
// The code below is a SKELETON showing the intended architecture.
// It does not run yet — required packages are not installed.
// Fill this in when Phase 3 starts.

import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

// ─── Tool definitions ─────────────────────────────────────────────────────────
//
// In the setra-native agent, MCP tools are exposed as Vercel AI SDK tools.
// Each tool is a Zod-typed function that the agent can call.
//
// When ready to implement:
//
//   import { tool } from 'ai';
//   import { z } from 'zod';
//
//   const readFileTool = tool({
//     description: 'Read a file from the workspace',
//     parameters: z.object({ path: z.string() }),
//     execute: async ({ path }) => {
//       const content = await fs.readFile(path, 'utf-8');
//       return content;
//     },
//   });
//
//   const bashTool = tool({
//     description: 'Run a bash command in the workspace',
//     parameters: z.object({ command: z.string() }),
//     execute: async ({ command }) => {
//       // Runs inside the plot's worktree; streams output
//       const { stdout, stderr } = await exec(command, { cwd: plot.worktreePath });
//       return { stdout, stderr };
//     },
//   });
//
//   const mcpBridgeTool = tool({
//     description: 'Call an MCP tool on the setra-core MCP server',
//     parameters: z.object({ toolName: z.string(), args: z.record(z.unknown()) }),
//     execute: async ({ toolName, args }) => {
//       // Calls packages/mcp/client.ts to invoke the tool
//       return mcpClient.call(toolName, args);
//     },
//   });

// ─── Multi-turn agent loop ────────────────────────────────────────────────────
//
// The core of the setra-native agent. When ready to implement:
//
//   import { streamText } from 'ai';
//   import { anthropic } from '@ai-sdk/anthropic';
//
//   async function* runSetraNativeAgent(
//     plot: Plot,
//     run: Run,
//     onToken: (text: string) => void,
//     onCost: (costUsd: number) => void,
//   ) {
//     const provider = resolveAiSdkProvider(run.agent, run.model);
//
//     const result = streamText({
//       model: provider,
//       system: buildSetraSystemPrompt(plot),
//       prompt: run.task,
//       tools: { readFile: readFileTool, bash: bashTool, mcp: mcpBridgeTool },
//       maxSteps: run.maxTurns ?? 40,
//       onStepFinish: ({ usage, finishReason }) => {
//         const stepCost = computeCost(run.model, usage);
//         onCost(stepCost);
//       },
//     });
//
//     for await (const part of result.fullStream) {
//       if (part.type === 'text-delta') {
//         onToken(part.textDelta);
//       }
//       if (part.type === 'finish') {
//         // Run complete
//       }
//     }
//
//     const final = await result;
//     return {
//       usage: final.usage,
//       cost: computeCost(run.model, final.usage),
//       finishReason: final.finishReason,
//     };
//   }

// ─── System prompt builder ────────────────────────────────────────────────────
//
// When ready to implement:
//
//   function buildSetraSystemPrompt(plot: Plot): string {
//     return [
//       '# setra.sh Coding Agent',
//       '',
//       'You are an AI coding assistant operating inside setra.sh.',
//       'You have access to the following tools:',
//       '  - readFile / writeFile / listFiles: filesystem access',
//       '  - bash: run shell commands in the workspace',
//       '  - mcp: call setra MCP tools (memory_search, git_context, etc.)',
//       '',
//       '## Rules',
//       '- Always make a git commit after completing a logical unit of work',
//       '- Never modify files outside the workspace directory',
//       '- Ask for approval before running destructive commands (rm -rf, drop table, etc.)',
//       '',
//       `## Workspace`,
//       `Plot: ${plot.name} (${plot.id})`,
//       `Branch: ${plot.branch}`,
//       `Path: ${plot.worktreePath}`,
//     ].join('\n');
//   }

// ─── Provider resolution ──────────────────────────────────────────────────────
//
// The AI SDK provider is selected based on the adapter name:
//
//   function resolveAiSdkProvider(agentName: string, modelId: string) {
//     switch (agentName) {
//       case 'anthropic-api':
//         return anthropic(modelId);        // @ai-sdk/anthropic
//       case 'openai-api':
//         return openai(modelId);           // @ai-sdk/openai
//       case 'gemini':
//         return google(modelId);           // @ai-sdk/google
//       case 'ollama':
//         return ollama(modelId);           // ollama-ai-provider
//       default:
//         return anthropic('claude-sonnet-4-5');
//     }
//   }

// ─── SetraNativeAdapter (Phase 3 stub) ───────────────────────────────────────

/**
 * Phase 3 stub — not yet functional. Included to:
 *   1. Show where the setra-native agent will slot into the adapter registry
 *   2. Reserve the adapter name "setra-native" in the system
 *   3. Document the interface contract for Phase 3 implementation
 */
export class SetraNativeAdapter implements AgentAdapter {
	readonly name = "setra-native" as const;
	readonly displayName = "setra Native (Phase 3)";
	readonly supportsModels = [
		"claude-opus-4-5",
		"claude-sonnet-4-5",
		"claude-haiku-4-5",
		"gpt-4o",
		"gpt-4o-mini",
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"llama3.2",
	] as const;
	readonly defaultModel = "claude-sonnet-4-5";

	async isAvailable(): Promise<boolean> {
		// Phase 3: check that @ai-sdk/anthropic (or chosen provider) is installed
		// and that the relevant API key is set.
		return false; // Not yet implemented
	}

	buildCommand(_plot: Plot, _run: Run, _mcpConfigPath: string): SpawnOptions {
		throw new Error(
			"SetraNativeAdapter.buildCommand() is not implemented (Phase 3). " +
				"Use the CLI adapters (claude, gemini, codex) until Phase 3.",
		);
	}

	buildSystemPromptArgs(_systemPrompt: string): string[] {
		return [];
	}

	buildMcpArgs(_mcpConfigPath: string): string[] {
		return [];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		// Phase 3: parse from structured __usage__ lines emitted by the runner
		const match =
			/__usage__\s+prompt=(\d+)\s+completion=(\d+)\s+cache_read=(\d+)\s+cache_write=(\d+)/.exec(
				output,
			);
		if (!match) return null;
		return {
			promptTokens: Number.parseInt(match[1] ?? "0", 10),
			completionTokens: Number.parseInt(match[2] ?? "0", 10),
			cacheReadTokens: Number.parseInt(match[3] ?? "0", 10),
			cacheWriteTokens: Number.parseInt(match[4] ?? "0", 10),
		};
	}

	parseCostUSD(output: string): number | null {
		const match = /__cost__\s+([\d.]+)/.exec(output);
		if (!match) return null;
		return Number.parseFloat(match[1] ?? "NaN") || null;
	}

	detectRateLimit(output: string): boolean {
		return /rate[\s_-]?limit/i.test(output) || /\b429\b/.test(output);
	}

	detectCompletion(output: string): boolean {
		return /__done__/.test(output);
	}
}

export const setraNativeAdapter = new SetraNativeAdapter();
