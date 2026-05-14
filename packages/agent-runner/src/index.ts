/**
 * @setra/agent-runner
 *
 * Entry point. Exports the public API and registers all built-in adapters.
 *
 * Consumers should import from the subpath exports for tree-shaking:
 *   import { claudeAdapter } from '@setra/agent-runner/adapter';
 *   import { MODEL_REGISTRY }  from '@setra/agent-runner/registry';
 *   import { generateBranchName } from '@setra/agent-runner/small-model';
 *
 * Or import everything from the root (desktop app, core daemon):
 *   import { claudeAdapter, fallbackChain, MODEL_REGISTRY } from '@setra/agent-runner';
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
	TokenUsage,
	SpawnOptions,
	Plot,
	Run,
	SmallModelTask,
	SmallModelProvider,
	SmallModelCostEntry,
} from "./types.js";
export { ZERO_USAGE, totalTokens } from "./types.js";

// ─── Provider availability ────────────────────────────────────────────────────
export type {
	ProviderStatus,
	ProviderAvailability,
	AvailabilityReport,
	DeploymentMode,
	BudgetMode,
} from "./provider-availability.js";
export {
	getAvailability,
	resolveModel as resolveAvailableModel,
	AUTO_PRIORITY,
	FALLBACK_MODEL,
	getDeploymentMode,
	isOfflineMode,
	applyDeploymentMode,
	assignModelForRole,
} from "./provider-availability.js";

// ─── Model registry ───────────────────────────────────────────────────────────
export type {
	ProviderKind,
	ModelTier,
	ModelPricing,
	ModelDefinition,
	ProviderDefinition,
} from "./registry.js";
export {
	ALL_PROVIDERS,
	PROVIDER_MAP,
	MODEL_MAP,
	getProvider,
	getModel,
	resolveModel,
	estimateCost,
	cliProviders,
	apiProviders,
} from "./registry.js";

// ─── Adapter interface & registry ─────────────────────────────────────────────
export type { AgentAdapter } from "./adapter.js";
export {
	registerAdapter,
	getAdapter,
	getAllAdapters,
	resolveAdapter,
} from "./adapter.js";

// ─── CLI adapters ─────────────────────────────────────────────────────────────
export {
	ClaudeAdapter,
	claudeAdapter,
	CLAUDE_RATE_LIMIT_PATTERNS,
} from "./adapters/claude.js";
export { GeminiAdapter, geminiAdapter } from "./adapters/gemini.js";
export { CodexAdapter, codexAdapter } from "./adapters/codex.js";
export { CopilotAdapter, copilotAdapter } from "./adapters/copilot.js";
export { OpenCodeAdapter, opencodeAdapter } from "./adapters/opencode.js";
export { AmpAdapter, ampAdapter } from "./adapters/amp.js";
export { CursorAdapter, cursorAdapter } from "./adapters/cursor.js";

// CLI probe (Connect-a-CLI onboarding + top bar status)
export {
	FIRST_CLASS_CLIS,
	probeCLIs,
	_resetCliProbeCacheForTests,
} from "./cli-probe.js";
export type { CliDescriptor, CliStatus, ProbeOptions } from "./cli-probe.js";

// ─── API adapters ─────────────────────────────────────────────────────────────
export {
	AnthropicApiAdapter,
	anthropicApiAdapter,
	callAnthropicOnce,
} from "./adapters/anthropic-api.js";
export {
	OpenAiApiAdapter,
	openAiApiAdapter,
	callOpenAiOnce,
} from "./adapters/openai-api.js";
export {
	OllamaAdapter,
	ollamaAdapter,
	checkOllamaHealth,
	listOllamaModels,
	pullOllamaModel,
	callOllamaOnce,
} from "./adapters/ollama.js";
export {
	CustomOpenAiAdapter,
	customOpenAiAdapter,
} from "./adapters/custom-openai.js";
export {
	AwsBedrockAdapter,
	awsBedrockAdapter,
} from "./adapters/aws-bedrock.js";
export {
	AzureOpenAIAdapter,
	azureOpenAIAdapter,
} from "./adapters/azure-openai.js";
export { GcpVertexAdapter, gcpVertexAdapter } from "./adapters/gcp-vertex.js";

// ─── Small model ──────────────────────────────────────────────────────────────
export {
	resolveSmallModelProvider,
	resetSmallModelProviderCache,
	callSmallModel,
	generateBranchName,
	generateRunTitle,
	generateTraceSummary,
	generateColdStartAnalysis,
} from "./small-model.js";

// ─── Fallback chain ───────────────────────────────────────────────────────────
export type {
	FallbackEvent,
	FallbackAction,
	AdapterStatus,
} from "./fallback-chain.js";
export {
	UNIVERSAL_RATE_LIMIT_PATTERNS,
	DEFAULT_FALLBACK_CHAINS,
	FallbackChain,
	fallbackChain,
	detectRateLimit,
	createRateLimitMonitor,
	checkAllAdapters,
} from "./fallback-chain.js";

// ─── Compare mode ─────────────────────────────────────────────────────────────
export type {
	CompareRunResult,
	CompareResult,
	CompareOptions,
	ComparePlan,
} from "./compare-mode.js";
export {
	buildComparePlan,
	aggregateResults,
	formatCompareResultSummary,
} from "./compare-mode.js";

// ─── Model token registry ─────────────────────────────────────────────────────
export type {
	ModelTokenPricing,
	ModelContextWindowRegistry,
	ModelPricingRegistry,
	BudgetModelSuggestion,
} from "./models-tokens.js";
export {
	MODEL_CONTEXT_WINDOWS,
	MODEL_PRICING,
	getContextWindow,
	getModelPricing,
	estimateTokenCost,
	getCostMultiplier,
	suggestModelForBudget,
} from "./models-tokens.js";

// ─── Governance policy ────────────────────────────────────────────────────────
export type { GovernancePolicy, AuditEntry } from "./governance.js";
export {
	DEFAULT_POLICY,
	loadGovernancePolicy,
	saveGovernancePolicy,
	validateModelChoice,
	appendAuditLog,
	readAuditLog,
	clearAuditLog,
	getGovernancePolicyPath,
	isGovernancePolicyFilePresent,
} from "./governance.js";

// ─── setra-native (Phase 3 stub) ──────────────────────────────────────────────
export {
	SetraNativeAdapter,
	setraNativeAdapter,
} from "./setra-native/index.js";

// ─── Network egress gate ──────────────────────────────────────────────────────
export { assertEgressAllowed } from "./network-gate.js";

// ─── Agent workflow helpers ────────────────────────────────────────────────────
export { Sandbox, type PendingChange } from "./sandbox.js";
export {
	type AutonomyLevel,
	type AutonomyConfig,
	getAutonomyConfig,
	resolveAutonomy,
	canPerformAction,
	describeAutonomy,
} from "./autonomy.js";
export {
	runDebugLoop,
	type DebugLoopOptions,
	type DebugLoopResult,
} from "./debug-loop.js";
export {
	MemoryCompressor,
	type ConversationMessage,
	type CompressedMemory,
	type MemoryCompressorOptions,
} from "./memory-compressor.js";
export {
	parseCompletionResponse,
	shouldContinue,
	COMPLETION_CHECK_PROMPT,
	type CompletionCheckResult,
} from "./completion-checker.js";
export { PlanHistory, type PlanEntry } from "./plan-history.js";
export { ContextManager, type ContextItem } from "./context-manager.js";

// ─── Pipeline engine ───────────────────────────────────────────────────────────
export type {
	NodeExecutionResult,
	NodeConfig,
	PipelineState,
	PipelineTokenUsage,
	PipelineLlmCall,
	PipelineLlmResponse,
	PipelineMcpCall,
	PipelineMcpResponse,
	PipelineConfig,
	PipelineEdge,
	PipelineEvent,
	PipelineLogger,
	PipelineResult,
	IteratorItemResult,
	TransformContext,
	TransformHandler,
} from "./pipeline/index.js";
export {
	BaseNode,
	Pipeline,
	ConditionalNode,
	FetchNode,
	IteratorNode,
	LlmNode,
	McpToolNode,
	MergeNode,
	TransformNode,
	registerTransform,
	createCodeReviewPipeline,
	createResearchCompetitorPipeline,
	createSnakeGameProPipeline,
	createTriageIssuesPipeline,
	codeReviewPipelineConfig,
	researchCompetitorPipelineConfig,
	snakeGameProPipelineConfig,
	snakeGameProTemplate,
	triageIssuesPipelineConfig,
	LoopDetector,
	type LoopDetectorOptions,
	type LoopSignal,
} from "./pipeline/index.js";

// ─── Auto-registration ────────────────────────────────────────────────────────
//
// All built-in adapters are registered when this module loads.
// The registration order determines adapter priority in the fallback chain display.
// Custom adapters (user-configured) are registered by the Settings UI at runtime.

import { registerAdapter } from "./adapter.js";
import { ampAdapter } from "./adapters/amp.js";
import { anthropicApiAdapter } from "./adapters/anthropic-api.js";
import { awsBedrockAdapter } from "./adapters/aws-bedrock.js";
import { azureOpenAIAdapter } from "./adapters/azure-openai.js";
import { claudeAdapter } from "./adapters/claude.js";
import { codexAdapter } from "./adapters/codex.js";
import { copilotAdapter } from "./adapters/copilot.js";
import { cursorAdapter } from "./adapters/cursor.js";
import { customOpenAiAdapter } from "./adapters/custom-openai.js";
import { gcpVertexAdapter } from "./adapters/gcp-vertex.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { ollamaAdapter } from "./adapters/ollama.js";
import { openAiApiAdapter } from "./adapters/openai-api.js";
import { opencodeAdapter } from "./adapters/opencode.js";
import { setraNativeAdapter } from "./setra-native/index.js";

// CLI adapters (first-class: shown in onboarding + top bar)
registerAdapter(claudeAdapter);
registerAdapter(codexAdapter);
registerAdapter(geminiAdapter);
registerAdapter(opencodeAdapter);
registerAdapter(cursorAdapter);
// CLI adapters (secondary; available but not promoted in onboarding)
registerAdapter(copilotAdapter);
registerAdapter(ampAdapter);

// API adapters
registerAdapter(anthropicApiAdapter);
registerAdapter(openAiApiAdapter);
registerAdapter(awsBedrockAdapter);
registerAdapter(azureOpenAIAdapter);
registerAdapter(gcpVertexAdapter);

// Local adapters
registerAdapter(ollamaAdapter);
registerAdapter(customOpenAiAdapter);

// Phase 3 (not yet available)
registerAdapter(setraNativeAdapter);
