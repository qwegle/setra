const CLOUD_ADAPTERS = new Set([
	"anthropic-api",
	"openai-api",
	"gemini-api",
	"openrouter",
	"groq",
	"claude",
	"codex",
	"gemini",
	"claude-local",
	"codex-local",
	"gemini-local",
	"claude_local",
	"codex_local",
	"gemini_local",
]);

export function normalizeAdapterId(
	adapterType: string | null | undefined,
): string {
	const normalized = (adapterType ?? "")
		.trim()
		.toLowerCase()
		.replaceAll("_", "-");
	if (normalized === "claude-local") return "anthropic-api";
	if (normalized === "codex-local") return "openai-api";
	if (normalized === "gemini-local") return "gemini-api";
	return normalized;
}

export function isCloudAdapter(
	adapterType: string | null | undefined,
): boolean {
	const normalized = normalizeAdapterId(adapterType);
	return CLOUD_ADAPTERS.has(normalized);
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
