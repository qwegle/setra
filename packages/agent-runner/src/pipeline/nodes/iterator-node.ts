import { Pipeline, type PipelineConfig } from "../base-graph.js";
import { BaseNode, type PipelineState } from "../base-node.js";

interface IteratorNodeRuntimeConfig {
	itemsKey: string;
	subPipeline: PipelineConfig;
	concurrency?: number;
	outputKey: string;
}

/**
 * Result captured for each item processed by an IteratorNode.
 */
export interface IteratorItemResult {
	index: number;
	item: unknown;
	success: boolean;
	state: PipelineState;
	error?: string;
}

class Semaphore {
	private permits: number;
	private readonly waiting: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits -= 1;
			return;
		}

		await new Promise<void>((resolve) => {
			this.waiting.push(resolve);
		});
	}

	release(): void {
		const next = this.waiting.shift();
		if (next) {
			next();
			return;
		}
		this.permits += 1;
	}
}

/**
 * Fans out work across a bounded number of sub-pipeline executions.
 */
export class IteratorNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const itemsKey = this.getRequiredConfig("itemsKey");
		const subPipeline = this.getRequiredConfig("subPipeline");
		const outputKey = this.getRequiredConfig("outputKey");
		const concurrency = normalizeConcurrency(
			this.getOptionalConfig("concurrency"),
		);
		const items = state[itemsKey];

		if (!Array.isArray(items)) {
			throw new Error(
				`IteratorNode expected state.${itemsKey} to be an array.`,
			);
		}

		const semaphore = new Semaphore(concurrency);
		const results: IteratorItemResult[] = new Array(items.length);
		let totalCostUsd = 0;
		let totalPromptTokens = 0;
		let totalCompletionTokens = 0;

		await Promise.all(
			items.map(async (item, index) => {
				await semaphore.acquire();
				try {
					const pipeline = new Pipeline(subPipeline);
					const result = await pipeline.run({
						...state,
						item,
						iterator_item: item,
						iterator_index: index,
					});
					totalCostUsd += result.totalCostUsd;
					totalPromptTokens += result.totalTokens.prompt;
					totalCompletionTokens += result.totalTokens.completion;
					const itemResult: IteratorItemResult = {
						index,
						item,
						success: result.success,
						state: result.state,
					};
					if (result.error) {
						itemResult.error = result.error;
					}
					results[index] = itemResult;
				} finally {
					semaphore.release();
				}
			}),
		);

		this.setExecutionMetrics({
			tokensUsed: {
				prompt: totalPromptTokens,
				completion: totalCompletionTokens,
			},
			costUsd: totalCostUsd,
		});

		return {
			...state,
			[outputKey]: results,
		};
	}

	private getRequiredConfig<K extends keyof IteratorNodeRuntimeConfig>(
		key: K,
	): NonNullable<IteratorNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<IteratorNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(`Missing required IteratorNode config: ${String(key)}.`);
		}
		return value as NonNullable<IteratorNodeRuntimeConfig[K]>;
	}

	private getOptionalConfig<K extends keyof IteratorNodeRuntimeConfig>(
		key: K,
	): IteratorNodeRuntimeConfig[K] | undefined {
		return this.getConfigValue<IteratorNodeRuntimeConfig[K]>(key);
	}
}

function normalizeConcurrency(value: number | undefined): number {
	if (!value || Number.isNaN(value)) {
		return 4;
	}
	return Math.max(1, Math.min(16, Math.floor(value)));
}
