import { getRawDb } from "@setra/db";
import { isOfflineForCompany } from "../repositories/runtime.repo.js";
import { readProjectContext } from "../routes/project-context.js";
import { emit } from "../sse/handler.js";
import {
	isCloudAdapter,
	isPtyOnlyAdapter,
	isServerRunnableAdapter,
	normalizeAdapterId,
} from "./adapter-policy.js";
import { callAdapterTextOnce } from "./adapters/adapter-dispatch.js";
import { callAnthropicWithTools } from "./adapters/anthropic-runner.js";
import {
	CodexLoginRequiredError,
	CodexNotInstalledError,
	callCodexExecOnce,
} from "./adapters/codex-runner.js";
import { callCopilotExecOnce } from "./adapters/copilot-runner.js";
import { callGeminiWithTools } from "./adapters/gemini-runner.js";
import { callOpenAiWithTools } from "./adapters/openai-runner.js";
import { postChannelMessage } from "./channel-hooks.js";
import { publishAgentCompletionMessage } from "./company-broker.js";
import { getCompanySettings } from "./company-settings.js";
import { postProjectHelpRequest } from "./escalation.js";
import { addAutomationIssueComment } from "./issue-comments.js";
import { createLogger } from "./logger.js";
import {
	buildRunSummaryMemory,
	buildSystemPrompt,
	buildUserPrompt,
	storeRuntimeMemory,
} from "./prompt-builder.js";
import { jobQueue } from "./queue.js";
import { withRetry } from "./retry.js";
import { persistRunSystemPrompt, recordRunChunk } from "./run-chunks.js";
import { onRunCompleted } from "./run-lifecycle.js";
import {
	buildToolDefinitions,
	executeToolCall,
	safeParseJsonObject,
} from "./tool-executor.js";
import type {
	AgentRow,
	IssueRow,
	LlmCallResult,
	RunRow,
	RuntimeKeys,
	SpawnRunInput,
} from "./types.js";

const log = createLogger("server-runner");
const HEARTBEAT_MS = 60_000;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

