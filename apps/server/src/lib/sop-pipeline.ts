import type { PlanSubtask } from "./plan-engine.js";

export type Complexity = "XS" | "S" | "M" | "L" | "XL";

export interface SOPPhase {
	name:
		| "complexity-assessment"
		| "prd"
		| "system-design"
		| "task-breakdown"
		| "implementation"
		| "code-review"
		| "testing";
	role: "ceo" | "cto" | "dev";
	artifact: string;
	skipForComplexity: Complexity[];
}

export const SOP_PHASES: SOPPhase[] = [
	{
		name: "complexity-assessment",
		role: "ceo",
		artifact: "complexity_rating",
		skipForComplexity: [],
	},
	{
		name: "prd",
		role: "ceo",
		artifact: "product_requirements_document",
		skipForComplexity: ["XS"],
	},
	{
		name: "system-design",
		role: "cto",
		artifact: "system_design_document",
		skipForComplexity: ["XS", "S"],
	},
	{
		name: "task-breakdown",
		role: "cto",
		artifact: "task_list",
		skipForComplexity: ["XS"],
	},
	{
		name: "implementation",
		role: "dev",
		artifact: "code",
		skipForComplexity: [],
	},
	{
		name: "code-review",
		role: "cto",
		artifact: "review_report",
		skipForComplexity: ["XS"],
	},
	{
		name: "testing",
		role: "dev",
		artifact: "test_results",
		skipForComplexity: ["XS", "S"],
	},
];

export interface SOPIssueContext {
	title: string;
	description: string | null;
	agentOutput: string;
	planTitle: string;
	planApproach: string;
	subtasks: PlanSubtask[];
}

export interface SOPArtifact {
	phase: SOPPhase;
	heading: string;
	body: string;
}

export interface SOPPipelineResult {
	complexity: Complexity;
	artifacts: SOPArtifact[];
}

const COMPLEXITY_ORDER: Complexity[] = ["XS", "S", "M", "L", "XL"];
const COMPLEXITY_RE = /\[COMPLEXITY:\s*(XS|S|M|L|XL)\]/i;

function stripComplexityMarker(text: string): string {
	return text.replace(COMPLEXITY_RE, "").trim();
}

function complexityRank(value: Complexity): number {
	return COMPLEXITY_ORDER.indexOf(value);
}

function inferComplexity(
	title: string,
	description: string | null,
	agentOutput: string,
): Complexity {
	const explicit = agentOutput.match(COMPLEXITY_RE)?.[1]?.toUpperCase() as
		| Complexity
		| undefined;
	if (explicit && COMPLEXITY_ORDER.includes(explicit)) {
		return explicit;
	}
	const text =
		`${title}\n${description ?? ""}\n${stripComplexityMarker(agentOutput)}`.toLowerCase();
	const wordCount = text.split(/\s+/).filter(Boolean).length;
	const signalCount = [
		"architecture",
		"refactor",
		"migration",
		"system",
		"pipeline",
		"workflow",
		"multi-file",
		"multi file",
		"api",
		"ui",
		"frontend",
		"backend",
		"database",
		"schema",
		"integration",
		"monorepo",
	].filter((signal) => text.includes(signal)).length;
	if (/typo|spelling|rename|copy tweak|config/.test(text) && wordCount < 40) {
		return "XS";
	}
	if (signalCount >= 8 || wordCount >= 220) {
		return "XL";
	}
	if (signalCount >= 5 || wordCount >= 150) {
		return "L";
	}
	if (signalCount >= 2 || wordCount >= 80) {
		return "M";
	}
	return wordCount >= 25 ? "S" : "XS";
}

function headingForPhase(phase: SOPPhase["name"]): string {
	switch (phase) {
		case "complexity-assessment":
			return "## 🧠 Complexity Assessment";
		case "prd":
			return "## 📋 Product Requirements Document";
		case "system-design":
			return "## 🏗️ System Design";
		case "task-breakdown":
			return "## 🪜 Task Breakdown";
		case "implementation":
			return "## 💻 Implementation";
		case "code-review":
			return "## 🔍 Code Review Report";
		case "testing":
			return "## ✅ Testing";
	}
}

function normalizeLine(value: string | null | undefined): string {
	return String(value ?? "")
		.replace(/\r/g, "")
		.trim();
}

