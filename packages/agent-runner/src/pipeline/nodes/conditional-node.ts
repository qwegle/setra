import { BaseNode, type PipelineState } from "../base-node.js";

interface ConditionalNodeRuntimeConfig {
	conditionKey: string;
	conditionCheck?: "truthy" | "falsy" | "empty" | "non-empty" | "equals";
	conditionValue?: unknown;
}

/**
 * Computes a boolean branch result and stores it in state.__branch.
 */
export class ConditionalNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const conditionKey = this.getRequiredConfig("conditionKey");
		const conditionCheck = this.getOptionalConfig("conditionCheck") ?? "truthy";
		const conditionValue = this.getConfigValue("conditionValue");
		const value = state[conditionKey];
		const matched = evaluateCondition(value, conditionCheck, conditionValue);
		this.setExecutionMetrics({});

		return {
			...state,
			__branch: matched ? "true" : "false",
		};
	}

	private getRequiredConfig<K extends keyof ConditionalNodeRuntimeConfig>(
		key: K,
	): NonNullable<ConditionalNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<ConditionalNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(
				`Missing required ConditionalNode config: ${String(key)}.`,
			);
		}
		return value as NonNullable<ConditionalNodeRuntimeConfig[K]>;
	}

	private getOptionalConfig<K extends keyof ConditionalNodeRuntimeConfig>(
		key: K,
	): ConditionalNodeRuntimeConfig[K] | undefined {
		return this.getConfigValue<ConditionalNodeRuntimeConfig[K]>(key);
	}
}

function evaluateCondition(
	value: unknown,
	check: NonNullable<ConditionalNodeRuntimeConfig["conditionCheck"]>,
	expected: unknown,
): boolean {
	switch (check) {
		case "truthy":
			return Boolean(value);
		case "falsy":
			return !value;
		case "empty":
			return isEmpty(value);
		case "non-empty":
			return !isEmpty(value);
		case "equals":
			return value === expected;
		default:
			return false;
	}
}

function isEmpty(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	if (typeof value === "string" || Array.isArray(value)) {
		return value.length === 0;
	}
	if (typeof value === "object") {
		return Object.keys(value as Record<string, unknown>).length === 0;
	}
	return false;
}
