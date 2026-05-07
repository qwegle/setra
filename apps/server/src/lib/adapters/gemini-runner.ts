import { estimateCanonicalModelCost } from "../model-pricing.js";
import type { AdapterLoopInput, LlmCallResult } from "../types.js";
import { callOpenAiWithTools } from "./openai-runner.js";

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
	};
}

export async function callGeminiOnce(
	model: string,
	systemPrompt: string,
	task: string,
	apiKey: string,
): Promise<LlmCallResult> {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: systemPrompt }] },
			contents: [{ role: "user", parts: [{ text: task }] }],
		}),
	});
	if (!resp.ok) {
		const text = (await resp.text()).slice(0, 300);
		throw new Error(`gemini-api ${resp.status}: ${text}`);
	}
	const data = (await resp.json()) as GeminiResponse;
	const content =
		data.candidates?.[0]?.content?.parts
			?.map((part) => part.text ?? "")
			.join("")
			.trim() ?? "";
	const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
	const completionTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
	return {
		content,
		usage: {
			promptTokens,
			completionTokens,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		costUsd: estimateCanonicalModelCost(model, promptTokens, completionTokens),
	};
}

export function callGeminiWithTools(
	input: AdapterLoopInput & { apiKey: string },
): Promise<LlmCallResult> {
	return callOpenAiWithTools({
		...input,
		apiKey: input.apiKey,
		baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
	});
}
