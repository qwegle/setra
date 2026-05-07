/**
 * Shared types and base behavior for pipeline nodes.
 */
export interface NodeExecutionResult {
	state: PipelineState;
	metadata: {
		nodeName: string;
		durationMs: number;
		tokensUsed?: { prompt: number; completion: number };
		costUsd?: number;
	};
}

/**
 * Mutable pipeline state passed between nodes.
 */
export type PipelineState = Record<string, unknown>;

/**
 * Configuration used to instantiate a pipeline node.
 */
export interface NodeConfig {
	name: string;
	inputs: string;
	outputs: string[];
	nodeConfig?: Record<string, unknown>;
}

/**
 * Token usage captured from an LLM or MCP tool invocation.
 */
export interface PipelineTokenUsage {
	prompt: number;
	completion: number;
}

/**
 * Result returned by the pluggable LLM callback.
 */
export interface PipelineLlmResponse {
	content: string;
	tokens: PipelineTokenUsage;
	costUsd: number;
}

/**
 * Callback signature used by LLM-powered nodes.
 */
export type PipelineLlmCall = (
	prompt: string,
	model?: string,
) => Promise<PipelineLlmResponse>;

/**
 * Result returned by the pluggable MCP callback.
 */
export interface PipelineMcpResponse {
	content?: unknown;
	tokens?: PipelineTokenUsage;
	costUsd?: number;
}

/**
 * Callback signature used by MCP tool nodes.
 */
export type PipelineMcpCall = (
	toolName: string,
	args: Record<string, unknown>,
) => Promise<unknown>;

interface InputTokenNode {
	kind: "token";
	name: string;
}

interface InputBinaryNode {
	kind: "and" | "or";
	left: InputExpressionNode;
	right: InputExpressionNode;
}

type InputExpressionNode = InputTokenNode | InputBinaryNode;

interface ValidationResult {
	valid: boolean;
	missing: string[];
}

interface ExecutionMetrics {
	tokensUsed?: PipelineTokenUsage;
	costUsd?: number;
}

class InputExpressionParser {
	private readonly tokens: string[];
	private position = 0;

	constructor(expression: string) {
		const matches = expression.match(/[()&|]|[A-Za-z0-9_.-]+/g);
		this.tokens = matches ?? [];
	}

	parse(): InputExpressionNode | null {
		if (this.tokens.length === 0) {
			return null;
		}

		const expression = this.parseOr();
		if (this.position < this.tokens.length) {
			throw new Error(
				`Unexpected token "${this.tokens[this.position]}" in input expression.`,
			);
		}
		return expression;
	}

	private parseOr(): InputExpressionNode {
		let node = this.parseAnd();
		while (this.peek() === "|") {
			this.consume("|");
			node = {
				kind: "or",
				left: node,
				right: this.parseAnd(),
			};
		}
		return node;
	}

	private parseAnd(): InputExpressionNode {
		let node = this.parsePrimary();
		while (this.peek() === "&") {
			this.consume("&");
			node = {
				kind: "and",
				left: node,
				right: this.parsePrimary(),
			};
		}
		return node;
	}

	private parsePrimary(): InputExpressionNode {
		const token = this.peek();
		if (!token) {
			throw new Error("Unexpected end of input expression.");
		}

		if (token === "(") {
			this.consume("(");
			const inner = this.parseOr();
			this.consume(")");
			return inner;
		}

		if (token === "&" || token === "|" || token === ")") {
			throw new Error(`Unexpected token "${token}" in input expression.`);
		}

		this.position += 1;
		return { kind: "token", name: token };
	}

	private peek(): string | undefined {
		return this.tokens[this.position];
	}

	private consume(expected: string): void {
		if (this.tokens[this.position] !== expected) {
			throw new Error(
				`Expected token "${expected}" but found "${this.tokens[this.position] ?? "end of expression"}".`,
			);
		}
		this.position += 1;
	}
}

/**
 * Abstract base class for all DAG pipeline nodes.
 */
export abstract class BaseNode {
	readonly name: string;
	readonly inputs: string;
	readonly outputs: string[];
	protected config: Record<string, unknown>;
	private readonly inputExpression: InputExpressionNode | null;
	private executionMetrics: ExecutionMetrics = {};

	constructor(config: NodeConfig) {
		this.name = config.name;
		this.inputs = config.inputs.trim();
		this.outputs = [...config.outputs];
		this.config = { ...(config.nodeConfig ?? {}) };
		this.inputExpression = new InputExpressionParser(this.inputs).parse();
	}

	/**
	 * Parse the boolean input expression and validate it against the current state.
	 */
	validateInputs(state: PipelineState): { valid: boolean; missing: string[] } {
		if (!this.inputExpression) {
			return { valid: true, missing: [] };
		}

		return this.evaluateExpression(this.inputExpression, state);
	}

	/**
	 * Execute this node.
	 */
	abstract execute(state: PipelineState): Promise<PipelineState>;

	/**
	 * Broadcast shared config updates into the node.
	 */
	updateConfig(params: Record<string, unknown>, overwrite = false): void {
		for (const [key, value] of Object.entries(params)) {
			if (overwrite || !(key in this.config)) {
				this.config[key] = value;
			}
		}
	}

	/**
	 * Clear metrics captured during the previous execution.
	 */
	clearExecutionMetrics(): void {
		this.executionMetrics = {};
	}

	/**
	 * Read metrics captured by the most recent execution.
	 */
	getLastExecutionMetrics(): {
		tokensUsed?: PipelineTokenUsage;
		costUsd?: number;
	} {
		return { ...this.executionMetrics };
	}

	/**
	 * Store per-run metrics for the pipeline executor.
	 */
	protected setExecutionMetrics(metrics: ExecutionMetrics): void {
		this.executionMetrics = { ...metrics };
	}

	/**
	 * Read a typed node config value.
	 */
	protected getConfigValue<T>(key: string): T | undefined {
		return this.config[key] as T | undefined;
	}

	private evaluateExpression(
		expression: InputExpressionNode,
		state: PipelineState,
	): ValidationResult {
		if (expression.kind === "token") {
			const present =
				Object.prototype.hasOwnProperty.call(state, expression.name) &&
				state[expression.name] !== undefined;
			return {
				valid: present,
				missing: present ? [] : [expression.name],
			};
		}

		const left = this.evaluateExpression(expression.left, state);
		const right = this.evaluateExpression(expression.right, state);

		if (expression.kind === "and") {
			return {
				valid: left.valid && right.valid,
				missing:
					left.valid && right.valid
						? []
						: [...new Set([...left.missing, ...right.missing])],
			};
		}

		if (left.valid || right.valid) {
			return { valid: true, missing: [] };
		}

		const preferredMissing =
			left.missing.length <= right.missing.length
				? left.missing
				: right.missing;
		return {
			valid: false,
			missing: [...new Set(preferredMissing)],
		};
	}
}