function loadRuntimeKeys(companyId: string | null): RuntimeKeys {
	const settings = (getCompanySettings(companyId) ?? {}) as Record<
		string,
		unknown
	>;
	const keys: RuntimeKeys = {};
	const anthropicKey =
		typeof settings.anthropic_api_key === "string"
			? settings.anthropic_api_key
			: process.env.ANTHROPIC_API_KEY;
	const openAiKey =
		typeof settings.openai_api_key === "string"
			? settings.openai_api_key
			: process.env.OPENAI_API_KEY;
	const geminiKey =
		typeof settings.gemini_api_key === "string"
			? settings.gemini_api_key
			: process.env.GEMINI_API_KEY;
	const openRouterKey =
		typeof settings.openrouter_api_key === "string"
			? settings.openrouter_api_key
			: process.env.OPENROUTER_API_KEY;
	const groqKey =
		typeof settings.groq_api_key === "string"
			? settings.groq_api_key
			: process.env.GROQ_API_KEY;
	if (anthropicKey) keys.anthropicKey = anthropicKey;
	if (openAiKey) keys.openAiKey = openAiKey;
	if (geminiKey) keys.geminiKey = geminiKey;
	if (openRouterKey) keys.openRouterKey = openRouterKey;
	if (groqKey) keys.groqKey = groqKey;
	return keys;
}

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Run timed out after ${ms / 1000}s (${label})`));
		}, ms);
		if (typeof (timer as { unref?: () => void }).unref === "function") {
			(timer as { unref: () => void }).unref();
		}
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function hasActiveRunsForAgent(agentSlug: string): boolean {
	const row = getRawDb()
		.prepare(
			`SELECT COUNT(*) AS c FROM runs WHERE agent = ? AND status IN ('pending','running')`,
		)
		.get(agentSlug) as { c: number } | undefined;
	return (row?.c ?? 0) > 0;
}

function syncAgentStatusFromRuns(agent: AgentRow): void {
	const hasActive = hasActiveRunsForAgent(agent.slug);
	const status = hasActive ? "running" : "idle";
	const db = getRawDb();
	const previous = db
		.prepare(`SELECT status FROM agent_roster WHERE id = ?`)
		.get(agent.id) as { status: string } | undefined;
	const result = db
		.prepare(
			`UPDATE agent_roster
          SET status = ?,
              paused_reason = CASE WHEN ? = 'idle' THEN NULL ELSE paused_reason END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?
          AND status IN ('idle', 'running')`,
		)
		.run(status, status, agent.id);
	if ((result.changes ?? 0) > 0 && previous?.status !== status) {
		log.info("agent runtime status synced", {
			agentSlug: agent.slug,
			from: previous?.status ?? "unknown",
			to: status,
		});
	}
}

function extractFirstUrl(text: string): string | null {
	const match = text.match(/https?:\/\/\S+/i);
	return match?.[0] ?? null;
}

function buildPipelineInitialState(
	pipelineTemplate: string,
	task: string,
	issue: IssueRow | null,
	runArgs: Record<string, unknown>,
): Record<string, unknown> {
	const pipelineInput =
		runArgs.pipelineInput &&
		typeof runArgs.pipelineInput === "object" &&
		!Array.isArray(runArgs.pipelineInput)
			? { ...(runArgs.pipelineInput as Record<string, unknown>) }
			: {};
	const state: Record<string, unknown> = {
		...pipelineInput,
		task,
		issue_slug: issue?.slug,
		issue_title: issue?.title,
		issue_description: issue?.description,
	};
	if (pipelineTemplate === "research-competitor") {
		state.competitor_url =
			state.competitor_url ??
			state.competitorUrl ??
			runArgs.competitor_url ??
			runArgs.competitorUrl ??
			extractFirstUrl(task) ??
			"";
		state.research_prompt =
			state.research_prompt ?? state.researchPrompt ?? task;
	} else if (pipelineTemplate === "triage-issues") {
		state.issues = Array.isArray(state.issues)
			? state.issues
			: issue
				? [
						{
							title: issue.title,
							description: issue.description ?? "",
							slug: issue.slug,
						},
					]
				: [task];
	} else if (pipelineTemplate === "code-review") {
		state.diff = state.diff ?? task;
		state.context = state.context ?? issue?.description ?? "";
		state.file_paths =
			state.file_paths ??
			state.filePaths ??
			runArgs.file_paths ??
			runArgs.filePaths ??
			[];
	}
	return state;
}

function summarizePipelineState(state: Record<string, unknown>): string {
	for (const key of [
		"summary",
		"report",
		"sprint_plan",
		"analysis",
		"review_bundle_json",
		"report_bundle_json",
	]) {
		const value = state[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return JSON.stringify(state, null, 2);
}

async function runPipeline(input: {
	pipelineTemplate: string;
	adapterId: string;
	model: string;
	systemPrompt: string;
	task: string;
	agent: AgentRow;
	issue: IssueRow | null;
	runtimeKeys: RuntimeKeys;
	runId: string;
	companyId: string | null;
	worktreePath?: string | undefined;
	runArgs: Record<string, unknown>;
}): Promise<LlmCallResult> {
	const {
		Pipeline,
		codeReviewPipelineConfig,
		researchCompetitorPipelineConfig,
		snakeGameProPipelineConfig,
		triageIssuesPipelineConfig,
	} = await import("@setra/agent-runner");
	type PipelineConfig = ConstructorParameters<typeof Pipeline>[0];
	const configMap: Record<string, PipelineConfig> = {
		"code-review": codeReviewPipelineConfig,
		"research-competitor": researchCompetitorPipelineConfig,
		"snake-game-pro": snakeGameProPipelineConfig,
		"triage-issues": triageIssuesPipelineConfig,
	};
	const templateConfig = configMap[input.pipelineTemplate];
	if (!templateConfig) {
		throw new Error(`Unknown pipeline template: ${input.pipelineTemplate}`);
	}
	const toolContext = await buildToolDefinitions({
		agent: input.agent,
		issue: input.issue,
		companyId: input.companyId,
	});
	const pipeline = new Pipeline({
		...templateConfig,
		logger: (event) => {
			writeChunk(
				input.runId,
				`[pipeline:${input.pipelineTemplate}] ${event.type}${event.nodeName ? ` ${event.nodeName}` : ""}${event.error ? ` ${event.error}` : ""}\n`,
				"system",
			);
		},
	});
	const result = await pipeline.run({
		...buildPipelineInitialState(
			input.pipelineTemplate,
			input.task,
			input.issue,
			input.runArgs,
		),
		__llmCall: async (prompt: string, modelOverride?: string) => {
			const response = await callAdapterTextOnce({
				adapterId: input.adapterId,
				model: modelOverride ?? input.model,
				systemPrompt: input.systemPrompt,
				task: prompt,
				runtimeKeys: input.runtimeKeys,
				maxTokens: 4096,
			});
			return {
				content: response.content,
				tokens: {
					prompt: response.usage.promptTokens,
					completion: response.usage.completionTokens,
				},
				costUsd: response.costUsd,
			};
		},
		__mcpCall: async (toolName: string, args: Record<string, unknown>) => {
			const tool = toolContext.byName.get(toolName);
			if (!tool) throw new Error(`Unknown pipeline tool: ${toolName}`);
			const toolResult = await executeToolCall({
				tool,
				args,
				agent: input.agent,
				issue: input.issue,
				companyId: input.companyId,
				runId: input.runId,
				worktreePath: input.worktreePath,
				adapterId: input.adapterId,
				model: input.model,
				systemPrompt: input.systemPrompt,
				runtimeKeys: input.runtimeKeys,
			});
			return toolResult.content;
		},
	});
	if (!result.success) {
		throw new Error(
			result.error ?? `Pipeline ${input.pipelineTemplate} failed`,
		);
	}
	const content = summarizePipelineState(result.state);
	writeChunk(
		input.runId,
		`[pipeline:${input.pipelineTemplate}] completed\n`,
		"system",
	);
	writeChunk(input.runId, `${content}\n`, "stdout");
	return {
		content,
		usage: {
			promptTokens: result.totalTokens.prompt,
			completionTokens: result.totalTokens.completion,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		costUsd: result.totalCostUsd,
	};
}

function getNextChunkSeq(runId: string): number {
	const row = getRawDb()
		.prepare(
			"SELECT COALESCE(MAX(sequence), 0) AS s FROM chunks WHERE run_id = ?",
		)
		.get(runId) as { s: number } | undefined;
	return (row?.s ?? 0) + 1;
}

function writeChunk(
	runId: string,
	content: string,
	type: "input" | "stdout" | "stderr" | "system" = "stdout",
): void {
	recordRunChunk({ runId, type, content });
}

function compactRunChunks(runId: string, companyId: string | null): void {
	try {
		const settings = getCompanySettings(companyId);
		const enabled = settings.memory_compaction_enabled !== false;
		if (!enabled) return;
		const maxChunks =
			typeof settings.memory_max_chunks === "number"
				? Math.max(100, Math.floor(settings.memory_max_chunks))
				: 400;
		const keepChunks =
			typeof settings.memory_keep_chunks === "number"
				? Math.max(20, Math.floor(settings.memory_keep_chunks))
				: 80;
		if (keepChunks >= maxChunks) return;
		const db = getRawDb();
		const row = db
			.prepare(`SELECT COUNT(*) AS c FROM chunks WHERE run_id = ?`)
			.get(runId) as { c: number } | undefined;
		const total = row?.c ?? 0;
		if (total <= maxChunks) return;
		const pruneCount = total - keepChunks;
		writeChunk(
			runId,
			`[compaction] context compacted; removed ${pruneCount} older chunks and retained latest ${keepChunks} chunks.\n`,
			"system",
		);
		db.prepare(
			`DELETE FROM chunks
       WHERE id IN (
         SELECT id FROM chunks
         WHERE run_id = ?
         ORDER BY sequence ASC
         LIMIT ?
       )`,
		).run(runId, pruneCount);
	} catch (error) {
		log.warn("chunk compaction failed", {
			runId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function loadRun(runId: string): RunRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT id, agent, agent_version, agent_args, plot_id FROM runs WHERE id = ?`,
			)
			.get(runId) as RunRow | undefined) ?? null
	);
}

