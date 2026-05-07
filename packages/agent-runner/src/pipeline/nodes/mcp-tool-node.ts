import {
	BaseNode,
	type PipelineMcpResponse,
	type PipelineState,
	type PipelineTokenUsage,
} from "../base-node.js";

interface McpToolNodeRuntimeConfig {
	toolName: string;
	argsMapping: Record<string, string>;
	outputKey: string;
}

/**
 * Calls an injected MCP tool callback with arguments sourced from pipeline state.
 */
export class McpToolNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const toolName = this.getRequiredConfig("toolName");
		const argsMapping = this.getRequiredConfig("argsMapping");
		const outputKey = this.getRequiredConfig("outputKey");
		const mcpCall = state["__mcpCall"];

		if (typeof mcpCall !== "function") {
			throw new Error("McpToolNode requires state.__mcpCall to be a function.");
		}

		const args = Object.fromEntries(
			Object.entries(argsMapping).map(([argumentName, stateKey]) => [
				argumentName,
				state[stateKey],
			]),
		);
		const response = await mcpCall(toolName, args);
		const normalized = normalizeResponse(response);
		const metrics: {
			tokensUsed?: PipelineTokenUsage;
			costUsd?: number;
		} = {};
		if (normalized.tokens) {
			metrics.tokensUsed = normalized.tokens;
		}
		if (normalized.costUsd !== undefined) {
			metrics.costUsd = normalized.costUsd;
		}
		this.setExecutionMetrics(metrics);

		return {
			...state,
			[outputKey]: normalized.content,
		};
	}

	private getRequiredConfig<K extends keyof McpToolNodeRuntimeConfig>(
		key: K,
	): NonNullable<McpToolNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<McpToolNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(`Missing required McpToolNode config: ${String(key)}.`);
		}
		return value as NonNullable<McpToolNodeRuntimeConfig[K]>;
	}
}

function normalizeResponse(response: unknown): {
	content: unknown;
	tokens?: PipelineMcpResponse["tokens"];
	costUsd?: number;
} {
	if (isMcpResponse(response) && "content" in response) {
		const normalized: {
			content: unknown;
			tokens?: PipelineMcpResponse["tokens"];
			costUsd?: number;
		} = {
			content: response.content,
			costUsd: response.costUsd ?? 0,
		};
		if (response.tokens) {
			normalized.tokens = response.tokens;
		}
		return normalized;
	}
	return {
		content: response,
		costUsd: 0,
	};
}

function isMcpResponse(value: unknown): value is PipelineMcpResponse {
	return typeof value === "object" && value !== null;
}
