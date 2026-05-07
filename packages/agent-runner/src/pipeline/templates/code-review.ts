import { Pipeline, type PipelineConfig } from "../base-graph.js";
import {
	ConditionalNode,
	LlmNode,
	MergeNode,
	TransformNode,
} from "../nodes/index.js";

/**
 * Ready-made code review pipeline configuration.
 */
export const codeReviewPipelineConfig: PipelineConfig = {
	name: "code-review",
	description:
		"Analyze a diff, branch on critical findings, and summarize fixes.",
	entryPoint: "analyze-review-json",
	nodes: [
		new LlmNode({
			name: "analyze-review-json",
			inputs: "diff & __llmCall",
			outputs: ["review_json"],
			nodeConfig: {
				outputKey: "review_json",
				promptTemplate: `You are reviewing a code diff for bugs and security issues.

Files:
{{file_paths}}

Context:
{{context}}

Diff:
{{diff}}

Return strict JSON only with this schema: {"issues": Array<{"severity": "critical" | "high" | "medium" | "low", "file": string, "line": number | null, "description": string, "suggestion": string}>, "critical_found": boolean, "summary": string}.`,
			},
		}),
		new TransformNode({
			name: "parse-review-json",
			inputs: "review_json",
			outputs: ["structured_review"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "review_json",
				outputKey: "structured_review",
			},
		}),
		new TransformNode({
			name: "extract-review-issues",
			inputs: "structured_review",
			outputs: ["issues"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "structured_review",
				outputKey: "issues",
				field: "issues",
			},
		}),
		new TransformNode({
			name: "extract-review-summary",
			inputs: "structured_review",
			outputs: ["initial_summary"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "structured_review",
				outputKey: "initial_summary",
				field: "summary",
			},
		}),
		new TransformNode({
			name: "extract-critical-flag",
			inputs: "structured_review",
			outputs: ["critical_found"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "structured_review",
				outputKey: "critical_found",
				field: "critical_found",
			},
		}),
		new ConditionalNode({
			name: "critical-issue-gate",
			inputs: "critical_found",
			outputs: ["__branch"],
			nodeConfig: {
				conditionKey: "critical_found",
				conditionCheck: "truthy",
			},
		}),
		new LlmNode({
			name: "generate-fix-suggestions-json",
			inputs: "structured_review & diff & __llmCall",
			outputs: ["fix_suggestions_json"],
			nodeConfig: {
				outputKey: "fix_suggestions_json",
				promptTemplate: `Critical issues were found in this review:
{{structured_review}}

Diff:
{{diff}}

Return strict JSON only with this schema: {"fix_suggestions": Array<{"severity": "critical" | "high" | "medium" | "low", "file": string, "line": number | null, "description": string, "suggestion": string}>, "fix_summary": string}.`,
			},
		}),
		new TransformNode({
			name: "parse-fix-suggestions-json",
			inputs: "fix_suggestions_json",
			outputs: ["fix_bundle"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "fix_suggestions_json",
				outputKey: "fix_bundle",
			},
		}),
		new TransformNode({
			name: "extract-fix-suggestions",
			inputs: "fix_bundle",
			outputs: ["fix_suggestions"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "fix_bundle",
				outputKey: "fix_suggestions",
				field: "fix_suggestions",
			},
		}),
		new TransformNode({
			name: "extract-fix-summary",
			inputs: "fix_bundle",
			outputs: ["fix_summary"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "fix_bundle",
				outputKey: "fix_summary",
				field: "fix_summary",
			},
		}),
		new MergeNode({
			name: "merge-review-findings",
			inputs: "issues & initial_summary & __llmCall",
			outputs: ["review_bundle_json"],
			nodeConfig: {
				inputKeys: [
					"issues",
					"fix_suggestions",
					"initial_summary",
					"fix_summary",
				],
				strategy: "llm",
				outputKey: "review_bundle_json",
				mergePrompt: `Primary issues:
{{issues}}

Primary summary:
{{initial_summary}}

Optional fix suggestions:
{{fix_suggestions}}

Optional fix summary:
{{fix_summary}}

Return strict JSON only with this schema: {"issues": Array<{"severity": "critical" | "high" | "medium" | "low", "file": string, "line": number | null, "description": string, "suggestion": string}>, "summary": string}. If no additional fixes are needed, keep the original issues and summary.`,
			},
		}),
		new TransformNode({
			name: "parse-review-bundle-json",
			inputs: "review_bundle_json",
			outputs: ["review_bundle"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "review_bundle_json",
				outputKey: "review_bundle",
			},
		}),
		new TransformNode({
			name: "extract-final-issues",
			inputs: "review_bundle",
			outputs: ["issues"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "review_bundle",
				outputKey: "issues",
				field: "issues",
			},
		}),
		new TransformNode({
			name: "extract-final-summary",
			inputs: "review_bundle",
			outputs: ["summary"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "review_bundle",
				outputKey: "summary",
				field: "summary",
			},
		}),
	],
	edges: [
		{ from: "analyze-review-json", to: "parse-review-json" },
		{ from: "parse-review-json", to: "extract-review-issues" },
		{ from: "parse-review-json", to: "extract-review-summary" },
		{ from: "parse-review-json", to: "extract-critical-flag" },
		{ from: "extract-review-issues", to: "critical-issue-gate" },
		{ from: "extract-review-summary", to: "critical-issue-gate" },
		{ from: "extract-critical-flag", to: "critical-issue-gate" },
		{
			from: "critical-issue-gate",
			to: "generate-fix-suggestions-json",
			condition: "true",
		},
		{
			from: "critical-issue-gate",
			to: "merge-review-findings",
			condition: "false",
		},
		{ from: "generate-fix-suggestions-json", to: "parse-fix-suggestions-json" },
		{ from: "parse-fix-suggestions-json", to: "extract-fix-suggestions" },
		{ from: "parse-fix-suggestions-json", to: "extract-fix-summary" },
		{ from: "extract-fix-summary", to: "merge-review-findings" },
		{ from: "merge-review-findings", to: "parse-review-bundle-json" },
		{ from: "parse-review-bundle-json", to: "extract-final-issues" },
		{ from: "parse-review-bundle-json", to: "extract-final-summary" },
	],
};

/**
 * Create a code review pipeline instance.
 */
export function createCodeReviewPipeline(): Pipeline {
	return new Pipeline(codeReviewPipelineConfig);
}