function loadAgent(slug: string, companyId: string | null): AgentRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT id, slug, display_name, adapter_type, model_id, system_prompt, skills, company_id
         FROM agent_roster
        WHERE slug = ? ${companyId ? "AND (company_id = ? OR company_id IS NULL)" : ""}
        ORDER BY (company_id IS NULL) ASC
        LIMIT 1`,
			)
			.get(...(companyId ? [slug, companyId] : [slug])) as
			| AgentRow
			| undefined) ?? null
	);
}

function loadIssue(issueId: string): IssueRow | null {
	return (
		(getRawDb()
			.prepare(
				`SELECT i.id,
        i.project_id AS projectId,
        i.company_id AS companyId,
        i.slug,
        i.title,
        i.description,
        COALESCE(NULLIF(trim(p.workspace_path), ''), NULLIF(trim(p.repo_path), '')) AS workspacePath
   FROM board_issues i
   LEFT JOIN board_projects p ON p.id = i.project_id
  WHERE i.id = ?`,
			)
			.get(issueId) as IssueRow | undefined) ?? null
	);
}

function setRunStatus(
	runId: string,
	patch: Partial<{
		status: "pending" | "running" | "completed" | "failed";
		errorMessage: string;
		costUsd: number;
		promptTokens: number;
		completionTokens: number;
		cacheReadTokens: number;
	}>,
): void {
	const sets: string[] = ["updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
	const params: unknown[] = [];
	if (patch.status) {
		sets.push("status = ?");
		params.push(patch.status);
		if (patch.status === "completed" || patch.status === "failed") {
			sets.push("ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
		}
	}
	if (patch.errorMessage !== undefined) {
		sets.push("error_message = ?");
		params.push(patch.errorMessage);
	}
	if (patch.costUsd !== undefined) {
		sets.push("cost_usd = ?");
		params.push(patch.costUsd);
	}
	if (patch.promptTokens !== undefined) {
		sets.push("prompt_tokens = ?");
		params.push(patch.promptTokens);
	}
	if (patch.completionTokens !== undefined) {
		sets.push("completion_tokens = ?");
		params.push(patch.completionTokens);
	}
	if (patch.cacheReadTokens !== undefined) {
		sets.push("cache_read_tokens = ?");
		params.push(patch.cacheReadTokens);
	}
	params.push(runId);
	getRawDb()
		.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`)
		.run(...params);
}

