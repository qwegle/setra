import { estimateCost } from "@setra/agent-runner";
import {
	buildToolDefinitions,
	emptyUsage,
	executeToolCall,
	mergeUsage,
	safeParseJsonObject,
} from "../tool-executor.js";
import type { AdapterLoopInput, LlmCallResult } from "../types.js";

export async function callOpenAiCompatibleTextOnce(input: {
	model: string;
	systemPrompt: string;
	task: string;
	apiKey: string;
	baseUrl?: string | undefined;
	maxTokens?: number | undefined;
}): Promise<LlmCallResult> {
	const endpoint = `${(input.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${input.apiKey}`,
		},
		body: JSON.stringify({
			model: input.model,
			max_completion_tokens: input.maxTokens ?? 4096,
			messages: [
				{ role: "system", content: input.systemPrompt },
				{ role: "user", content: input.task },
			],
		}),
	});
	if (!response.ok) {
		const body = (await response.text()).slice(0, 300);
		throw new Error(`openai-api ${response.status}: ${body}`);
	}
	const data = (await response.json()) as {
		choices?: Array<{
			message?: {
				content?: string | Array<{ type?: string; text?: string }> | null;
			};
		}>;
		usage?: { prompt_tokens?: number; completion_tokens?: number };
	};
	const rawContent = data.choices?.[0]?.message?.content;
	const content =
		typeof rawContent === "string"
			? rawContent.trim()
			: Array.isArray(rawContent)
				? rawContent
						.map((part) => part.text ?? "")
						.join("")
						.trim()
				: "";
	const usage = {
		promptTokens: data.usage?.prompt_tokens ?? 0,
		completionTokens: data.usage?.completion_tokens ?? 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	return {
		content,
		usage,
		costUsd:
			estimateCost(
				input.model,
				usage.promptTokens,
				usage.completionTokens,
				usage.cacheReadTokens,
				usage.cacheWriteTokens,
			) ?? 0,
	};
}

export async function callOpenAiWithTools(
	input: AdapterLoopInput & { apiKey: string; baseUrl?: string },
): Promise<LlmCallResult> {
	const endpoint = `${(input.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
	const messages: Array<Record<string, unknown>> = [
		{ role: "system", content: input.systemPrompt },
		{ role: "user", content: input.task },
	];
	const toolContext = await buildToolDefinitions({
		agent: input.agent,
		issue: input.issue,
		companyId: input.companyId,
	});
	const tools = toolContext.tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}));
	const usage = emptyUsage();
	const assistantTexts: string[] = [];
	for (let step = 0; step < 15; step++) {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${input.apiKey}`,
			},
			body: JSON.stringify({
				model: input.model,
				max_completion_tokens: input.maxTokens ?? 4096,
				messages,
				...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
			}),
		});
		if (!response.ok) {
			const body = (await response.text()).slice(0, 300);
			throw new Error(`openai-api ${response.status}: ${body}`);
		}
		const data = (await response.json()) as {
			choices?: Array<{
				message?: {
					content?: string | Array<{ type?: string; text?: string }> | null;
					tool_calls?: Array<{
						id: string;
						type?: string;
						function?: { name?: string; arguments?: string };
					}>;
				};
			}>;
			usage?: { prompt_tokens?: number; completion_tokens?: number };
		};
		usage.promptTokens += data.usage?.prompt_tokens ?? 0;
		usage.completionTokens += data.usage?.completion_tokens ?? 0;
		const message = data.choices?.[0]?.message;
		const rawContent = message?.content;
		const content =
			typeof rawContent === "string"
				? rawContent.trim()
				: Array.isArray(rawContent)
					? rawContent
							.map((part) => part.text ?? "")
							.join("")
							.trim()
					: "";
		if (content) assistantTexts.push(content);
		const toolCalls = message?.tool_calls ?? [];
		if (toolCalls.length === 0) break;
		messages.push({ role: "assistant", content, tool_calls: toolCalls });
		let shouldStop = false;
		for (const toolCall of toolCalls) {
			const fnName = toolCall.function?.name ?? "";
			const parsed = safeParseJsonObject(toolCall.function?.arguments);
			const tool = toolContext.byName.get(fnName) ?? {
				name: fnName,
				description: fnName,
				inputSchema: {},
				kind: "builtin" as const,
			};
			const toolResult = await executeToolCall({
				tool,
				args: parsed,
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
			mergeUsage(usage, toolResult.usage);
			messages.push({
				role: "tool",
				tool_call_id: toolCall.id,
				content: toolResult.content,
			});
			if (toolResult.stopLoop) shouldStop = true;
		}
		if (shouldStop) break;
	}
	const content = assistantTexts.join("\n\n").trim();
	return {
		content,
		usage,
		costUsd:
			estimateCost(
				input.model,
				usage.promptTokens,
				usage.completionTokens,
				usage.cacheReadTokens,
				usage.cacheWriteTokens,
			) ?? 0,
	};
}