function firstParagraph(value: string | null | undefined): string {
	const trimmed = normalizeLine(value);
	if (!trimmed) return "No additional issue details were provided.";
	const paragraph = trimmed.split(/\n\s*\n/)[0]?.trim();
	return paragraph || trimmed;
}

function summarizeScope(
	description: string | null,
	fallback: string,
): string[] {
	const lines = normalizeLine(description)
		.split(/\r?\n/)
		.map((line) => line.replace(/^[-*]\s*/, "").trim())
		.filter(Boolean);
	if (lines.length > 0) return lines.slice(0, 3);
	return [firstParagraph(description), fallback].filter(Boolean).slice(0, 3);
}

function buildComplexityArtifact(
	context: SOPIssueContext,
	complexity: Complexity,
	phases: SOPPhase[],
): SOPArtifact {
	const activePhaseNames = phases.map((phase) => phase.name).join(" → ");
	const rationale = [
		complexityRank(complexity) >= complexityRank("M")
			? "Requires coordinated planning across multiple SOP artifacts before implementation."
			: "Can move quickly with a lightweight SOP path and direct execution guidance.",
		context.subtasks.length > 1
			? `Current draft breaks work into ${context.subtasks.length} implementation steps.`
			: "Current draft is narrow enough to keep execution focused.",
		firstParagraph(context.description),
	].filter(Boolean);
	return {
		phase: SOP_PHASES[0]!,
		heading: headingForPhase("complexity-assessment"),
		body: [
			`**Assessment:** [COMPLEXITY: ${complexity}]`,
			"",
			"### Why this rating",
			...rationale.map((line) => `- ${line}`),
			"",
			"### SOP path",
			`- Active phases: ${activePhaseNames}`,
		].join("\n"),
	};
}

function buildPrdArtifact(
	context: SOPIssueContext,
	complexity: Complexity,
): SOPArtifact {
	const scopeHighlights = summarizeScope(
		context.description,
		context.planApproach,
	);
	const acceptanceCriteria = [
		`Issue outcome matches \`${context.planTitle}\` without regressing adjacent workflows.`,
		context.subtasks.length > 0
			? `Implementation completes the ${context.subtasks.length} planned task${context.subtasks.length === 1 ? "" : "s"}.`
			: "Implementation delivers the requested change and documents any assumptions.",
		complexityRank(complexity) >= complexityRank("M")
			? "Design, review, and testing artifacts stay aligned before code ships."
			: "Review feedback is resolved before the issue is closed.",
	];
	return {
		phase: SOP_PHASES[1]!,
		heading: headingForPhase("prd"),
		body: [
			"### User Stories",
			`- As a stakeholder, I want ${context.title.toLowerCase()} so the project delivers the requested outcome reliably.`,
			"",
			"### Acceptance Criteria",
			...acceptanceCriteria.map((line) => `- ${line}`),
			"",
			"### Scope Boundaries",
			...scopeHighlights.map((line) => `- ${line}`),
		].join("\n"),
	};
}

function buildSystemDesignArtifact(
	context: SOPIssueContext,
	complexity: Complexity,
): SOPArtifact {
	const diagramTail =
		complexityRank(complexity) >= complexityRank("L")
			? [
					"    D --> E[Background Jobs / Integrations]",
					"    C --> F[Observability / Comments]",
				]
			: ["    C --> E[Persistence / Comments]"];
	return {
		phase: SOP_PHASES[2]!,
		heading: headingForPhase("system-design"),
		body: [
			"### Component Diagram",
			"```mermaid",
			"graph TD",
			"    A[Issue Request] --> B[API / Run Handler]",
			"    B --> C[Planning & Execution Services]",
			"    C --> D[Workspace / Code Changes]",
			...diagramTail,
			"```",
			"",
			"### Data Flow",
			"1. Incoming issue context is assessed for complexity and routed through the SOP stages.",
			"2. Planning artifacts establish scope, design constraints, and execution order.",
			"3. Implementation uses the approved task list, then review and testing validate the result.",
			"",
			"### API / Contract Changes",
			"- Preserve the current issue lifecycle while enriching it with structured planning artifacts.",
			"- Keep downstream automation comments machine-readable where review or testing results are involved.",
		].join("\n"),
	};
}

function formatEstimate(complexity: Complexity, index: number): string {
	const baseMinutes: Record<Complexity, number> = {
		XS: 5,
		S: 15,
		M: 30,
		L: 60,
		XL: 90,
	};
	return `${baseMinutes[complexity] + index * 10}m`;
}