function setAgentRuntimeStatus(
	agentId: string,
	status: "idle" | "running" | "awaiting_key",
	pausedReason: string | null = null,
): void {
	const db = getRawDb();
	const previous = db
		.prepare(`SELECT slug, status FROM agent_roster WHERE id = ?`)
		.get(agentId) as { slug: string; status: string } | undefined;
	const result = db
		.prepare(
			`UPDATE agent_roster
          SET status = ?,
              paused_reason = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
		)
		.run(status, pausedReason, agentId);
	if ((result.changes ?? 0) > 0 && previous?.status !== status) {
		log.info("agent runtime status updated", {
			agentSlug: previous?.slug ?? agentId,
			from: previous?.status ?? "unknown",
			to: status,
		});
	}
}

/**
 * Coordinates a server-side run by building prompts, dispatching the selected
 * adapter, recording chunks, and synchronizing run state.
 */
let runProcessorRegistered = false;

export function registerRunQueueProcessor(): void {
	if (runProcessorRegistered) return;
	runProcessorRegistered = true;
	jobQueue.process("agent-run", async (job) => {
		const payload = job.payload as unknown as SpawnRunInput;
		await executeServerRun(payload);
		return { runId: payload.runId };
	});
}

export async function spawnServerRun(input: SpawnRunInput): Promise<void> {
	registerRunQueueProcessor();
	const existing = getRawDb()
		.prepare(
			`SELECT id FROM jobs
			  WHERE type = 'agent-run'
			    AND status IN ('waiting', 'active')
			    AND json_extract(payload, '$.runId') = ?
			  LIMIT 1`,
		)
		.get(input.runId) as { id: string } | undefined;
	if (existing) return;
	jobQueue.add("agent-run", input as unknown as Record<string, unknown>, {
		priority: 0,
		maxAttempts: 3,
	});
}

export async function executeServerRun(input: SpawnRunInput): Promise<void> {
	const { runId, agentSlug, issueId, companyId } = input;
	const run = loadRun(runId);
	if (!run) {
		log.warn("run not found", { runId });
		return;
	}
	const agent = loadAgent(agentSlug, companyId);
	if (!agent) {
		setRunStatus(runId, {
			status: "failed",
			errorMessage: `agent ${agentSlug} not found`,
		});
		return;
	}
	let adapterId = normalizeAdapterId(agent.adapter_type);
	const offline = isOfflineForCompany(companyId);
	if (offline && isCloudAdapter(adapterId)) {
		setRunStatus(runId, {
			status: "failed",
			errorMessage: `Company is offline-only. Adapter '${adapterId}' is blocked; use a local provider like ollama.`,
		});
		setAgentRuntimeStatus(agent.id, "idle");
		return;
	}
	if (!isServerRunnableAdapter(adapterId)) {
		if (isPtyOnlyAdapter(adapterId)) {
			setRunStatus(runId, {
				status: "failed",
				errorMessage: `Adapter '${adapterId}' requires the desktop app (PTY). Use anthropic-api, openai-api, gemini-api, openrouter, groq, ollama, codex, or copilot for server-side runs.`,
			});
		} else {
			setRunStatus(runId, {
				status: "failed",
				errorMessage: `Unsupported adapter '${agent.adapter_type ?? "null"}'. Supported server-side: anthropic-api, openai-api, gemini-api, openrouter, groq, ollama, codex, copilot.`,
			});
		}
		setAgentRuntimeStatus(agent.id, "idle");
		return;
	}

	const runtimeKeys = loadRuntimeKeys(companyId);
	const requiredKey: Record<string, keyof RuntimeKeys | null> = {
		"anthropic-api": "anthropicKey",
		"openai-api": "openAiKey",
		"gemini-api": "geminiKey",
		openrouter: "openRouterKey",
		groq: "groqKey",
		ollama: null,
		// codex authenticates via `codex login` (OAuth) — no API key needed.
		codex: null,
		// copilot authenticates via `copilot auth login` (subscription OAuth).
		copilot: null,
	};
	const requiredEnvName: Record<keyof RuntimeKeys, string> = {
		anthropicKey: "ANTHROPIC_API_KEY",
		openAiKey: "OPENAI_API_KEY",
		geminiKey: "GEMINI_API_KEY",
		openRouterKey: "OPENROUTER_API_KEY",
		groqKey: "GROQ_API_KEY",
	};
	const neededKey = requiredKey[adapterId];
	if (neededKey && !runtimeKeys[neededKey]) {
		setRunStatus(runId, {
			status: "failed",
			errorMessage: `${requiredEnvName[neededKey]} not configured for this company`,
		});
		setAgentRuntimeStatus(agent.id, "awaiting_key");
		return;
	}

	const issue = issueId ? loadIssue(issueId) : null;
	const task = buildUserPrompt({ task: input.task, issue });
	const defaultModel: Record<string, string> = {
		"anthropic-api": "claude-haiku-4-5",
		"openai-api": "gpt-5.4",
		"gemini-api": "gemini-2.5-flash",
		openrouter: "openrouter/auto",
		groq: "llama-3.3-70b-versatile",
		ollama: "qwen2.5-coder:7b",
		codex: "gpt-5.5",
		copilot: "claude-sonnet-4.6",
	};
	let model =
		run.agent_version ??
		agent.model_id ??
		defaultModel[adapterId] ??
		"claude-haiku-4-5";
	const prefixToAdapter: Record<string, string> = {
		openrouter: "openrouter",
		openai: "openai-api",
		anthropic: "anthropic-api",
		gemini: "gemini-api",
		groq: "groq",
		ollama: "ollama",
	};
	if (model.includes(":") && !model.startsWith("http")) {
		const colonIdx = model.indexOf(":");
		const prefix = model.slice(0, colonIdx);
		const prefixedAdapter = prefixToAdapter[prefix];
		if (prefixedAdapter) {
			adapterId = prefixedAdapter;
			model = model.slice(colonIdx + 1);
		}
	}
	const projectContext =
		issue?.workspacePath && issue.workspacePath.trim().length > 0
			? readProjectContext(issue.workspacePath).content
			: "";
	const systemPrompt =
		(projectContext
			? `## Project Context\n\n${projectContext}\n\n---\n\n`
			: "") + (await buildSystemPrompt(agent, issue, task));
	persistRunSystemPrompt(runId, systemPrompt);
	const runArgs = safeParseJsonObject(run.agent_args);
	const pipelineTemplate =
		typeof runArgs.pipelineTemplate === "string"
			? runArgs.pipelineTemplate
			: typeof runArgs.pipeline_template === "string"
				? runArgs.pipeline_template
				: null;

	setRunStatus(runId, { status: "running" });
	setAgentRuntimeStatus(agent.id, "running");
	emit("run:updated", { runId, agentId: agent.slug, status: "running" });
	if (companyId) {
		postChannelMessage(
			companyId,
			"general",
			agent.slug,
			agent.display_name,
			"started",
			{
				runId,
				issueId: issueId ?? null,
			},
		);
	}
	writeChunk(
		runId,
		`[server-runner] starting ${adapterId} call (model=${model})\n`,
		"system",
	);
	log.info("starting run", {
		runId,
		agentId: agent.slug,
		issueId,
		adapterId,
		model,
	});

	const worktreePath = (() => {
		try {
			const plotRow = getRawDb()
				.prepare(`SELECT worktree_path FROM plots WHERE id = ?`)
				.get(run.plot_id) as { worktree_path: string | null } | undefined;
			return plotRow?.worktree_path ?? issue?.workspacePath ?? undefined;
		} catch {
			return issue?.workspacePath ?? undefined;
		}
	})();

	const heartbeat = setInterval(() => {
		try {
			getRawDb()
				.prepare(
					`UPDATE runs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
				)
				.run(runId);
			emit("run:updated", { runId, agentId: agent.slug, event: "heartbeat" });
		} catch {
			/* swallow */
		}
	}, HEARTBEAT_MS);
	if (typeof (heartbeat as { unref?: () => void }).unref === "function") {
		(heartbeat as { unref: () => void }).unref();
	}

	try {
		let result: LlmCallResult;
		const retryOptions = {
			maxAttempts: 3,
			onRetry: (attempt: number, error: Error, delay: number) => {
				writeChunk(
					runId,
					`[server-runner] retry ${attempt} after ${Math.round(delay)}ms: ${error.message}\n`,
					"system",
				);
			},
		};
		if (pipelineTemplate) {
			result = await withTimeout(
				runPipeline({
					pipelineTemplate,
					adapterId,
					model,
					systemPrompt,
					task,
					agent,
					issue,
					runtimeKeys,
					runId,
					companyId,
					worktreePath,
					runArgs,
				}),
				RUN_TIMEOUT_MS,
				`pipeline/${pipelineTemplate}`,
			);
		} else if (adapterId === "anthropic-api") {
			result = await withTimeout(
				withRetry(
					() =>
						callAnthropicWithTools({
							model,
							systemPrompt,
							task,
							apiKey: runtimeKeys.anthropicKey!,
							agent,
							issue,
							maxTokens: 4096,
							runId,
							worktreePath,
							runtimeKeys,
							adapterId,
							companyId,
						}),
					retryOptions,
				),
				RUN_TIMEOUT_MS,
				`${adapterId}/${model}`,
			);
		} else if (
			adapterId === "openai-api" ||
			adapterId === "openrouter" ||
			adapterId === "groq"
		) {
			let baseUrl: string | undefined;
			let apiKey: string | undefined = runtimeKeys.openAiKey;
			if (adapterId === "openrouter") {
				baseUrl = "https://openrouter.ai/api/v1";
				apiKey = runtimeKeys.openRouterKey ?? apiKey;
			} else if (adapterId === "groq") {
				baseUrl = "https://api.groq.com/openai/v1";
				apiKey = runtimeKeys.groqKey ?? apiKey;
			} else {
				baseUrl = process.env.OPENAI_BASE_URL;
			}
			result = await withTimeout(
				withRetry(
					() =>
						callOpenAiWithTools({
							model,
							systemPrompt,
							task,
							apiKey: apiKey!,
							...(baseUrl !== undefined ? { baseUrl } : {}),
							agent,
							issue,
							maxTokens: 4096,
							runId,
							worktreePath,
							runtimeKeys,
							adapterId,
							companyId,
						}),
					retryOptions,
				),
				RUN_TIMEOUT_MS,
				`${adapterId}/${model}`,
			);
		} else if (adapterId === "gemini-api") {
			result = await withTimeout(
				withRetry(
					() =>
						callGeminiWithTools({
							model,
							systemPrompt,
							task,
							apiKey: runtimeKeys.geminiKey!,
							agent,
							issue,
							maxTokens: 4096,
							runId,
							worktreePath,
							runtimeKeys,
							adapterId,
							companyId,
						}),
					retryOptions,
				),
				RUN_TIMEOUT_MS,
				`${adapterId}/${model}`,
			);
		} else if (adapterId === "ollama") {
			const { callOllamaOnce } = await import("@setra/agent-runner");
			result = await withTimeout(
				withRetry(
					async () =>
						(await callOllamaOnce(
							model,
							systemPrompt,
							task,
							4096,
						)) as LlmCallResult,
					retryOptions,
				),
				RUN_TIMEOUT_MS,
				`${adapterId}/${model}`,
			);
		} else if (adapterId === "codex") {
			result = await withTimeout(
				withRetry(
					() =>
						callCodexExecOnce({
							model,
							systemPrompt,
							task,
							...(worktreePath ? { cwd: worktreePath } : {}),
							runId,
						}),
					retryOptions,
				),
				// codex exec can take longer than API calls; give it a larger window.
				10 * 60 * 1000,
				`${adapterId}/${model}`,
			);
		} else if (adapterId === "copilot") {
			result = await withTimeout(
				withRetry(
					() =>
						callCopilotExecOnce({
							model,
							systemPrompt,
							task,
							...(worktreePath ? { cwd: worktreePath } : {}),
							runId,
						}),
					retryOptions,
				),
				10 * 60 * 1000,
				`${adapterId}/${model}`,
			);
		} else {
			throw new Error(`unreachable: unsupported adapter ${adapterId}`);
		}

		writeChunk(runId, `${result.content}\n`, "stdout");
		const runSummaryMemory = buildRunSummaryMemory({
			agent,
			issue,
			task,
			content: result.content,
		});
		if (runSummaryMemory) {
			await storeRuntimeMemory({
				key: runSummaryMemory.key,
				content: runSummaryMemory.content,
				tags: runSummaryMemory.tags,
				source: "run-summary",
				agent,
				issue,
				runId,
			});
		}
		const trimmedContent = result.content.trim();
		if (issueId && trimmedContent) {
			if (
				trimmedContent.length > 50 &&
				!trimmedContent.startsWith("🔄") &&
				!trimmedContent.startsWith("[server-runner]")
			) {
				addAutomationIssueComment(
					issueId,
					issue?.companyId ?? companyId,
					trimmedContent.slice(0, 5000),
					agent.slug,
				);
			}
		}
		if (companyId && trimmedContent) {
			publishAgentCompletionMessage({
				companyId,
				fromAgent: agent.slug,
				content: trimmedContent,
				issueId: issueId ?? null,
				runId,
			});
		}
		setRunStatus(runId, {
			status: "completed",
			costUsd: result.costUsd,
			promptTokens: result.usage.promptTokens,
			completionTokens: result.usage.completionTokens,
			cacheReadTokens: result.usage.cacheReadTokens,
		});
		emit("run:completed", { runId, agentId: agent.slug, status: "completed" });
		if (companyId) {
			postChannelMessage(
				companyId,
				"general",
				agent.slug,
				agent.display_name,
				"completed",
				{
					runId,
					issueId: issueId ?? null,
					costUsd: result.costUsd,
				},
			);
		}
		void onRunCompleted(runId, 0).catch((error) => {
			log.warn("run completion hook failed", {
				runId,
				exitCode: 0,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Codex pre-flight failures should pause the agent (awaiting login/install)
		// rather than burning a retry budget.
		if (
			error instanceof CodexLoginRequiredError ||
			error instanceof CodexNotInstalledError
		) {
			writeChunk(runId, `[codex] ${message}\n`, "stderr");
			setRunStatus(runId, { status: "failed", errorMessage: message });
			setAgentRuntimeStatus(agent.id, "awaiting_key", message);
			emit("run:updated", { runId, agentId: agent.slug, status: "failed" });
			void onRunCompleted(runId, 1).catch(() => {});
			return;
		}
		writeChunk(runId, `[server-runner] error: ${message}\n`, "stderr");
		setRunStatus(runId, { status: "failed", errorMessage: message });
		emit("run:updated", { runId, agentId: agent.slug, status: "failed" });
		if (companyId) {
			postChannelMessage(
				companyId,
				"general",
				agent.slug,
				agent.display_name,
				"failed",
				{
					runId,
					issueId: issueId ?? null,
					error: message,
				},
			);
			if (issue?.projectId) {
				try {
					await postProjectHelpRequest({
						companyId,
						projectId: issue.projectId,
						agentRosterId: agent.id,
						agentSlug: agent.slug,
						agentName: agent.display_name,
						task,
						tried: `Attempted run ${runId} with ${adapterId}/${model}.`,
						question: message,
						...(issue.description ? { context: issue.description } : {}),
						runId,
						issueId: issue.id,
					});
				} catch (escalationError) {
					log.warn("project help escalation failed", {
						runId,
						agentId: agent.slug,
						error:
							escalationError instanceof Error
								? escalationError.message
								: String(escalationError),
					});
				}
			}
		}
		log.error("adapter failed", {
			runId,
			agentId: agent.slug,
			model,
			error: message,
		});
		void onRunCompleted(runId, 1).catch((hookError) => {
			log.warn("run completion hook failed", {
				runId,
				exitCode: 1,
				error:
					hookError instanceof Error ? hookError.message : String(hookError),
			});
		});
	} finally {
		clearInterval(heartbeat);
		compactRunChunks(runId, companyId);
		syncAgentStatusFromRuns(agent);
	}
}
