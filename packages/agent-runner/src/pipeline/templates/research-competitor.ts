import { Pipeline, type PipelineConfig } from "../base-graph.js";
import { FetchNode, LlmNode, TransformNode } from "../nodes/index.js";

/**
 * Ready-made competitor research pipeline configuration.
 */
export const researchCompetitorPipelineConfig: PipelineConfig = {
	name: "research-competitor",
	description:
		"Fetch a competitor website and generate a structured research report.",
	entryPoint: "fetch-competitor-site",
	nodes: [
		new FetchNode({
			name: "fetch-competitor-site",
			inputs: "competitor_url",
			outputs: ["page_content"],
			nodeConfig: {
				urlKey: "competitor_url",
				outputKey: "page_content",
				format: "markdown",
			},
		}),
		new LlmNode({
			name: "analyze-competitor",
			inputs: "page_content & research_prompt & __llmCall",
			outputs: ["analysis"],
			nodeConfig: {
				outputKey: "analysis",
				promptTemplate: `Research objective:
{{research_prompt}}

Competitor website content:
{{page_content}}

Summarize the competitor value proposition, target customers, core features, signals about pricing or packaging, strengths, weaknesses, and product differentiation.`,
			},
		}),
		new LlmNode({
			name: "generate-report-json",
			inputs: "analysis & research_prompt & __llmCall",
			outputs: ["report_bundle_json"],
			nodeConfig: {
				outputKey: "report_bundle_json",
				promptTemplate: `Research objective:
{{research_prompt}}

Analysis:
{{analysis}}

Return strict JSON with this schema only: {"report": string, "key_findings": string[], "recommendations": string[]}.`,
			},
		}),
		new TransformNode({
			name: "parse-report-json",
			inputs: "report_bundle_json",
			outputs: ["report_bundle"],
			nodeConfig: {
				transformFn: "parse-json",
				inputKey: "report_bundle_json",
				outputKey: "report_bundle",
			},
		}),
		new TransformNode({
			name: "extract-report",
			inputs: "report_bundle",
			outputs: ["report"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "report_bundle",
				outputKey: "report",
				field: "report",
			},
		}),
		new TransformNode({
			name: "extract-key-findings",
			inputs: "report_bundle",
			outputs: ["key_findings"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "report_bundle",
				outputKey: "key_findings",
				field: "key_findings",
			},
		}),
		new TransformNode({
			name: "extract-recommendations",
			inputs: "report_bundle",
			outputs: ["recommendations"],
			nodeConfig: {
				transformFn: "get-field",
				inputKey: "report_bundle",
				outputKey: "recommendations",
				field: "recommendations",
			},
		}),
	],
	edges: [
		{ from: "fetch-competitor-site", to: "analyze-competitor" },
		{ from: "analyze-competitor", to: "generate-report-json" },
		{ from: "generate-report-json", to: "parse-report-json" },
		{ from: "parse-report-json", to: "extract-report" },
		{ from: "parse-report-json", to: "extract-key-findings" },
		{ from: "parse-report-json", to: "extract-recommendations" },
	],
};

/**
 * Create a competitor research pipeline instance.
 */
export function createResearchCompetitorPipeline(): Pipeline {
	return new Pipeline(researchCompetitorPipelineConfig);
}
