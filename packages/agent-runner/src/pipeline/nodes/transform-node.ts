import { BaseNode, type PipelineState } from "../base-node.js";

/**
 * Context provided to transform handlers.
 */
export interface TransformContext {
	config: Record<string, unknown>;
	state: PipelineState;
}

/**
 * Function signature for registered transforms.
 */
export type TransformHandler = (
	input: unknown,
	context: TransformContext,
) => unknown;

interface TransformNodeRuntimeConfig {
	transformFn: string;
	inputKey: string;
	outputKey: string;
	count?: number;
	field?: string;
}

const transformRegistry = new Map<string, TransformHandler>();

/**
 * Register a reusable transform handler by name.
 */
export function registerTransform(
	name: string,
	handler: TransformHandler,
): void {
	transformRegistry.set(name, handler);
}

registerTransform("extract-urls", (input) => {
	if (typeof input !== "string") {
		return [];
	}
	return [...new Set(input.match(/https?:\/\/[^\s)"'>]+/g) ?? [])];
});

registerTransform("split-by-newline", (input) => {
	if (typeof input !== "string") {
		return [];
	}
	return input
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter(Boolean);
});

registerTransform("parse-json", (input) => {
	if (typeof input !== "string") {
		return input;
	}
	return JSON.parse(stripCodeFence(input));
});

registerTransform("first-n", (input, context) => {
	const countValue = context.config["count"];
	const count =
		typeof countValue === "number" ? Math.max(0, Math.floor(countValue)) : 1;
	if (Array.isArray(input)) {
		return input.slice(0, count);
	}
	if (typeof input === "string") {
		return input.split(/\r?\n/).filter(Boolean).slice(0, count);
	}
	return input;
});

registerTransform("get-field", (input, context) => {
	const field = context.config["field"];
	if (typeof field !== "string") {
		throw new Error(
			'Transform "get-field" requires a string config.field value.',
		);
	}
	if (!isRecord(input)) {
		throw new Error('Transform "get-field" requires an object input.');
	}
	return input[field];
});

/**
 * Applies a named transform to a state value.
 */
export class TransformNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const transformFn = this.getRequiredConfig("transformFn");
		const inputKey = this.getRequiredConfig("inputKey");
		const outputKey = this.getRequiredConfig("outputKey");
		const transform = transformRegistry.get(transformFn);

		if (!transform) {
			throw new Error(`Unknown transform function "${transformFn}".`);
		}

		const transformed = transform(state[inputKey], {
			config: { ...this.config },
			state,
		});
		this.setExecutionMetrics({});
		return {
			...state,
			[outputKey]: transformed,
		};
	}

	private getRequiredConfig<K extends keyof TransformNodeRuntimeConfig>(
		key: K,
	): NonNullable<TransformNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<TransformNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(`Missing required TransformNode config: ${String(key)}.`);
		}
		return value as NonNullable<TransformNodeRuntimeConfig[K]>;
	}
}

function stripCodeFence(input: string): string {
	const trimmed = input.trim();
	if (!trimmed.startsWith("```")) {
		return trimmed;
	}
	return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
