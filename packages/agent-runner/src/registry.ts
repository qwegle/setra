/**
 * MODEL REGISTRY
 *
 * Single source of truth for every model setra.sh supports.
 * Pricing is in USD per 1M tokens as of June 2025.
 * Update pricing here only — never hard-code costs elsewhere.
 *
 * Provider kinds:
 *   cli   — setra wraps an installed CLI binary (claude, gemini, codex, …)
 *   api   — setra calls the provider's HTTP API directly (no binary needed)
 *   local — runs on the user's machine, no API key required (ollama)
 */

// ─── Core types ───────────────────────────────────────────────────────────────

export type ProviderKind = "cli" | "api" | "local";
export type ModelTier = "small" | "medium" | "large";

export interface ModelPricing {
	/** USD per 1M input tokens. */
	inputPer1M: number;
	/** USD per 1M output tokens. */
	outputPer1M: number;
	/** USD per 1M cache-read tokens (Anthropic only). */
	cacheReadPer1M?: number;
	/** USD per 1M cache-write tokens (Anthropic only). */
	cacheWritePer1M?: number;
}

export interface ModelDefinition {
	/** Canonical identifier sent to the CLI/API, e.g. "claude-sonnet-4-5". */
	id: string;
	/** Human-readable name for the UI. */
	displayName: string;
	/** Provider this model belongs to. */
	providerId: string;
	tier: ModelTier;
	contextWindowK: number;
	pricing: ModelPricing;
	supportsVision: boolean;
	supportsToolUse: boolean;
	/** True for "auto" pseudo-model — provider picks at runtime. */
	isAlias?: boolean;
}

export interface ProviderDefinition {
	/** Unique key used in the adapter registry, e.g. "claude". */
	id: string;
	displayName: string;
	kind: ProviderKind;
	models: ModelDefinition[];
	defaultModel: string;
	/** URL to sign up / get an API key (shown in Settings). */
	signupUrl?: string;
	/** Environment variable name that holds the API key. */
	apiKeyEnvVar?: string;
}

// ─── Provider & model definitions ────────────────────────────────────────────

