import { zValidator } from "@hono/zod-validator";
import { IssuesService } from "@setra/application";
import { getRawDb } from "@setra/db";
import {
	SqliteIssuesRepository,
	requireTenantScope,
} from "@setra/infrastructure";
import { Hono } from "hono";
import { getCompanyEvents } from "../lib/agent-event-bus.js";
import { getCompanyId } from "../lib/company-scope.js";
import { applyKeysToEnv, getCompanySettings } from "../lib/company-settings.js";
import {
	type AdapterId,
	resolveAutoAdapter,
} from "../lib/resolve-auto-adapter.js";
import { recordLlmCost } from "../lib/track-llm-cost.js";
import { domainEventBus } from "../sse/handler.js";
import { ChatSchema } from "../validators/ai-ceo.validators.js";

const router = new Hono();
const issuesService = new IssuesService(
	new SqliteIssuesRepository(),
	domainEventBus,
);

type ProviderKind =
	| "anthropic"
	| "openai"
	| "openrouter"
	| "groq"
	| "gemini"
	| "ollama";

function adapterToProviderKind(adapter: AdapterId): ProviderKind | null {
	switch (adapter) {
		case "anthropic-api":
			return "anthropic";
		case "openai-api":
			return "openai";
		case "gemini-api":
			return "gemini";
		case "claude_local":
			return "anthropic";
		case "codex_local":
			return "openai";
		case "gemini_local":
			return "gemini";
		case "openrouter":
			return "openrouter";
		case "groq":
			return "groq";
		default:
			return null;
	}
}

function hasProviderKey(
	provider: ProviderKind,
	settings: Record<string, string | undefined>,
): boolean {
	switch (provider) {
		case "anthropic":
			return Boolean(
				settings["anthropic_api_key"] || process.env["ANTHROPIC_API_KEY"],
			);
		case "openai":
			return Boolean(
				settings["openai_api_key"] || process.env["OPENAI_API_KEY"],
			);
		case "openrouter":
			return Boolean(
				settings["openrouter_api_key"] || process.env["OPENROUTER_API_KEY"],
			);
		case "groq":
			return Boolean(settings["groq_api_key"] || process.env["GROQ_API_KEY"]);
		case "gemini":
			return Boolean(
				settings["gemini_api_key"] ||
					process.env["GEMINI_API_KEY"] ||
					process.env["GOOGLE_API_KEY"],
			);
		case "ollama":
			return true; // no key needed, just needs to be running
	}
}

function modelToProviderKind(model: string): ProviderKind | null {
	if (!model) return null;
	const m = model.toLowerCase();
	if (m.startsWith("ollama:")) return "ollama";
	if (m.startsWith("openrouter:") || m.startsWith("openrouter/"))
		return "openrouter";
	if (
		m.startsWith("groq:") ||
		m.includes("llama-3.3-70b-versatile") ||
		m.includes("qwen-qwq-32b")
	)
		return "groq";
	if (m.startsWith("claude")) return "anthropic";
	if (m.startsWith("gemini")) return "gemini";
	if (m.startsWith("gpt") || m.startsWith("o")) return "openai";
	return null;
}

interface AssistantAction {
	type: string;
	[key: string]: unknown;
}

interface ProjectPlanTask {
	title: string;
	description?: string;
	priority?: string;
	acceptance_criteria?: string[] | string;
}

function buildProjectRequirementsSection(companyId: string | null): string {
	if (!companyId) return "";
	const projects = getRawDb()
		.prepare(
			`SELECT id, name, requirements, COALESCE(plan_status, 'none') AS planStatus
			   FROM board_projects
			  WHERE company_id = ?
			    AND trim(COALESCE(requirements, '')) != ''
			  ORDER BY updated_at DESC, created_at ASC`,
		)
		.all(companyId) as Array<{
		id: string;
		name: string;
		requirements: string;
		planStatus: string;
	}>;
	if (projects.length === 0) return "";
	return `\n\n## Project Requirements\n${projects
		.map(
			(project) =>
				`## Project: ${project.name}\nProject ID: ${project.id}\nRequirements: ${project.requirements}\nPlan Status: ${project.planStatus}`,
		)
		.join("\n\n")}`;
}

function normalizeTaskPriority(
	priority: unknown,
): "none" | "urgent" | "high" | "medium" | "low" {
	const normalized =
		typeof priority === "string" ? priority.trim().toLowerCase() : "";
	switch (normalized) {
		case "urgent":
		case "high":
		case "medium":
		case "low":
		case "none":
			return normalized;
		case "critical":
			return "urgent";
		default:
			return "medium";
	}
}

function buildTaskDescription(task: ProjectPlanTask): string {
	const parts = [task.description?.trim() ?? ""];
	const acceptanceCriteria = Array.isArray(task.acceptance_criteria)
		? task.acceptance_criteria
				.map((criterion) => criterion.trim())
				.filter(Boolean)
		: typeof task.acceptance_criteria === "string"
			? task.acceptance_criteria
					.split(/\n+/)
					.map((criterion) => criterion.trim())
					.filter(Boolean)
			: [];
	if (acceptanceCriteria.length > 0) {
		parts.push(
			`Acceptance Criteria:\n${acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
		);
	}
	return (
		parts.filter(Boolean).join("\n\n") || "Planned from project requirements."
	);
}

