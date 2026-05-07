import { estimateCost } from "@setra/agent-runner";
import {
	buildToolDefinitions,
	emptyUsage,
	executeToolCall,
	mergeUsage,
} from "../tool-executor.js";
import type { AdapterLoopInput, LlmCallResult } from "../types.js";

export async function callAnthropicOnce(
	model: string,
	systemPrompt: string,
	task: string,
	apiKey: string,
	maxTokens = 4096,
): Promise<LlmCallResult> {
	const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
	const endpoint = /\/v1\/messages\/?$/.test(baseUrl)
		? baseUrl
		: `${baseUrl.replace(/\/$/, "")}/v1/messages`;
	const resp = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model,
			max_tokens: maxTokens,
			system: systemPrompt,
			messages: [{ role: "user", content: task }],
		}),
	});
	if (!resp.ok) {
		const text = (await resp.text()).slice(0, 300);
		throw new Error(`anthropic-api ${resp.status}: ${text}`);
	}
	const data = (await resp.json()) as {
		content?: Array<{ type?: string; text?: string }>;
		usage?: {
			input_tokens?: number;
			output_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
		};
	};
	const usage = {
		promptTokens: data.usage?.input_tokens ?? 0,
		completionTokens: data.usage?.output_tokens ?? 0,
		cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
		cacheWriteTokens: data.usage?.cache_creation_input_tokens ?? 0,
	};
	return {
		content:
			data.content
				?.filter((part) => part.type === "text")
				.map((part) => part.text ?? "")
				.join("")
				.trim() ?? "",
		usage,
		costUsd:
			estimateCost(
				model,
				usage.promptTokens,
				usage.completionTokens,
				usage.cacheReadTokens,
				usage.cacheWriteTokens,
			) ?? 0,
	};
}

export async function callAnthropicWithTools(
	input: AdapterLoopInput & { apiKey: string },
): Promise<LlmCallResult> {
	const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
	const endpoint = /\/v1\/messages\/?$/.test(baseUrl)
		? baseUrl
		: `${baseUrl.replace(/\/$/, "")}/v1/messages`;
	const messages: Array<Record<string, unknown>> = [
		{ role: "user", content: input.task },
	];
	const toolContext = await buildToolDefinitions({
		agent: input.agent,
		issue: input.issue,
		companyId: input.companyId,
	});
	const tools = toolContext.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema,
	}));
	const usage = emptyUsage();
	const assistantTexts: string[] = [];
	for (let step = 0; step < 10; step++) {
		const resp = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": input.apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: input.model,
				max_tokens: input.maxTokens ?? 4096,
				system: input.systemPrompt,
				messages,
				...(tools.length > 0 ? { tools } : {}),
			}),
		});
		if (!resp.ok) {
			const text = (await resp.text()).slice(0, 300);
			throw new Error(`anthropic-api ${resp.status}: ${text}`);
		}
		const data = (await resp.json()) as {
			content?: Array<{
				type?: string;
				text?: string;
				id?: string;
				name?: string;
				input?: Record<string, unknown>;
			}>;
			stop_reason?: string;
			usage?: {
				input_tokens?: number;
				output_tokens?: number;
				cache_read_input_tokens?: number;
				cache_creation_input_tokens?: number;
			};
		};
		mergeUsage(usage, {
			promptTokens: data.usage?.input_tokens ?? 0,
			completionTokens: data.usage?.output_tokens ?? 0,
			cacheReadTokens: data.usage?.cache_read_input_tokens ?? 0,
			cacheWriteTokens: data.usage?.cache_creation_input_tokens ?? 0,
		});
		const blocks = data.content ?? [];
		const textContent = blocks
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("")
			.trim();
		if (textContent) assistantTexts.push(textContent);
		const toolUses = blocks.filter((block) => block.type === "tool_use");
		if (toolUses.length === 0 || data.stop_reason !== "tool_use") break;
		messages.push({ role: "assistant", content: blocks });
		let shouldStop = false;
		for (const block of toolUses) {
			const tool = toolContext.byName.get(block.name ?? "") ?? {
				name: block.name ?? "",
				description: block.name ?? "",
				inputSchema: {},
				kind: "builtin" as const,
			};
			const toolResult = await executeToolCall({
				tool,
				args: block.input ?? {},
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
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: block.id,
						content: toolResult.content,
					},
				],
			});
			if (toolResult.stopLoop) shouldStop = true;
		}
		if (shouldStop) break;
	}
	return {
		content: assistantTexts.join("\n\n").trim(),
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
