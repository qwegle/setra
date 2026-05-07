import type { LlmCallResult, TextCallInput } from "../types.js";
import { callAnthropicOnce } from "./anthropic-runner.js";
import { callGeminiOnce } from "./gemini-runner.js";
import { callOpenAiCompatibleTextOnce } from "./openai-runner.js";

export async function callAdapterTextOnce(
	input: TextCallInput,
): Promise<LlmCallResult> {
	if (input.adapterId === "anthropic-api") {
		return callAnthropicOnce(
			input.model,
			input.systemPrompt,
			input.task,
			input.runtimeKeys.anthropicKey!,
			input.maxTokens,
		);
	}
	if (input.adapterId === "gemini-api") {
		return callGeminiOnce(
			input.model,
			input.systemPrompt,
			input.task,
			input.runtimeKeys.geminiKey!,
		);
	}
	if (
		input.adapterId === "openai-api" ||
		input.adapterId === "openrouter" ||
		input.adapterId === "groq"
	) {
		let baseUrl: string | undefined;
		let apiKey = input.runtimeKeys.openAiKey;
		if (input.adapterId === "openrouter") {
			baseUrl = "https://openrouter.ai/api/v1";
			apiKey = input.runtimeKeys.openRouterKey ?? apiKey;
		} else if (input.adapterId === "groq") {
			baseUrl = "https://api.groq.com/openai/v1";
			apiKey = input.runtimeKeys.groqKey ?? apiKey;
		} else {
			baseUrl = process.env.OPENAI_BASE_URL;
		}
		return callOpenAiCompatibleTextOnce({
			model: input.model,
			systemPrompt: input.systemPrompt,
			task: input.task,
			apiKey: apiKey!,
			...(baseUrl !== undefined ? { baseUrl } : {}),
			maxTokens: input.maxTokens,
		});
	}
	if (input.adapterId === "ollama") {
		const { callOllamaOnce } = await import("@setra/agent-runner");
		return (await callOllamaOnce(
			input.model,
			input.systemPrompt,
			input.task,
			input.maxTokens ?? 4096,
		)) as LlmCallResult;
	}
	throw new Error(`Unsupported pipeline adapter: ${input.adapterId}`);
}