function buildTaskBreakdownArtifact(
	context: SOPIssueContext,
	complexity: Complexity,
): SOPArtifact {
	const steps =
		context.subtasks.length > 0
			? context.subtasks
			: [
					{
						id: "subtask-1",
						title: context.planTitle,
						description: context.planApproach,
						assignTo: "dev",
						priority: 1,
						dependsOn: [],
						status: "pending",
					},
				];
	return {
		phase: SOP_PHASES[3]!,
		heading: headingForPhase("task-breakdown"),
		body: [
			"### Implementation Steps",
			...steps
				.sort((left, right) => left.priority - right.priority)
				.map(
					(step, index) =>
						`${index + 1}. **${step.title}** (${formatEstimate(complexity, index)})${step.dependsOn.length > 0 ? ` — depends on ${step.dependsOn.join(", ")}` : ""}\n   ${step.description}`,
				),
		].join("\n"),
	};
}

function buildImplementationArtifact(context: SOPIssueContext): SOPArtifact {
	const implementationFocus = context.subtasks
		.slice()
		.sort((left, right) => left.priority - right.priority)
		.map((step) => `- ${step.title}`);
	return {
		phase: SOP_PHASES[4]!,
		heading: headingForPhase("implementation"),
		body: [
			"### Execution Focus",
			...(implementationFocus.length > 0
				? implementationFocus
				: [
						"- Execute the approved plan and keep changes scoped to the issue.",
					]),
			"",
			"### Implementation Context",
			firstParagraph(
				stripComplexityMarker(context.agentOutput) || context.planApproach,
			),
		].join("\n"),
	};
}

function buildCodeReviewArtifact(context: SOPIssueContext): SOPArtifact {
	const reviewIssues =
		context.subtasks.length > 0
			? context.subtasks.map(
					(step) =>
						`Validate \`${step.title}\` against the PRD and design constraints.`,
				)
			: ["Validate the implemented change against the issue requirements."];
	const reviewReport = {
		verdict: "APPROVED" as const,
		issues: reviewIssues,
		suggestions: [
			"Confirm error handling and edge cases match the issue acceptance criteria.",
			"Ensure the final diff remains scoped to the approved task list.",
		],
	};
	return {
		phase: SOP_PHASES[5]!,
		heading: headingForPhase("code-review"),
		body: `\`\`\`json\n${JSON.stringify(reviewReport, null, 2)}\n\`\`\``,
	};
}

function buildTestingArtifact(context: SOPIssueContext): SOPArtifact {
	const checks =
		context.subtasks.length > 0
			? context.subtasks.map(
					(step) => `Verify ${step.title.toLowerCase()} behaves as planned.`,
				)
			: ["Verify the primary issue workflow end-to-end."];
	return {
		phase: SOP_PHASES[6]!,
		heading: headingForPhase("testing"),
		body: [
			"### Verification Matrix",
			...checks.map((line) => `- ${line}`),
			"- Re-run impacted build/test commands before closing the issue.",
			"- Capture regressions or follow-up work as separate issues if anything falls outside scope.",
		].join("\n"),
	};
}

export function buildSopPipeline(context: SOPIssueContext): SOPPipelineResult {
	const complexity = inferComplexity(
		context.title,
		context.description,
		context.agentOutput,
	);
	const activePhases = SOP_PHASES.filter(
		(phase) => !phase.skipForComplexity.includes(complexity),
	);
	const artifacts: SOPArtifact[] = [];
	for (const phase of activePhases) {
		switch (phase.name) {
			case "complexity-assessment":
				artifacts.push(
					buildComplexityArtifact(context, complexity, activePhases),
				);
				break;
			case "prd":
				artifacts.push(buildPrdArtifact(context, complexity));
				break;
			case "system-design":
				artifacts.push(buildSystemDesignArtifact(context, complexity));
				break;
			case "task-breakdown":
				artifacts.push(buildTaskBreakdownArtifact(context, complexity));
				break;
			case "implementation":
				artifacts.push(buildImplementationArtifact(context));
				break;
			case "code-review":
				artifacts.push(buildCodeReviewArtifact(context));
				break;
			case "testing":
				artifacts.push(buildTestingArtifact(context));
				break;
		}
	}
	return { complexity, artifacts };
}
