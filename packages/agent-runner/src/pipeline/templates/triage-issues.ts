import { Pipeline, type PipelineConfig } from "../base-graph.js";
import { IteratorNode, LlmNode, TransformNode } from "../nodes/index.js";

const classifyIssueSubPipelineConfig: PipelineConfig = {
	name: "classify-single-issue",
	description: "Classify a single issue by priority and category.",
	entryPoint: "classify-issue-json",
	nodes: [
		new LlmNode({
			name: "classify-issue-json",
			inputs: "item & __llmCall",
			outputs: ["classification_json"],
			nodeConfig: {
				outputKey: "classification_json",
				promptTemplate: `Classify this issue and return strict JSON only: {"title": string, "description": string, "labels": string[], "priority": "critical" | "high" | "medium" | "low", "category": string, "rationale": string}.

Issue:
{{item}}`,
			},
		}),
		new TransformNode({
			name: "parse-issue-classification",
			inputs: "classification_json",
			outputs: ["classification"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "classification_json",
				outputKey: "classification",
			},
		}),
	],
	edges: [{ from: "classify-issue-json", to: "parse-issue-classification" }],
};

/**
 * Ready-made issue triage pipeline configuration.
 */
export const triageIssuesPipelineConfig: PipelineConfig = {
	name: "triage-issues",
	description:
		"Prioritize issues, assign categories, and propose a sprint plan.",
	entryPoint: "classify-issues",
	nodes: [
		new IteratorNode({
			name: "classify-issues",
			inputs: "issues & __llmCall",
			outputs: ["classified_issues"],
			nodeConfig: {
				itemsKey: "issues",
				subPipeline: classifyIssueSubPipelineConfig,
				concurrency: 4,
				outputKey: "classified_issues",
			},
		}),
		new LlmNode({
			name: "prioritize-and-group-json",
			inputs: "classified_issues & __llmCall",
			outputs: ["prioritized_json"],
			nodeConfig: {
				outputKey: "prioritized_json",
				promptTemplate: `You are triaging a backlog. Based on these per-issue classifications:
{{classified_issues}}

Return strict JSON only with the schema {"prioritized": Array<{"title": string, "description": string, "labels": string[], "priority": "critical" | "high" | "medium" | "low", "category": string}>}.`,
			},
		}),
		new TransformNode({
			name: "parse-prioritized-json",
			inputs: "prioritized_json",
			outputs: ["prioritized_bundle"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "prioritized_json",
				outputKey: "prioritized_bundle",
			},
		}),
		new TransformNode({
			name: "extract-prioritized",
			inputs: "prioritized_bundle",
			outputs: ["prioritized"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "prioritized_bundle",
				outputKey: "prioritized",
				field: "prioritized",
			},
		}),
		new LlmNode({
			name: "generate-sprint-plan-json",
			inputs: "prioritized & __llmCall",
			outputs: ["sprint_plan_json"],
			nodeConfig: {
				outputKey: "sprint_plan_json",
				promptTemplate: `Given these prioritized issues:
{{prioritized}}

Create a practical sprint recommendation. Return strict JSON only: {"sprint_plan": string}.`,
			},
		}),
		new TransformNode({
			name: "parse-sprint-plan-json",
			inputs: "sprint_plan_json",
			outputs: ["sprint_plan_bundle"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "sprint_plan_json",
				outputKey: "sprint_plan_bundle",
			},
		}),
		new TransformNode({
			name: "extract-sprint-plan",
			inputs: "sprint_plan_bundle",
			outputs: ["sprint_plan"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "sprint_plan_bundle",
				outputKey: "sprint_plan",
				field: "sprint_plan",
			},
		}),
	],
	edges: [
		{ from: "classify-issues", to: "prioritize-and-group-json" },
		{ from: "prioritize-and-group-json", to: "parse-prioritized-json" },
		{ from: "parse-prioritized-json", to: "extract-prioritized" },
		{ from: "extract-prioritized", to: "generate-sprint-plan-json" },
		{ from: "generate-sprint-plan-json", to: "parse-sprint-plan-json" },
		{ from: "parse-sprint-plan-json", to: "extract-sprint-plan" },
	],
};

/**
 * Create an issue triage pipeline instance.
 */
export function createTriageIssuesPipeline(): Pipeline {
	return new Pipeline(triageIssuesPipelineConfig);
}
