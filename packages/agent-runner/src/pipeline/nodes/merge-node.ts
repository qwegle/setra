import {
	BaseNode,
	type PipelineLlmCall,
	type PipelineState,
} from "../base-node.js";

interface MergeNodeRuntimeConfig {
	inputKeys: string[];
	strategy: "llm" | "concat" | "first" | "last";
	mergePrompt?: string;
	outputKey: string;
	model?: string;
}

/**
 * Merges multiple state values into a single output using a configurable strategy.
 */
export class MergeNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const inputKeys = this.getRequiredConfig("inputKeys");
		const strategy = this.getRequiredConfig("strategy");
		const outputKey = this.getRequiredConfig("outputKey");
		const values = inputKeys
			.map((key) => state[key])
			.filter((value) => value !== undefined);

		let merged: unknown;
		if (strategy === "concat") {
			merged = concatenateValues(values);
			this.setExecutionMetrics({});
		} else if (strategy === "first") {
			merged = values[0] ?? null;
			this.setExecutionMetrics({});
		} else if (strategy === "last") {
			merged = values.at(-1) ?? null;
			this.setExecutionMetrics({});
		} else {
			const llmCall = state["__llmCall"];
			if (!isLlmCall(llmCall)) {
				throw new Error(
					'MergeNode with strategy "llm" requires state.__llmCall.',
				);
			}
			const mergePrompt =
				this.getOptionalConfig("mergePrompt") ??
				[
					inputKeys.map((key) => `${key}: {{${key}}}`).join("\n\n"),
					"Combine these into a single result.",
				].join("\n\n");
			const response = await llmCall(
				renderTemplate(mergePrompt, state),
				this.getOptionalConfig("model"),
			);
			merged = response.content;
			this.setExecutionMetrics({
				tokensUsed: response.tokens,
				costUsd: response.costUsd,
			});
		}

		return {
			...state,
			[outputKey]: merged,
		};
	}

	private getRequiredConfig<K extends keyof MergeNodeRuntimeConfig>(
		key: K,
	): NonNullable<MergeNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<MergeNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(`Missing required MergeNode config: ${String(key)}.`);
		}
		return value as NonNullable<MergeNodeRuntimeConfig[K]>;
	}

	private getOptionalConfig<K extends keyof MergeNodeRuntimeConfig>(
		key: K,
	): MergeNodeRuntimeConfig[K] | undefined {
		return this.getConfigValue<MergeNodeRuntimeConfig[K]>(key);
	}
}

function isLlmCall(value: unknown): value is PipelineLlmCall {
	return typeof value === "function";
}

function concatenateValues(values: unknown[]): unknown {
	if (values.every(Array.isArray)) {
		return values.flatMap((value) => value as unknown[]);
	}
	if (values.every((value) => typeof value === "string")) {
		return values.join("\n\n");
	}
	return values;
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
