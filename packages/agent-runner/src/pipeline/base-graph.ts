import { EventEmitter } from "events";
import type {
	BaseNode,
	NodeExecutionResult,
	PipelineState,
} from "./base-node.js";

/**
 * Directed connection between two nodes in the pipeline graph.
 */
export interface PipelineEdge {
	from: string;
	to: string;
	condition?: string;
}

/**
 * Structured pipeline lifecycle event emitted for observability.
 */
export interface PipelineEvent {
	type:
		| "run:start"
		| "node:start"
		| "node:complete"
		| "node:error"
		| "run:complete";
	pipelineName: string;
	nodeName?: string;
	state?: PipelineState;
	metadata?: NodeExecutionResult["metadata"];
	error?: string;
	timestamp: Date;
}

/**
 * Optional logger callback for pipeline events.
 */
export type PipelineLogger = (event: PipelineEvent) => void;

/**
 * Runtime configuration for a pipeline DAG.
 */
export interface PipelineConfig {
	name: string;
	description: string;
	nodes: BaseNode[];
	edges: PipelineEdge[];
	entryPoint: string;
	logger?: PipelineLogger;
}

/**
 * Final result returned from a pipeline run.
 */
export interface PipelineResult {
	state: PipelineState;
	nodeResults: NodeExecutionResult[];
	totalDurationMs: number;
	totalCostUsd: number;
	totalTokens: { prompt: number; completion: number };
	success: boolean;
	error?: string;
}

/**
 * DAG pipeline executor for Setra agent workflows.
 */
export class Pipeline extends EventEmitter {
	private readonly config: PipelineConfig;
	private readonly nodes: Map<string, BaseNode>;
	private readonly outgoing: Map<string, PipelineEdge[]>;
	private readonly logger: PipelineLogger | undefined;

	constructor(config: PipelineConfig) {
		super();
		this.config = config;
		this.nodes = new Map(config.nodes.map((node) => [node.name, node]));
		this.outgoing = new Map();
		this.logger = config.logger;

		for (const edge of config.edges) {
			const edges = this.outgoing.get(edge.from) ?? [];
			edges.push(edge);
			this.outgoing.set(edge.from, edges);
		}
	}