async function executePlanningActions(
	companyId: string | null,
	actions: AssistantAction[],
): Promise<AssistantAction[]> {
	if (!companyId || actions.length === 0) return actions;
	const scope = requireTenantScope(companyId);
	const nextActions: AssistantAction[] = [];
	for (const action of actions) {
		if (action.type === "plan_project") {
			const projectId =
				typeof action.projectId === "string" ? action.projectId : null;
			const tasks = Array.isArray(action.tasks)
				? (action.tasks as ProjectPlanTask[])
				: [];
			if (!projectId || tasks.length === 0) continue;
			const project = getRawDb()
				.prepare(
					`SELECT id FROM board_projects WHERE id = ? AND company_id = ? LIMIT 1`,
				)
				.get(projectId, companyId) as { id: string } | undefined;
			if (!project) continue;
			for (const task of tasks) {
				if (!task?.title?.trim()) continue;
				const acceptanceCriteria = Array.isArray(task.acceptance_criteria)
					? task.acceptance_criteria
							.map((criterion) => criterion.trim())
							.filter(Boolean)
							.join("\n")
					: typeof task.acceptance_criteria === "string"
						? task.acceptance_criteria.trim()
						: "";
				const created = await issuesService.createIssue(scope, {
					projectId,
					title: task.title.trim(),
					description:
						task.description?.trim() || "Planned from project requirements.",
					status: "backlog",
					priority: normalizeTaskPriority(task.priority),
					acceptanceCriteria,
				});
				if (created.issue?.id) {
					getRawDb()
						.prepare(
							`UPDATE board_issues
							    SET tags = CASE
							      WHEN tags IS NULL OR trim(tags) = '' THEN 'requirements-plan'
							      WHEN instr(',' || tags || ',', ',requirements-plan,') > 0 THEN tags
							      ELSE tags || ',requirements-plan'
							    END,
							        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
							  WHERE id = ?`,
						)
						.run(created.issue.id);
				}
			}
			getRawDb()
				.prepare(
					`UPDATE board_projects
					    SET plan_status = 'draft',
					        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
					  WHERE id = ? AND company_id = ?`,
				)
				.run(projectId, companyId);
			nextActions.push({
				type: "navigate",
				route: `/projects/${projectId}`,
				label: "View Draft Plan",
			});
			continue;
		}
		if (action.type === "approve_plan") {
			const projectId =
				typeof action.projectId === "string" ? action.projectId : null;
			if (!projectId) continue;
			getRawDb()
				.prepare(
					`UPDATE board_projects
					    SET plan_status = 'approved',
					        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
					  WHERE id = ? AND company_id = ?`,
				)
				.run(projectId, companyId);
			getRawDb()
				.prepare(
					`UPDATE board_issues
					    SET status = 'todo',
					        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
					  WHERE project_id = ?
					    AND company_id = ?
					    AND status = 'backlog'
					    AND instr(',' || COALESCE(tags, '') || ',', ',requirements-plan,') > 0`,
				)
				.run(projectId, companyId);
			nextActions.push({
				type: "navigate",
				route: `/projects/${projectId}`,
				label: "Open Approved Plan",
			});
			continue;
		}
		nextActions.push(action);
	}
	return nextActions;
}

