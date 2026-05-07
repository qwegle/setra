import { describe, expect, it, vi } from "vitest";
import { Pipeline } from "../pipeline/base-graph.js";
import { BaseNode } from "../pipeline/base-node.js";
import {
	ConditionalNode,
	FetchNode,
	LlmNode,
	MergeNode,
	TransformNode,
} from "../pipeline/nodes/index.js";

class NoopNode extends BaseNode {
	async execute(
		state: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return state;
	}
}

describe("BaseNode.validateInputs", () => {
	it("supports AND, OR, and parentheses", () => {
		const node = new NoopNode({
			name: "noop",
			inputs: "user_prompt & (context | doc)",
			outputs: [],
		});

		expect(
			node.validateInputs({ user_prompt: "hello", context: "ctx" }).valid,
		).toBe(true);

		const invalid = node.validateInputs({ user_prompt: "hello" });
		expect(invalid.valid).toBe(false);
		expect(invalid.missing.length).toBe(1);
		expect(["context", "doc"]).toContain(invalid.missing[0]);
	});
});

describe("Pipeline", () => {
	it("executes conditional branches and accumulates metadata", async () => {
		const llmCall = vi.fn(async (prompt: string) => {
			if (prompt.startsWith("draft")) {
				return {
					content: "needs-fix",
					tokens: { prompt: 10, completion: 5 },
					costUsd: 0.02,
				};
			}
			if (prompt.startsWith("fix")) {
				return {
					content: "apply validation",
					tokens: { prompt: 8, completion: 4 },
					costUsd: 0.01,
				};
			}
			return {
				content: JSON.stringify({ summary: "merged summary" }),
				tokens: { prompt: 6, completion: 3 },
				costUsd: 0.005,
			};
		});

		const pipeline = new Pipeline({
			name: "branch-test",
			description: "Test conditional branching.",
			entryPoint: "draft",
			nodes: [
				new LlmNode({
					name: "draft",
					inputs: "input & __llmCall",
					outputs: ["analysis"],
					nodeConfig: {
						promptTemplate: "draft {{input}}",
						outputKey: "analysis",
					},
				}),
				new ConditionalNode({
					name: "branch",
					inputs: "analysis",
					outputs: ["__branch"],
					nodeConfig: {
						conditionKey: "analysis",
						conditionCheck: "equals",
						conditionValue: "needs-fix",
					},
				}),
				new LlmNode({
					name: "fix",
					inputs: "analysis & __llmCall",
					outputs: ["fix"],
					nodeConfig: {
						promptTemplate: "fix {{analysis}}",
						outputKey: "fix",
					},
				}),
				new MergeNode({
					name: "merge",
					inputs: "analysis & __llmCall",
					outputs: ["summary_json"],
					nodeConfig: {
						inputKeys: ["analysis", "fix"],
						strategy: "llm",
						outputKey: "summary_json",
						mergePrompt: "merge {{analysis}} {{fix}}",
					},
				}),
				new TransformNode({
					name: "parse-summary",
					inputs: "summary_json",
					outputs: ["summary_bundle"],
					nodeConfig: {
						transformFn: "parse-json",
						inputKey: "summary_json",
						outputKey: "summary_bundle",
					},
				}),
			],
			edges: [
				{ from: "draft", to: "branch" },
				{ from: "branch", to: "fix", condition: "true" },
				{ from: "branch", to: "merge", condition: "false" },
				{ from: "fix", to: "merge" },
				{ from: "merge", to: "parse-summary" },
			],
		});

		const result = await pipeline.run({
			input: "review this",
			__llmCall: llmCall,
		});
		expect(result.success).toBe(true);
		expect(result.state["analysis"]).toBe("needs-fix");
		expect(result.state["fix"]).toBe("apply validation");
		expect(result.state["summary_bundle"]).toEqual({
			summary: "merged summary",
		});
		expect(result.totalTokens.prompt).toBe(24);
		expect(result.totalCostUsd).toBeCloseTo(0.035);
	});

	it("fetches html and transforms it into markdown-like text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				headers: { get: () => "text/html; charset=utf-8" },
				text: vi
					.fn()
					.mockResolvedValue(
						'<html><body><h1>Example</h1><p>Hello <a href="https://example.com">world</a></p></body></html>',
					),
			}),
		);

		const fetchNode = new FetchNode({
			name: "fetch",
			inputs: "url",
			outputs: ["content"],
			nodeConfig: {
				urlKey: "url",
				outputKey: "content",
				format: "markdown",
			},
		});

		const transformNode = new TransformNode({
			name: "extract-lines",
			inputs: "content",
			outputs: ["lines"],
			nodeConfig: {
				transformFn: "split-by-newline",
				inputKey: "content",
				outputKey: "lines",
			},
		});

		const fetched = await fetchNode.execute({ url: "https://example.com" });
		expect(fetched["content"]).toContain("# Example");
		expect(fetched["content"]).toContain("[world](https://example.com)");

		const transformed = await transformNode.execute(fetched);
		expect(transformed["lines"]).toEqual([
			"# Example",
			"Hello [world](https://example.com)",
		]);
	});
});
