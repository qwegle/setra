const CLOUD_ADAPTERS = new Set([
	"anthropic-api",
	"openai-api",
	"aws-bedrock",
	"azure-openai",
	"gcp-vertex",
	"custom-openai",
	"claude",
	"codex",
	"gemini",
	"amp",
	"opencode",
]);

export function normalizeAdapterId(
	adapterType: string | null | undefined,
): string {
	const normalized = (adapterType ?? "")
		.trim()
		.toLowerCase()
		.replaceAll("_", "-");
	// Legacy aliases from old UI
	if (normalized === "claude-local") return "claude";
	if (normalized === "codex-local") return "codex";
	if (normalized === "gemini-local") return "gemini";
	if (normalized === "openrouter") return "custom-openai";
	if (normalized === "groq") return "custom-openai";
	return normalized;
}

export function isCloudAdapter(
	adapterType: string | null | undefined,
): boolean {
	const normalized = normalizeAdapterId(adapterType);
	return CLOUD_ADAPTERS.has(normalized);
}

/**
 * Classifies how an adapter is executed. Single source of truth replacing
 * the duplicated `SUPPORTED_ADAPTERS` / `ptyOnly` / `supported` sets that
 * used to live in dispatcher.ts and run-orchestrator.ts.
 *
 *   cloud-api    — server calls a hosted REST API (anthropic-api, openai-api,
 *                  gemini-api, openrouter, groq, aws-bedrock, azure-openai,
 *                  gcp-vertex, custom-openai).
 *   cli-server   — server shells out to a local CLI binary that supports
 *                  non-interactive `exec`-style invocation (codex).
 *   cli-pty      — only runnable via the Electron PTY bridge (claude, gemini,
 *                  amp, opencode).
 *   local-server — local model runtime reachable over HTTP (ollama).
 *   unknown      — adapter not classified yet.
 */
export type AdapterExecutionMode =
	| "cloud-api"
	| "cli-server"
	| "cli-pty"
	| "local-server"
	| "unknown";

const EXECUTION_MODES: Record<string, AdapterExecutionMode> = {
	"anthropic-api": "cloud-api",
	"openai-api": "cloud-api",
	"gemini-api": "cloud-api",
	openrouter: "cloud-api",
	groq: "cloud-api",
	"aws-bedrock": "cloud-api",
	"azure-openai": "cloud-api",
	"gcp-vertex": "cloud-api",
	"custom-openai": "cloud-api",
	codex: "cli-server",
	claude: "cli-pty",
	gemini: "cli-pty",
	amp: "cli-pty",
	opencode: "cli-pty",
	ollama: "local-server",
};

export function getAdapterExecutionMode(
	adapterType: string | null | undefined,
): AdapterExecutionMode {
	const normalized = normalizeAdapterId(adapterType);
	return EXECUTION_MODES[normalized] ?? "unknown";
}

/** True when the dispatcher can hand this adapter to the server runner. */
export function isServerRunnableAdapter(
	adapterType: string | null | undefined,
): boolean {
	const mode = getAdapterExecutionMode(adapterType);
	return (
		mode === "cloud-api" || mode === "cli-server" || mode === "local-server"
	);
}

/** True when this adapter must be executed by the Electron PTY bridge. */
export function isPtyOnlyAdapter(
	adapterType: string | null | undefined,
): boolean {
	return getAdapterExecutionMode(adapterType) === "cli-pty";
}

export function inferModelProvider(
	modelId: string | null | undefined,
): string | null {
	if (!modelId) return null;
	const m = modelId.trim().toLowerCase();
	if (!m) return null;
	if (m.startsWith("openrouter:")) return "openrouter";
	if (m.startsWith("groq:")) return "groq";
	if (m.startsWith("ollama:")) return "ollama";
	if (m.startsWith("gemini")) return "gemini";
	if (
		m.startsWith("gpt-") ||
		m.startsWith("o1") ||
		m.startsWith("o3") ||
		m.startsWith("o4")
	)
		return "openai";
	if (m.startsWith("claude")) return "anthropic";
	return null;
}

export function isCloudModel(modelId: string | null | undefined): boolean {
	const provider = inferModelProvider(modelId);
	if (!provider) return false;
	return (
		provider !== "ollama" &&
		provider !== "lmstudio" &&
		provider !== "llama-cpp" &&
		provider !== "mlx-lm" &&
		provider !== "exo"
	);
}
