import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { ParseGoalSchema } from "../validators/parse-goal.validators.js";

const app = new Hono();

interface ParsedIssue {
	title: string;
	description: string;
	priority: "low" | "medium" | "high" | "urgent";
	suggestedAgent: string;
	estimatedComplexity: number; // 1-10
}

interface ParseGoalResponse {
	goal: string;
	issues: ParsedIssue[];
	modelUsed: string;
	tokensUsed: number;
}

// Simple rule-based parser used when no small-model provider is available.
// Returns structured issues from natural language goal text.
function ruleBasedParser(goal: string): ParsedIssue[] {
	const lines = goal
		.split(/[.\n]/)
		.map((l) => l.trim())
		.filter((l) => l.length > 10);

	const agentHints: Record<string, string[]> = {
		engineer: [
			"implement",
			"build",
			"create",
			"fix",
			"refactor",
			"write",
			"add",
			"migrate",
		],
		architect: ["design", "architect", "plan", "structure", "schema", "system"],
		qa: ["test", "verify", "check", "validate", "coverage", "spec"],
		security: [
			"security",
			"auth",
			"permission",
			"encrypt",
			"audit",
			"vulnerability",
		],
		"front-end": [
			"ui",
			"page",
			"component",
			"form",
			"dashboard",
			"display",
			"view",
		],
	};

	function pickAgent(text: string): string {
		const lower = text.toLowerCase();
		for (const [agent, keywords] of Object.entries(agentHints)) {
			if (keywords.some((k) => lower.includes(k))) return agent;
		}
		return "engineer";
	}

	function pickPriority(text: string): ParsedIssue["priority"] {
		const lower = text.toLowerCase();
		if (
			lower.includes("urgent") ||
			lower.includes("critical") ||
			lower.includes("asap")
		)
			return "urgent";
		if (lower.includes("important") || lower.includes("soon")) return "high";
		if (lower.includes("later") || lower.includes("nice")) return "low";
		return "medium";
	}

	function pickComplexity(text: string): number {
		const len = text.length;
		if (len < 40) return 2;
		if (len < 80) return 4;
		if (len < 150) return 6;
		return 8;
	}

	if (lines.length === 0) {
		return [
			{
				title: goal.slice(0, 80),
				description: goal,
				priority: "medium",
				suggestedAgent: pickAgent(goal),
				estimatedComplexity: pickComplexity(goal),
			},
		];
	}

	return lines.slice(0, 8).map((line) => ({
		title: line.slice(0, 80),
		description: line,
		priority: pickPriority(line),
		suggestedAgent: pickAgent(line),
		estimatedComplexity: pickComplexity(line),
	}));
}

async function callSmallModelParser(
	goal: string,
): Promise<{ issues: ParsedIssue[]; model: string; tokens: number }> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		return { issues: ruleBasedParser(goal), model: "rule-based", tokens: 0 };
	}

	const prompt = `You are a project manager. Convert the following goal into a JSON array of issues.

Goal: ${goal}

Respond with ONLY valid JSON array, no markdown, no explanation.
Each issue must have: title (string, max 80 chars), description (string), priority ("low"|"medium"|"high"|"urgent"), suggestedAgent ("engineer"|"architect"|"qa"|"security"|"front-end"|"back-end"), estimatedComplexity (1-10).
Maximum 6 issues.`;

	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: "claude-haiku-4-5",
			max_tokens: 1024,
			messages: [{ role: "user", content: prompt }],
		}),
	});

	if (!res.ok) {
		return {
			issues: ruleBasedParser(goal),
			model: "rule-based-fallback",
			tokens: 0,
		};
	}

	const data = (await res.json()) as {
		content: Array<{ type: string; text: string }>;
		usage: { input_tokens: number; output_tokens: number };
	};

	const text = data.content.find((b) => b.type === "text")?.text ?? "[]";
	const tokens =
		(data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);

	try {
		const issues = JSON.parse(text) as ParsedIssue[];
		return { issues, model: "claude-haiku-4-5", tokens };
	} catch {
		return {
			issues: ruleBasedParser(goal),
			model: "rule-based-parse-error",
			tokens,
		};
	}
}

app.post("/", zValidator("json", ParseGoalSchema), async (c) => {
	const body = c.req.valid("json");
	const goal: string = body.goal ?? "";

	if (!goal.trim()) {
		return c.json({ error: "goal is required" }, 400);
	}

	const { issues, model, tokens } = await callSmallModelParser(goal);

	const response: ParseGoalResponse = {
		goal,
		issues,
		modelUsed: model,
		tokensUsed: tokens,
	};

	return c.json(response);
});

export default app;