// POST /api/ai/chat — AI CEO chat
// Body: { messages: [{role, content}], companyName: string, companyGoal?: string }
router.post("/chat", zValidator("json", ChatSchema), async (c) => {
	const body = c.req.valid("json");
	const costSlug = body.agentSlug ?? "assistant";

	const cid = getCompanyId(c);
	applyKeysToEnv(cid);
	const s = getCompanySettings(cid) as Record<string, string | undefined>;
	const defaultModel = (s["default_model"] ?? "claude-sonnet-4-5") as string;

	// Gather recent agent activity to give the CEO situational awareness.
	let eventSummary = "";
	try {
		const recentEvents = getCompanyEvents(cid, 20);
		if (recentEvents.length > 0) {
			eventSummary =
				"\n\n## Recent Agent Activity\n" +
				recentEvents
					.map(
						(e) =>
							`[${e.eventType}] ${e.sourceAgent}${e.targetAgent ? ` → ${e.targetAgent}` : ""}: ${JSON.stringify(e.payload)}`,
					)
					.join("\n");
		}
	} catch {
		/* non-critical — never block the CEO response */
	}

	const resolved = resolveAutoAdapter(null, null, cid);
	let providerKind = resolved.adapter
		? adapterToProviderKind(resolved.adapter)
		: null;
	let chosenModel = resolved.model || defaultModel || "auto";

	// Honor company-selected default model/provider when available instead of always
	// forcing cost-priority routing.
	const preferredProvider = modelToProviderKind(defaultModel);
	if (preferredProvider && hasProviderKey(preferredProvider, s)) {
		providerKind = preferredProvider;
		chosenModel = defaultModel;
	}

	if (!providerKind) {
		return c.json(
			{
				error:
					"No AI provider configured. Go to Settings → AI Providers to add an API key.",
			},
			400,
		);
	}

	const projectRequirementsSection = buildProjectRequirementsSection(cid);
	const systemPrompt = `You are the Assistant for ${body.companyName ?? "this company"} — the user's always-available personal AI agent on Setra.

You act as the user's proxy: when the team of AI agent employees is hired, you also relay the user's directives to them. You can take actions on the user's behalf (settings changes, hiring agents, running tasks) by emitting an ACTIONS block.

TOOLS AVAILABLE (emit as {"type":"tool","name":"<tool>","params":{...}}):
- read_settings — inspect current settings (keys masked)
- set_api_key  — params: {provider, value} where provider is one of anthropic/openai/openrouter/groq/gemini
- list_agents
- hire_agent   — params: {templateId, displayName}
- pause_agent / resume_agent — params: {slug}
- run_agent    — params: {slug, task}
- run_agents_parallel — params: {task, slugs?, maxAgents?}
- create_skill — params: {name, prompt, category?, trigger?, description?}
- list_companies
- list_projects
- update_project — params: {projectId, name?, description?, repoUrl?, defaultBranch?}
- get_budget_summary
- set_budget   — params: {limitUsd, periodDays?, alertPercent?}
- plan_project — params: {projectId, tasks:[{title, description, priority, acceptance_criteria}]}
- approve_plan — params: {projectId}

When the user asks you to do something (e.g. "set my OpenAI key to sk-..."), emit the corresponding tool action in the ACTIONS block. For requests like "run CTO + Designer + Developer in parallel", prefer run_agents_parallel with explicit slugs when provided.

When a project has requirements and the user asks for a plan, emit a structured plan_project action with the projectId and a tasks array. Each task must include title, description, priority, and acceptance_criteria so Setra can create backlog issues for approval. When the user approves a draft plan, emit {"type":"approve_plan","projectId":"..."}.

Your role:
- Welcome new users and understand what they want to build
- Ask clarifying questions to understand their goals
- Guide them through Setra features (Issues, Projects, Agents, Goals, Integrations)
- Suggest next actions as short, clickable actions
- Keep responses concise (2-4 sentences max) unless user asks for more detail
- Be encouraging and action-oriented
- You have full admin access to all settings, agents, and configurations
- IMPORTANT: Always describe what you intend to do and ask for explicit confirmation before executing any state-changing action (hiring agents, changing settings, setting keys, running agents, modifying budgets, creating/approving plans). Only emit the ACTIONS block after the user confirms.

Available features you can guide users to:
- Issues: Create and track tasks for AI agents to work on
- Projects: Organize issues into workstreams  
- Agents: AI workers that execute issues autonomously
- Goals: High-level objectives broken into tasks
- Integrations: Connect GitHub, Slack, Jira
- Wiki: Shared knowledge base built by agents
- Inbox: Notifications and agent updates
- Routines: Scheduled recurring agent tasks

When the user wants to create something, include an ACTIONS block at the END of your response:
- To create an issue: {"type": "create_issue", "title": "...", "description": "..."}
- To create an agent: {"type": "create_agent"}
- To plan a project from requirements: {"type": "plan_project", "projectId": "...", "tasks": [{"title": "...", "description": "...", "priority": "high", "acceptance_criteria": ["..."]}]}
- To approve a drafted plan: {"type": "approve_plan", "projectId": "..."}
- To navigate: {"type": "navigate", "route": "/path", "label": "Button Label"}

Format: ACTIONS: [{"type": "navigate", "route": "/agents", "label": "View Agents"}, ...]

${body.companyGoal ? `Company goal: ${body.companyGoal}` : ""}${eventSummary}${projectRequirementsSection}`;
	const messages = [
		{ role: "system" as const, content: systemPrompt },
		...body.messages,
	];

	// Route to the resolved provider for this company. Each branch uses the
	// company-scoped key (already on process.env via applyKeysToEnv, but we
	// also read from `s` so company overrides win even if env had stale values
	// from another company in this process).
	let lastError: string | null = null;

	if (providerKind === "anthropic") {
		try {
			const key = s["anthropic_api_key"] ?? process.env["ANTHROPIC_API_KEY"]!;
			const model = chosenModel.startsWith("claude")
				? chosenModel
				: "claude-sonnet-4-5";
			const resp = await fetch("https://api.anthropic.com/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": key,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model,
					max_tokens: 1024,
					system: systemPrompt,
					messages: body.messages.filter((m) => m.role !== "system"),
				}),
			});
			if (resp.ok) {
				const data = (await resp.json()) as {
					content: { text: string }[];
					usage?: { input_tokens?: number; output_tokens?: number };
				};
				const rawText = data.content?.[0]?.text ?? "";
				const { text, actions } = await parseActions(rawText, cid);
				if (data.usage) {
					recordLlmCost({
						agentSlug: costSlug,
						model,
						usage: {
							prompt_tokens: data.usage.input_tokens,
							completion_tokens: data.usage.output_tokens,
						},
						source: "ai-chat",
						companyId: cid,
					});
				}
				return c.json({ reply: text, model: "anthropic", actions });
			}
			lastError = `anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
		} catch (e) {
			lastError = `anthropic threw: ${(e as Error).message}`;
		}
	} else if (providerKind === "openai") {
		try {
			const key = s["openai_api_key"] ?? process.env["OPENAI_API_KEY"]!;
			const model =
				chosenModel.startsWith("gpt") || chosenModel.startsWith("o")
					? chosenModel
					: "gpt-4o-mini";
			const resp = await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${key}`,
				},
				body: JSON.stringify({
					model,
					max_completion_tokens: 1024,
					messages,
				}),
			});
			if (resp.ok) {
				const data = (await resp.json()) as {
					choices: { message: { content: string } }[];
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const rawText = data.choices?.[0]?.message?.content ?? "";
				const { text, actions } = await parseActions(rawText, cid);
				if (data.usage) {
					recordLlmCost({
						agentSlug: costSlug,
						model,
						usage: data.usage,
						source: "ai-chat",
						companyId: cid,
					});
				}
				return c.json({ reply: text, model: "openai", actions });
			}
			lastError = `openai ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
		} catch (e) {
			lastError = `openai threw: ${(e as Error).message}`;
		}
	} else if (providerKind === "openrouter") {
		try {
			const orKey =
				s["openrouter_api_key"] ?? process.env["OPENROUTER_API_KEY"]!;
			// resolveAutoAdapter prefixes openrouter models with "openrouter:" — strip it.
			const orModel = chosenModel.startsWith("openrouter:")
				? chosenModel.slice("openrouter:".length)
				: chosenModel && chosenModel !== "auto"
					? chosenModel
					: "openrouter/auto";

			async function callOpenRouter(model: string) {
				return fetch("https://openrouter.ai/api/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${orKey}`,
						"HTTP-Referer": "http://localhost:3141",
						"X-Title": "Setra Assistant",
					},
					body: JSON.stringify({
						model,
						max_tokens: 1024,
						messages,
					}),
				});
			}

			let resp = await callOpenRouter(orModel);
			if (!resp.ok && orModel !== "openrouter/auto") {
				resp = await callOpenRouter("openrouter/auto");
			}
			if (resp.ok) {
				const data = (await resp.json()) as {
					choices: { message: { content: string } }[];
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const rawText = data.choices?.[0]?.message?.content ?? "";
				const { text, actions } = await parseActions(rawText, cid);
				if (data.usage) {
					recordLlmCost({
						agentSlug: costSlug,
						model: orModel,
						usage: data.usage,
						source: "ai-chat",
						companyId: cid,
					});
				}
				return c.json({ reply: text, model: "openrouter", actions });
			}

			// OpenRouter can fail due account-level constraints (402 credits, 404
			// endpoint not available). If OpenAI is configured, fall back so AI UX
			// still works instead of hard-failing onboarding/autofill.
			if (
				(resp.status === 402 || resp.status === 404 || resp.status === 429) &&
				hasProviderKey("openai", s)
			) {
				const oaKey = s["openai_api_key"] ?? process.env["OPENAI_API_KEY"]!;
				const oaModel =
					chosenModel.startsWith("gpt") || chosenModel.startsWith("o")
						? chosenModel
						: "gpt-4o-mini";
				const fb = await fetch("https://api.openai.com/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${oaKey}`,
					},
					body: JSON.stringify({
						model: oaModel,
						max_completion_tokens: 1024,
						messages,
					}),
				});
				if (fb.ok) {
					const data = (await fb.json()) as {
						choices: { message: { content: string } }[];
						usage?: { prompt_tokens?: number; completion_tokens?: number };
					};
					const rawText = data.choices?.[0]?.message?.content ?? "";
					const { text, actions } = await parseActions(rawText, cid);
					if (data.usage) {
						recordLlmCost({
							agentSlug: costSlug,
							model: oaModel,
							usage: data.usage,
							source: "ai-chat",
							companyId: cid,
						});
					}
					return c.json({ reply: text, model: "openai", actions });
				}
			}

			lastError = `openrouter ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
		} catch (e) {
			lastError = `openrouter threw: ${(e as Error).message}`;
		}
	} else if (providerKind === "groq") {
		try {
			const key = s["groq_api_key"] ?? process.env["GROQ_API_KEY"]!;
			const model =
				chosenModel && chosenModel !== "auto"
					? chosenModel
					: "llama-3.3-70b-versatile";
			const resp = await fetch(
				"https://api.groq.com/openai/v1/chat/completions",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${key}`,
					},
					body: JSON.stringify({
						model,
						max_tokens: 1024,
						messages,
					}),
				},
			);
			if (resp.ok) {
				const data = (await resp.json()) as {
					choices: { message: { content: string } }[];
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const rawText = data.choices?.[0]?.message?.content ?? "";
				const { text, actions } = await parseActions(rawText, cid);
				if (data.usage) {
					recordLlmCost({
						agentSlug: costSlug,
						model,
						usage: data.usage,
						source: "ai-chat",
						companyId: cid,
					});
				}
				return c.json({ reply: text, model: "groq", actions });
			}
			lastError = `groq ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
		} catch (e) {
			lastError = `groq threw: ${(e as Error).message}`;
		}
	} else if (providerKind === "gemini") {
		try {
			const key = s["gemini_api_key"] ?? process.env["GEMINI_API_KEY"]!;
			const model =
				chosenModel && chosenModel !== "auto"
					? chosenModel
					: "gemini-2.5-flash";
			const resp = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						systemInstruction: { parts: [{ text: systemPrompt }] },
						contents: body.messages
							.filter((m) => m.role !== "system")
							.map((m) => ({
								role: m.role === "assistant" ? "model" : "user",
								parts: [{ text: m.content }],
							})),
						generationConfig: { maxOutputTokens: 1024 },
					}),
				},
			);
			if (resp.ok) {
				const data = (await resp.json()) as {
					candidates?: { content?: { parts?: { text?: string }[] } }[];
					usageMetadata?: {
						promptTokenCount?: number;
						candidatesTokenCount?: number;
					};
				};
				const rawText =
					data.candidates?.[0]?.content?.parts
						?.map((p) => p.text ?? "")
						.join("") ?? "";
				const { text, actions } = await parseActions(rawText, cid);
				if (data.usageMetadata) {
					recordLlmCost({
						agentSlug: costSlug,
						model,
						usage: {
							prompt_tokens: data.usageMetadata.promptTokenCount,
							completion_tokens: data.usageMetadata.candidatesTokenCount,
						},
						source: "ai-chat",
						companyId: cid,
					});
				}
				return c.json({ reply: text, model: "gemini", actions });
			}
			lastError = `gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
		} catch (e) {
			lastError = `gemini threw: ${(e as Error).message}`;
		}
	} else if (providerKind === "ollama") {
		try {
			const ollamaUrl = (s["ollama_url"] as string) ?? "http://localhost:11434";
			// Strip "ollama:" prefix to get the actual model name
			const model = chosenModel.startsWith("ollama:")
				? chosenModel.slice(7)
				: chosenModel === "auto"
					? "llama3.2:latest"
					: chosenModel;
			const resp = await fetch(`${ollamaUrl}/v1/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					messages,
					max_tokens: 1024,
				}),
				signal: AbortSignal.timeout(60_000),
			});
			if (resp.ok) {
				const data = (await resp.json()) as {
					choices: { message: { content: string } }[];
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
				const rawText = data.choices?.[0]?.message?.content ?? "";
				const { text, actions } = await parseActions(rawText, cid);
				return c.json({ reply: text, model: `ollama/${model}`, actions });
			}
			lastError = `ollama ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
		} catch (e) {
			lastError = `ollama threw: ${(e as Error).message}`;
		}
	}

	// No provider succeeded. Surface the actual error so the user can debug
	// (previously this silently fell through to a canned local reply, making
	// the Assistant look "unreliable" when in reality the upstream API was
	// failing or the key was wrong).
	if (lastError) {
		console.error("[assistant] all providers failed:", lastError);
		return c.json(
			{
				reply: `I couldn't reach any LLM provider. Last error: ${lastError}. Check your API key in Settings.`,
				model: "error",
				actions: [
					{ type: "navigate", route: "/settings", label: "Open Settings" },
				],
			},
			502,
		);
	}

	// No keys configured at all → guide the user to Settings.
	return c.json({
		reply:
			"No API key is configured yet. Add one in Settings to enable the Assistant (Anthropic, OpenAI, or OpenRouter all work).",
		model: "no-key",
		actions: [{ type: "navigate", route: "/settings", label: "Open Settings" }],
	});
});

