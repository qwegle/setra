import {
	BaseNode,
	type PipelineLlmCall,
	type PipelineState,
} from "../base-node.js";

interface LlmNodeRuntimeConfig {
	promptTemplate: string;
	model?: string;
	maxTokens?: number;
	outputKey: string;
}

/**
 * Renders a prompt template from state and executes an injected LLM callback.
 */
export class LlmNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const promptTemplate = this.getRequiredConfig("promptTemplate");
		const outputKey = this.getRequiredConfig("outputKey");
		const model = this.getOptionalConfig("model");
		void this.getOptionalConfig("maxTokens");

		const llmCall = state["__llmCall"];
		if (!isLlmCall(llmCall)) {
			throw new Error("LlmNode requires state.__llmCall to be a function.");
		}

		const prompt = renderTemplate(promptTemplate, state);
		const response = await llmCall(prompt, model);
		this.setExecutionMetrics({
			tokensUsed: response.tokens,
			costUsd: response.costUsd,
		});

		return {
			...state,
			[outputKey]: response.content,
		};
	}

	private getRequiredConfig<K extends keyof LlmNodeRuntimeConfig>(
		key: K,
	): NonNullable<LlmNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<LlmNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(`Missing required LlmNode config: ${String(key)}.`);
		}
		return value as NonNullable<LlmNodeRuntimeConfig[K]>;
	}

	private getOptionalConfig<K extends keyof LlmNodeRuntimeConfig>(
		key: K,
	): LlmNodeRuntimeConfig[K] | undefined {
		return this.getConfigValue<LlmNodeRuntimeConfig[K]>(key);
	}
}

function isLlmCall(value: unknown): value is PipelineLlmCall {
	return typeof value === "function";
}

function renderTemplate(template: string, state: PipelineState): string {
	return template.replace(
		/{{\s*([A-Za-z0-9_.-]+)\s*}}/g,
		(_match, key: string) => {
			const value = state[key];
			if (value === undefined || value === null) {
				return "";
			}
			if (typeof value === "string") {
				return value;
			}
			return JSON.stringify(value, null, 2);
		},
	);
}