const ANTHROPIC_CLAUDE: ProviderDefinition = {
	id: "claude",
	displayName: "Claude Code (Anthropic)",
	kind: "cli",
	signupUrl: "https://claude.ai/code",
	apiKeyEnvVar: "ANTHROPIC_API_KEY",
	defaultModel: "auto",
	models: [
		{
			id: "auto",
			displayName: "Auto (Claude picks)",
			providerId: "claude",
			tier: "large",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 15.0,
				outputPer1M: 75.0,
				cacheReadPer1M: 1.5,
				cacheWritePer1M: 18.75,
			},
			supportsVision: true,
			supportsToolUse: true,
			isAlias: true,
		},
		{
			id: "claude-opus-4-5",
			displayName: "Claude Opus 4.5",
			providerId: "claude",
			tier: "large",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 15.0,
				outputPer1M: 75.0,
				cacheReadPer1M: 1.5,
				cacheWritePer1M: 18.75,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "claude-sonnet-4-5",
			displayName: "Claude Sonnet 4.5",
			providerId: "claude",
			tier: "medium",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 3.0,
				outputPer1M: 15.0,
				cacheReadPer1M: 0.3,
				cacheWritePer1M: 3.75,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "claude-haiku-4-5",
			displayName: "Claude Haiku 4.5",
			providerId: "claude",
			tier: "small",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 0.8,
				outputPer1M: 4.0,
				cacheReadPer1M: 0.08,
				cacheWritePer1M: 1.0,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

const OPENAI_CODEX: ProviderDefinition = {
	id: "codex",
	displayName: "Codex CLI (OpenAI)",
	kind: "cli",
	signupUrl: "https://platform.openai.com",
	apiKeyEnvVar: "OPENAI_API_KEY",
	defaultModel: "gpt-4o",
	models: [
		{
			id: "gpt-4o",
			displayName: "GPT-4o",
			providerId: "codex",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 2.5, outputPer1M: 10.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gpt-4o-mini",
			displayName: "GPT-4o mini",
			providerId: "codex",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "o1",
			displayName: "o1",
			providerId: "codex",
			tier: "large",
			contextWindowK: 200,
			pricing: { inputPer1M: 15.0, outputPer1M: 60.0 },
			supportsVision: true,
			supportsToolUse: false,
		},
	],
};

const GOOGLE_GEMINI: ProviderDefinition = {
	id: "gemini",
	displayName: "Gemini CLI (Google)",
	kind: "cli",
	signupUrl: "https://ai.google.dev",
	apiKeyEnvVar: "GEMINI_API_KEY",
	defaultModel: "gemini-2.5-pro",
	models: [
		{
			id: "gemini-2.5-pro",
			displayName: "Gemini 2.5 Pro",
			providerId: "gemini",
			tier: "large",
			contextWindowK: 1000,
			pricing: { inputPer1M: 1.25, outputPer1M: 5.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gemini-2.5-flash",
			displayName: "Gemini 2.5 Flash",
			providerId: "gemini",
			tier: "small",
			contextWindowK: 1000,
			pricing: { inputPer1M: 0.075, outputPer1M: 0.3 },
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

const OPENCODE: ProviderDefinition = {
	id: "opencode",
	displayName: "OpenCode CLI",
	kind: "cli",
	signupUrl: "https://opencode.ai",
	defaultModel: "gpt-4o",
	models: [
		// OpenCode is OpenAI-compatible — these are the commonly used models.
		// The user can type any model ID supported by their configured endpoint.
		{
			id: "gpt-4o",
			displayName: "GPT-4o (via OpenCode)",
			providerId: "opencode",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 2.5, outputPer1M: 10.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gpt-4o-mini",
			displayName: "GPT-4o mini (via OpenCode)",
			providerId: "opencode",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

const SOURCEGRAPH_AMP: ProviderDefinition = {
	id: "amp",
	displayName: "Amp (Sourcegraph)",
	kind: "cli",
	signupUrl: "https://ampcode.com",
	defaultModel: "claude-sonnet-4-5",
	models: [
		// Amp exposes Claude and other models through their gateway.
		// Model IDs are Amp-specific pass-through strings.
		{
			id: "claude-sonnet-4-5",
			displayName: "Claude Sonnet 4.5 (via Amp)",
			providerId: "amp",
			tier: "medium",
			contextWindowK: 200,
			pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "claude-opus-4-5",
			displayName: "Claude Opus 4.5 (via Amp)",
			providerId: "amp",
			tier: "large",
			contextWindowK: 200,
			pricing: { inputPer1M: 15.0, outputPer1M: 75.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

// ─── API-based providers (setra calls the API directly, no binary needed) ─────

const ANTHROPIC_API: ProviderDefinition = {
	id: "anthropic-api",
	displayName: "Anthropic API (direct)",
	kind: "api",
	signupUrl: "https://console.anthropic.com",
	apiKeyEnvVar: "ANTHROPIC_API_KEY",
	defaultModel: "claude-sonnet-4-5",
	models: [
		{
			id: "claude-opus-4-5",
			displayName: "Claude Opus 4.5",
			providerId: "anthropic-api",
			tier: "large",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 15.0,
				outputPer1M: 75.0,
				cacheReadPer1M: 1.5,
				cacheWritePer1M: 18.75,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "claude-sonnet-4-5",
			displayName: "Claude Sonnet 4.5",
			providerId: "anthropic-api",
			tier: "medium",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 3.0,
				outputPer1M: 15.0,
				cacheReadPer1M: 0.3,
				cacheWritePer1M: 3.75,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "claude-haiku-4-5",
			displayName: "Claude Haiku 4.5",
			providerId: "anthropic-api",
			tier: "small",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 0.8,
				outputPer1M: 4.0,
				cacheReadPer1M: 0.08,
				cacheWritePer1M: 1.0,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		// Dated version for the small-model pattern (pinned for reproducibility)
		{
			id: "claude-haiku-4-5-20251001",
			displayName: "Claude Haiku 4.5 (2025-10-01)",
			providerId: "anthropic-api",
			tier: "small",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 0.8,
				outputPer1M: 4.0,
				cacheReadPer1M: 0.08,
				cacheWritePer1M: 1.0,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

const OPENAI_API: ProviderDefinition = {
	id: "openai-api",
	displayName: "OpenAI API (direct)",
	kind: "api",
	signupUrl: "https://platform.openai.com",
	apiKeyEnvVar: "OPENAI_API_KEY",
	defaultModel: "gpt-4o",
	models: [
		{
			id: "gpt-4o",
			displayName: "GPT-4o",
			providerId: "openai-api",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 2.5, outputPer1M: 10.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gpt-4o-mini",
			displayName: "GPT-4o mini",
			providerId: "openai-api",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "o1",
			displayName: "o1",
			providerId: "openai-api",
			tier: "large",
			contextWindowK: 200,
			pricing: { inputPer1M: 15.0, outputPer1M: 60.0 },
			supportsVision: true,
			supportsToolUse: false,
		},
	],
};

const OLLAMA: ProviderDefinition = {
	id: "ollama",
	displayName: "Ollama (local / air-gap)",
	kind: "local",
	defaultModel: "qwen2.5-coder:7b",
	models: [
		// ── Models are discovered dynamically at runtime via GET /api/tags.
		// ── This list is setra's curated catalogue — shown in the "Pull model" UI
		//    before the user has pulled them. Divided into LLM and SLM sections.
		//
		// ── SLM (Small Language Models) — optimised for code, run on CPU/4GB RAM
		//    Ideal for: governance, air-gap, low-resource machines, edge deployments
		// ─────────────────────────────────────────────────────────────────────────
		{
			id: "qwen2.5-coder:1.5b",
			displayName: "Qwen 2.5 Coder 1.5B  [SLM · ~1GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 32,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "qwen2.5-coder:7b",
			displayName: "Qwen 2.5 Coder 7B  [SLM · ~4GB] ★ recommended",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "qwen2.5-coder:14b",
			displayName: "Qwen 2.5 Coder 14B  [SLM · ~8GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "qwen2.5-coder:32b",
			displayName: "Qwen 2.5 Coder 32B  [SLM · ~20GB]",
			providerId: "ollama",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "phi4",
			displayName: "Phi-4 14B (Microsoft)  [SLM · ~8GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 16,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "phi4-mini",
			displayName: "Phi-4 Mini 3.8B  [SLM · ~2GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 16,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "gemma3:4b",
			displayName: "Gemma 3 4B (Google)  [SLM · ~2.5GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gemma3:12b",
			displayName: "Gemma 3 12B (Google)  [SLM · ~7GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "deepseek-r1:1.5b",
			displayName: "DeepSeek-R1 1.5B (reasoning)  [SLM · ~1GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 64,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: false,
		},
		{
			id: "deepseek-r1:7b",
			displayName: "DeepSeek-R1 7B (reasoning)  [SLM · ~4GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 64,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: false,
		},
		{
			id: "deepseek-r1:14b",
			displayName: "DeepSeek-R1 14B (reasoning)  [SLM · ~8GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 64,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: false,
		},
		{
			id: "codellama:7b",
			displayName: "CodeLlama 7B  [SLM · ~4GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 16,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: false,
		},
		{
			id: "codellama:34b",
			displayName: "CodeLlama 34B  [SLM · ~19GB]",
			providerId: "ollama",
			tier: "large",
			contextWindowK: 16,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: false,
		},
		// ── LLM (Large Language Models) — full-size, GPU recommended
		// ─────────────────────────────────────────────────────────────────────────
		{
			id: "llama3.3:70b",
			displayName: "Llama 3.3 70B  [LLM · ~40GB GPU]",
			providerId: "ollama",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "llama3.2",
			displayName: "Llama 3.2 3B  [SLM · ~2GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "llama3.1:8b",
			displayName: "Llama 3.1 8B  [SLM · ~5GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "mistral:7b",
			displayName: "Mistral 7B  [SLM · ~4GB]",
			providerId: "ollama",
			tier: "small",
			contextWindowK: 32,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "deepseek-coder-v2",
			displayName: "DeepSeek Coder V2 (16B)  [SLM · ~9GB]",
			providerId: "ollama",
			tier: "medium",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
	],
};

const CUSTOM_OPENAI_COMPATIBLE: ProviderDefinition = {
	id: "custom-openai",
	displayName: "Custom OpenAI-compatible",
	kind: "api",
	defaultModel: "custom",
	models: [
		{
			id: "custom",
			displayName: "Custom model (user-configured)",
			providerId: "custom-openai",
			tier: "medium",
			contextWindowK: 128,
			pricing: { inputPer1M: 0, outputPer1M: 0 },
			supportsVision: false,
			supportsToolUse: true,
		},
	],
};

// ─── AWS Bedrock ──────────────────────────────────────────────────────────────
/**
 * AWS Bedrock — Claude, Llama, Titan and other models via AWS infrastructure.
 * Uses standard AWS credentials (IAM role / access key + secret).
 * Ideal for teams already on AWS; data stays in chosen AWS region.
 *
 * Auth:  AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION
 *        OR: IAM instance profile (no env vars needed on EC2/ECS)
 * Docs:  https://aws.amazon.com/bedrock/
 */
const AWS_BEDROCK: ProviderDefinition = {
	id: "aws-bedrock",
	displayName: "AWS Bedrock",
	kind: "api",
	signupUrl: "https://aws.amazon.com/bedrock/",
	apiKeyEnvVar: "AWS_ACCESS_KEY_ID", // proxy check — also needs AWS_SECRET_ACCESS_KEY
	defaultModel: "anthropic.claude-sonnet-4-5",
	models: [
		// ── Claude models via Bedrock (same quality as direct Anthropic, AWS billing)
		{
			id: "anthropic.claude-opus-4",
			displayName: "Claude Opus 4 (Bedrock)",
			providerId: "aws-bedrock",
			tier: "large",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 15.0,
				outputPer1M: 75.0,
				cacheReadPer1M: 1.5,
				cacheWritePer1M: 18.75,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "anthropic.claude-sonnet-4-5",
			displayName: "Claude Sonnet 4.5 (Bedrock)",
			providerId: "aws-bedrock",
			tier: "medium",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 3.0,
				outputPer1M: 15.0,
				cacheReadPer1M: 0.3,
				cacheWritePer1M: 3.75,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "anthropic.claude-haiku-4",
			displayName: "Claude Haiku 4 (Bedrock)",
			providerId: "aws-bedrock",
			tier: "small",
			contextWindowK: 200,
			pricing: {
				inputPer1M: 0.8,
				outputPer1M: 4.0,
				cacheReadPer1M: 0.08,
				cacheWritePer1M: 1.0,
			},
			supportsVision: true,
			supportsToolUse: true,
		},
		// ── Meta Llama via Bedrock
		{
			id: "meta.llama3-3-70b-instruct-v1",
			displayName: "Llama 3.3 70B Instruct (Bedrock)",
			providerId: "aws-bedrock",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 0.72, outputPer1M: 0.72 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "meta.llama3-1-8b-instruct-v1",
			displayName: "Llama 3.1 8B Instruct (Bedrock)",
			providerId: "aws-bedrock",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0.22, outputPer1M: 0.22 },
			supportsVision: false,
			supportsToolUse: true,
		},
		// ── Amazon Nova (AWS native)
		{
			id: "amazon.nova-pro-v1",
			displayName: "Amazon Nova Pro (Bedrock)",
			providerId: "aws-bedrock",
			tier: "large",
			contextWindowK: 300,
			pricing: { inputPer1M: 0.8, outputPer1M: 3.2 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "amazon.nova-lite-v1",
			displayName: "Amazon Nova Lite (Bedrock)",
			providerId: "aws-bedrock",
			tier: "small",
			contextWindowK: 300,
			pricing: { inputPer1M: 0.06, outputPer1M: 0.24 },
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

// ─── GCP Vertex AI ────────────────────────────────────────────────────────────
/**
 * Google Cloud Vertex AI — Gemini, Claude (via Model Garden), and more.
 * Data stays in chosen GCP region. Ideal for teams on GCP.
 *
 * Auth:  GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
 *        OR: GCP_PROJECT_ID + Application Default Credentials (gcloud auth)
 * Docs:  https://cloud.google.com/vertex-ai
 */
const GCP_VERTEX: ProviderDefinition = {
	id: "gcp-vertex",
	displayName: "GCP Vertex AI",
	kind: "api",
	signupUrl: "https://cloud.google.com/vertex-ai",
	apiKeyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS",
	defaultModel: "gemini-2.5-pro",
	models: [
		// ── Gemini models via Vertex (same models, GCP billing + data residency)
		{
			id: "gemini-2.5-pro",
			displayName: "Gemini 2.5 Pro (Vertex)",
			providerId: "gcp-vertex",
			tier: "large",
			contextWindowK: 1000,
			pricing: { inputPer1M: 1.25, outputPer1M: 5.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gemini-2.0-flash",
			displayName: "Gemini 2.0 Flash (Vertex)",
			providerId: "gcp-vertex",
			tier: "medium",
			contextWindowK: 1000,
			pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "gemini-2.0-flash-lite",
			displayName: "Gemini 2.0 Flash-Lite (Vertex)",
			providerId: "gcp-vertex",
			tier: "small",
			contextWindowK: 1000,
			pricing: { inputPer1M: 0.075, outputPer1M: 0.3 },
			supportsVision: true,
			supportsToolUse: true,
		},
		// ── Claude via Vertex Model Garden
		{
			id: "claude-sonnet-4@20251022",
			displayName: "Claude Sonnet 4 (Vertex Model Garden)",
			providerId: "gcp-vertex",
			tier: "medium",
			contextWindowK: 200,
			pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		// ── Code models
		{
			id: "code-gecko@002",
			displayName: "Codey (Code Gecko, Vertex)",
			providerId: "gcp-vertex",
			tier: "small",
			contextWindowK: 6,
			pricing: { inputPer1M: 0.1, outputPer1M: 0.1 },
			supportsVision: false,
			supportsToolUse: false,
		},
	],
};

// ─── Azure OpenAI ─────────────────────────────────────────────────────────────
/**
 * Azure OpenAI — GPT-4o, o1, and other OpenAI models via Azure infrastructure.
 * Data residency in Azure region. SOC2/HIPAA/ISO compliance available.
 * Ideal for enterprises already on Azure or with Microsoft EA.
 *
 * Auth:  AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_VERSION
 *        e.g. AZURE_OPENAI_ENDPOINT=https://mycompany.openai.azure.com/
 * Docs:  https://azure.microsoft.com/en-us/products/ai-services/openai-service
 *
 * Note: Azure requires deploying model instances (deployments) in the portal.
 *       The model IDs below are deployment name conventions — users configure
 *       their actual deployment names in Settings → Providers → Azure.
 */
const AZURE_OPENAI: ProviderDefinition = {
	id: "azure-openai",
	displayName: "Azure OpenAI",
	kind: "api",
	signupUrl:
		"https://azure.microsoft.com/en-us/products/ai-services/openai-service",
	apiKeyEnvVar: "AZURE_OPENAI_API_KEY",
	defaultModel: "azure/gpt-4o",
	models: [
		{
			id: "azure/gpt-4o",
			displayName: "GPT-4o (Azure)",
			providerId: "azure-openai",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 2.5, outputPer1M: 10.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "azure/gpt-4o-mini",
			displayName: "GPT-4o mini (Azure)",
			providerId: "azure-openai",
			tier: "small",
			contextWindowK: 128,
			pricing: { inputPer1M: 0.165, outputPer1M: 0.66 },
			supportsVision: true,
			supportsToolUse: true,
		},
		{
			id: "azure/o1",
			displayName: "o1 (Azure)",
			providerId: "azure-openai",
			tier: "large",
			contextWindowK: 200,
			pricing: { inputPer1M: 15.0, outputPer1M: 60.0 },
			supportsVision: true,
			supportsToolUse: false,
		},
		{
			id: "azure/o3-mini",
			displayName: "o3-mini (Azure)",
			providerId: "azure-openai",
			tier: "medium",
			contextWindowK: 200,
			pricing: { inputPer1M: 1.1, outputPer1M: 4.4 },
			supportsVision: false,
			supportsToolUse: true,
		},
		{
			id: "azure/gpt-4-turbo",
			displayName: "GPT-4 Turbo (Azure)",
			providerId: "azure-openai",
			tier: "large",
			contextWindowK: 128,
			pricing: { inputPer1M: 10.0, outputPer1M: 30.0 },
			supportsVision: true,
			supportsToolUse: true,
		},
	],
};

// ─── Registry ─────────────────────────────────────────────────────────────────

/** Ordered list of all providers. CLI providers first (primary user flow). */
export const ALL_PROVIDERS: readonly ProviderDefinition[] = [
	// CLI-based
	ANTHROPIC_CLAUDE,
	OPENAI_CODEX,
	GOOGLE_GEMINI,
	OPENCODE,
	SOURCEGRAPH_AMP,
	// Direct API
	ANTHROPIC_API,
	OPENAI_API,
	// Enterprise cloud (data residency + compliance)
	AWS_BEDROCK,
	GCP_VERTEX,
	AZURE_OPENAI,
	// Local / air-gap
	OLLAMA,
	CUSTOM_OPENAI_COMPATIBLE,
] as const;

/** Lookup map: providerId → ProviderDefinition */
export const PROVIDER_MAP: ReadonlyMap<string, ProviderDefinition> = new Map(
	ALL_PROVIDERS.map((p) => [p.id, p]),
);

/** Flat lookup map: modelId → ModelDefinition (across all providers). */
export const MODEL_MAP: ReadonlyMap<string, ModelDefinition> = new Map(
	ALL_PROVIDERS.flatMap((p) => p.models.map((m) => [m.id, m] as const)),
);

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getProvider(id: string): ProviderDefinition | undefined {
	return PROVIDER_MAP.get(id);
}

export function getModel(id: string): ModelDefinition | undefined {
	return MODEL_MAP.get(id);
}

/**
 * Resolve the effective model ID for a run, handling "auto" aliases.
 * Falls back to the provider's defaultModel if modelId is "auto" or unknown.
 */
export function resolveModel(providerId: string, modelId: string): string {
	const provider = PROVIDER_MAP.get(providerId);
	if (!provider) return modelId;

	if (modelId === "auto" || !provider.models.some((m) => m.id === modelId)) {
		return provider.defaultModel;
	}
	return modelId;
}

/**
 * Compute the estimated cost in USD for a given number of tokens.
 * Returns null if the model is unknown or pricing is unavailable.
 */
export function estimateCost(
	modelId: string,
	promptTokens: number,
	completionTokens: number,
	cacheReadTokens = 0,
	cacheWriteTokens = 0,
): number | null {
	const model = MODEL_MAP.get(modelId);
	if (!model) return null;

	const { pricing } = model;
	let cost =
		(promptTokens / 1_000_000) * pricing.inputPer1M +
		(completionTokens / 1_000_000) * pricing.outputPer1M;

	if (pricing.cacheReadPer1M != null) {
		cost += (cacheReadTokens / 1_000_000) * pricing.cacheReadPer1M;
	}
	if (pricing.cacheWritePer1M != null) {
		cost += (cacheWriteTokens / 1_000_000) * pricing.cacheWritePer1M;
	}
	return cost;
}

/**
 * Returns CLI providers (those the user must have installed).
 * Used to populate the "which CLI do you have?" onboarding check.
 */
export function cliProviders(): ProviderDefinition[] {
	return ALL_PROVIDERS.filter((p) => p.kind === "cli");
}

/**
 * Returns API providers (setra calls the API directly).
 */
export function apiProviders(): ProviderDefinition[] {
	return ALL_PROVIDERS.filter((p) => p.kind === "api" || p.kind === "local");
}