	/**
	 * Execute the pipeline from the configured entry point.
	 */
	async run(initialState: PipelineState): Promise<PipelineResult> {
		const validation = this.validate();
		if (!validation.valid) {
			return {
				state: sanitizeState(initialState),
				nodeResults: [],
				totalDurationMs: 0,
				totalCostUsd: 0,
				totalTokens: { prompt: 0, completion: 0 },
				success: false,
				error: validation.errors.join("; "),
			};
		}

		const startedAt = Date.now();
		const state: PipelineState = { ...initialState };
		const nodeResults: NodeExecutionResult[] = [];
		const executed = new Set<string>();
		const queued = new Set<string>([this.config.entryPoint]);
		const deferred = new Set<string>();
		const queue: string[] = [this.config.entryPoint];
		let totalCostUsd = 0;
		let totalPromptTokens = 0;
		let totalCompletionTokens = 0;

		this.dispatchEvent({
			type: "run:start",
			pipelineName: this.config.name,
			state: sanitizeState(state),
			timestamp: new Date(),
		});

		while (queue.length > 0) {
			const nodeName = queue.shift();
			if (!nodeName || executed.has(nodeName)) {
				continue;
			}
			queued.delete(nodeName);

			const node = this.nodes.get(nodeName);
			if (!node) {
				return this.buildFailureResult({
					state,
					nodeResults,
					startedAt,
					totalCostUsd,
					totalPromptTokens,
					totalCompletionTokens,
					error: `Node "${nodeName}" is not registered in pipeline "${this.config.name}".`,
				});
			}

			const inputValidation = node.validateInputs(state);
			if (!inputValidation.valid) {
				deferred.add(nodeName);
				if (queue.length === 0) {
					const nowReady = [...deferred].filter((candidate) => {
						const candidateNode = this.nodes.get(candidate);
						return candidateNode?.validateInputs(state).valid ?? false;
					});
					for (const readyNode of nowReady) {
						deferred.delete(readyNode);
						if (!queued.has(readyNode) && !executed.has(readyNode)) {
							queue.push(readyNode);
							queued.add(readyNode);
						}
					}
				}
				continue;
			}

			node.clearExecutionMetrics();
			const nodeStartedAt = Date.now();
			this.dispatchEvent({
				type: "node:start",
				pipelineName: this.config.name,
				nodeName,
				state: sanitizeState(state),
				timestamp: new Date(),
			});

			try {
				const nextState = await node.execute(state);
				Object.assign(state, nextState);
				executed.add(nodeName);
				deferred.delete(nodeName);

				const metrics = node.getLastExecutionMetrics();
				const metadata: NodeExecutionResult["metadata"] = {
					nodeName,
					durationMs: Date.now() - nodeStartedAt,
				};
				if (metrics.tokensUsed) {
					metadata.tokensUsed = metrics.tokensUsed;
				}
				if (metrics.costUsd !== undefined) {
					metadata.costUsd = metrics.costUsd;
				}
				const nodeResult: NodeExecutionResult = {
					state: sanitizeState(state),
					metadata,
				};
				nodeResults.push(nodeResult);

				totalCostUsd += metrics.costUsd ?? 0;
				totalPromptTokens += metrics.tokensUsed?.prompt ?? 0;
				totalCompletionTokens += metrics.tokensUsed?.completion ?? 0;

				this.dispatchEvent({
					type: "node:complete",
					pipelineName: this.config.name,
					nodeName,
					state: sanitizeState(state),
					metadata: nodeResult.metadata,
					timestamp: new Date(),
				});

				for (const successor of this.getNextNodes(nodeName, state)) {
					if (!queued.has(successor) && !executed.has(successor)) {
						queue.push(successor);
						queued.add(successor);
					}
				}

				for (const deferredNode of [...deferred]) {
					const deferredCandidate = this.nodes.get(deferredNode);
					if (
						deferredCandidate &&
						deferredCandidate.validateInputs(state).valid &&
						!queued.has(deferredNode) &&
						!executed.has(deferredNode)
					) {
						queue.push(deferredNode);
						queued.add(deferredNode);
					}
				}
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				this.dispatchEvent({
					type: "node:error",
					pipelineName: this.config.name,
					nodeName,
					state: sanitizeState(state),
					error: errorMessage,
					timestamp: new Date(),
				});
				return this.buildFailureResult({
					state,
					nodeResults,
					startedAt,
					totalCostUsd,
					totalPromptTokens,
					totalCompletionTokens,
					error: `Node "${nodeName}" failed: ${errorMessage}`,
				});
			}
		}

		if (deferred.size > 0) {
			const pendingErrors = [...deferred].map((nodeName) => {
				const node = this.nodes.get(nodeName);
				const missing = node?.validateInputs(state).missing ?? [];
				return `${nodeName}: missing ${missing.join(", ")}`;
			});
			return this.buildFailureResult({
				state,
				nodeResults,
				startedAt,
				totalCostUsd,
				totalPromptTokens,
				totalCompletionTokens,
				error: `Pipeline stalled before completing all reachable nodes (${pendingErrors.join("; ")}).`,
			});
		}

		const result: PipelineResult = {
			state: sanitizeState(state),
			nodeResults,
			totalDurationMs: Date.now() - startedAt,
			totalCostUsd,
			totalTokens: {
				prompt: totalPromptTokens,
				completion: totalCompletionTokens,
			},
			success: true,
		};
		this.dispatchEvent({
			type: "run:complete",
			pipelineName: this.config.name,
			state: result.state,
			timestamp: new Date(),
		});
		return result;
	}