async function parseActions(
	text: string,
	companyId: string | null,
): Promise<{
	text: string;
	actions: AssistantAction[];
}> {
	const match = text.match(/ACTIONS:\s*(\[[\s\S]*?\])\s*$/);
	if (!match) return { text, actions: [] };
	try {
		const parsed = JSON.parse(match[1]!) as AssistantAction[];
		return {
			text: text.replace(/ACTIONS:\s*\[[\s\S]*?\]\s*$/, "").trim(),
			actions: await executePlanningActions(companyId, parsed),
		};
	} catch {
		return { text, actions: [] };
	}
}

function generateFallbackReply(
	userMessage: string,
	companyName: string,
): string {
	const lower = userMessage.toLowerCase();

	if (
		lower.includes("issue") ||
		lower.includes("task") ||
		lower.includes("todo")
	) {
		return `Great! Let's create your first issue. An issue is a task that your AI agents will work on autonomously.\n\nACTIONS: [{"type": "create_issue", "title": "First issue", "description": "Getting started"}, {"type": "navigate", "route": "/projects", "label": "Go to Projects"}]`;
	}
	if (
		lower.includes("agent") ||
		lower.includes("hire") ||
		lower.includes("team")
	) {
		return `Your AI team is ready to be assembled. Each agent has a role and runs a model of your choice. Let's set up your first agent!\n\nACTIONS: [{"type": "navigate", "route": "/agents", "label": "View Agents"}, {"type": "navigate", "route": "/goals", "label": "Goals"}]`;
	}
	if (
		lower.includes("goal") ||
		lower.includes("plan") ||
		lower.includes("roadmap")
	) {
		return `Setting goals helps your AI agents understand what matters most. I'll break down your goals into actionable issues automatically.\n\nACTIONS: [{"type": "navigate", "route": "/goals", "label": "Create Goal"}, {"type": "navigate", "route": "/projects", "label": "View Roadmap"}]`;
	}
	if (
		lower.includes("github") ||
		lower.includes("slack") ||
		lower.includes("integrat")
	) {
		return `Connecting your tools makes ${companyName} much more powerful. Let's set up your integrations.\n\nACTIONS: [{"type": "navigate", "route": "/integrations", "label": "Integrations"}]`;
	}

	return `Welcome to ${companyName}! I'm your Assistant, here to help you build great things. What would you like to work on first — creating issues for your agents, setting up your team, or connecting your tools?\n\nACTIONS: [{"type": "navigate", "route": "/projects", "label": "Create Issues"}, {"type": "navigate", "route": "/agents", "label": "Setup Agents"}, {"type": "navigate", "route": "/integrations", "label": "Connect Tools"}]`;
}

export { router as aiCeoRoute };
export { router as assistantRoute };