	/**
	 * Validate that the pipeline is a well-formed DAG.
	 */
	validate(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		const nodeNames = new Set<string>();

		if (!this.nodes.has(this.config.entryPoint)) {
			errors.push(`Entry point "${this.config.entryPoint}" does not exist.`);
		}

		for (const node of this.config.nodes) {
			if (nodeNames.has(node.name)) {
				errors.push(`Duplicate node name "${node.name}".`);
			}
			nodeNames.add(node.name);
		}

		for (const edge of this.config.edges) {
			if (!this.nodes.has(edge.from)) {
				errors.push(`Edge source "${edge.from}" does not exist.`);
			}
			if (!this.nodes.has(edge.to)) {
				errors.push(`Edge target "${edge.to}" does not exist.`);
			}
		}

		const inDegree = new Map<string, number>();
		for (const node of this.config.nodes) {
			inDegree.set(node.name, 0);
		}
		for (const edge of this.config.edges) {
			inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
		}

		const zeroInDegree = [...inDegree.entries()]
			.filter(([, degree]) => degree === 0)
			.map(([name]) => name);
		const visited: string[] = [];

		while (zeroInDegree.length > 0) {
			const current = zeroInDegree.shift();
			if (!current) {
				continue;
			}
			visited.push(current);
			for (const edge of this.outgoing.get(current) ?? []) {
				const nextDegree = (inDegree.get(edge.to) ?? 0) - 1;
				inDegree.set(edge.to, nextDegree);
				if (nextDegree === 0) {
					zeroInDegree.push(edge.to);
				}
			}
		}

		if (visited.length !== this.config.nodes.length) {
			errors.push("Pipeline graph contains a cycle.");
		}

		return { valid: errors.length === 0, errors };
	}

	/**
	 * Apply shared parameters to all nodes in the graph.
	 */
	setCommonParams(params: Record<string, unknown>, overwrite = false): void {
		for (const node of this.config.nodes) {
			node.updateConfig(params, overwrite);
		}
	}

	private getNextNodes(nodeName: string, state: PipelineState): string[] {
		const edges = this.outgoing.get(nodeName) ?? [];
		const branch = state["__branch"];
		return edges
			.filter((edge) => {
				if (!edge.condition) {
					return true;
				}

				if (branch !== undefined) {
					return String(branch) === edge.condition;
				}

				const conditionValue = state[edge.condition];
				if (typeof conditionValue === "boolean") {
					return conditionValue;
				}
				if (conditionValue === undefined) {
					return false;
				}
				return String(conditionValue) === edge.condition;
			})
			.map((edge) => edge.to);
	}

	private dispatchEvent(event: PipelineEvent): void {
		this.emit(event.type, event);
		this.emit("event", event);
		this.logger?.(event);
	}

	private buildFailureResult(args: {
		state: PipelineState;
		nodeResults: NodeExecutionResult[];
		startedAt: number;
		totalCostUsd: number;
		totalPromptTokens: number;
		totalCompletionTokens: number;
		error: string;
	}): PipelineResult {
		const result: PipelineResult = {
			state: sanitizeState(args.state),
			nodeResults: args.nodeResults,
			totalDurationMs: Date.now() - args.startedAt,
			totalCostUsd: args.totalCostUsd,
			totalTokens: {
				prompt: args.totalPromptTokens,
				completion: args.totalCompletionTokens,
			},
			success: false,
			error: args.error,
		};
		const completionEvent: PipelineEvent = {
			type: "run:complete",
			pipelineName: this.config.name,
			state: result.state,
			timestamp: new Date(),
		};
		if (result.error) {
			completionEvent.error = result.error;
		}
		this.dispatchEvent(completionEvent);
		return result;
	}
}

function sanitizeState(state: PipelineState): PipelineState {
	return Object.fromEntries(
		Object.entries(state).filter(([key]) => !key.startsWith("__")),
	);
}
