/**
 * Assistant tools route — POST /api/assistant/tools/:tool
 *
 * The Assistant chat (formerly AI CEO) is the user's personal agent. It can
 * take real actions on the user's behalf by invoking whitelisted tools. This
 * route is the server-side surface those tools live behind.
 *
 * SECURITY: Only the user's own browser/Electron app talks to the local
 * Setra server, so we don't authenticate per-request — but we do strictly
 * whitelist tool names so a runaway / prompt-injected Assistant can't read
 * arbitrary files or shell out.
 *
 * Available tools (v1):
 *   - read_settings             → returns ~/.setra/settings.json with masked keys
 *   - set_api_key               → save a single API key by provider + value
 *   - list_agents               → roster summary
 *   - hire_agent                → create new agent_roster row
 *   - pause_agent / resume_agent
 *   - run_agent                 → enqueue a run on an existing agent
 *   - run_agents_parallel       → launch one task across many agents
 *   - create_skill              → create a new company skill
 *   - list_companies            → companies summary
 *   - get_budget_summary        → live budget + spend snapshot
 *   - set_budget                → update global budget settings
 *
 * The Assistant decides which tools to call from the LLM. The board UI
 * shows a confirmation toast for any state-changing tool before it runs
 * (handled client-side; this endpoint trusts the caller).
 */

import { zValidator } from "@hono/zod-validator";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { recheckAvailability } from "../lib/agent-lifecycle.js";
import { logActivity } from "../lib/audit.js";
import {
	applyKeysToEnv,
	getCompanySettings,
	getDefaultCompanyId,
	setCompanySettings,
} from "../lib/company-settings.js";
import { resolveAutoAdapter } from "../lib/resolve-auto-adapter.js";
import { spawnServerRun } from "../lib/server-runner.js";
import * as assistantRepo from "../repositories/assistant.repo.js";
import * as skillsRepo from "../repositories/skills.repo.js";
import { emit } from "../sse/handler.js";
import { AssistantToolSchema } from "../validators/assistant.validators.js";

export const assistantToolsRoute = new Hono();

function mask(v: unknown): string {
	if (typeof v !== "string" || v.length === 0) return "";
	if (v.length <= 6) return "•••••••";
	return `••••••••${v.slice(-4)}`;
}

const KEY_FIELDS: Record<string, string> = {
	anthropic: "anthropic_api_key",
	openai: "openai_api_key",
	openrouter: "openrouter_api_key",
	groq: "groq_api_key",
	gemini: "gemini_api_key",
	together: "together_api_key",
	tavily: "tavily_api_key",
	brave: "brave_api_key",
	serper: "serper_api_key",
};

assistantToolsRoute.post(
	"/tools/:tool",
	zValidator("json", AssistantToolSchema),
	async (c) => {
		const tool = c.req.param("tool");
		const body = c.req.valid("json");

		// Per-request company scope: explicit body override → header → default.
		const cid =
			(typeof body["companyId"] === "string"
				? (body["companyId"] as string)
				: undefined) ??
			c.req.header("x-company-id") ??
			getDefaultCompanyId();

		switch (tool) {
			case "read_settings": {
				const s = getCompanySettings(cid);
				return c.json({
					ok: true,
					companyId: cid,
					settings: {
						defaultModel: s["default_model"] ?? null,
						smallModel: s["small_model"] ?? null,
						keys: Object.fromEntries(
							Object.entries(KEY_FIELDS).map(([prov, field]) => [
								prov,
								mask(s[field]),
							]),
						),
						budget: {
							dailyUsd: s["budget_daily_usd"] ?? null,
							perRunUsd: s["budget_per_run_usd"] ?? null,
							alertAt: s["budget_alert_at"] ?? null,
						},
					},
				});
			}

			case "set_api_key": {
				const provider = String(body["provider"] ?? "");
				const value = String(body["value"] ?? "").trim();
				const field = KEY_FIELDS[provider];
				if (!field)
					return c.json(
						{
							ok: false,
							error: `Unknown provider "${provider}". Allowed: ${Object.keys(KEY_FIELDS).join(", ")}`,
						},
						400,
					);
				if (!value)
					return c.json({ ok: false, error: "value is required" }, 400);
				setCompanySettings(cid, { [field]: value });
				applyKeysToEnv(cid);
				const recheck = recheckAvailability(cid);
				emit("settings:updated", { provider, companyId: cid });
				await logActivity(
					c,
					"assistant.tool.set_api_key",
					"assistant_tool",
					provider,
					{ companyId: cid },
				);
				return c.json({ ok: true, provider, companyId: cid, recheck });
			}

			case "list_agents": {
				const rows = assistantRepo.listAgents(cid);
				return c.json({ ok: true, agents: rows });
			}

			case "hire_agent": {
				const templateId = String(body["templateId"] ?? "");
				const displayName = String(body["displayName"] ?? "").trim();
				if (!templateId || !displayName) {
					return c.json(
						{ ok: false, error: "templateId and displayName are required" },
						400,
					);
				}
				const tpl = assistantRepo.getAgentTemplate(templateId);
				if (!tpl)
					return c.json(
						{ ok: false, error: `template "${templateId}" not found` },
						404,
					);

				const baseSlug = displayName
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/(^-|-$)/g, "");
				const existingCount = assistantRepo.countAgentsBySlugPrefix(baseSlug);
				const slug =
					existingCount > 0 ? `${baseSlug}-${existingCount + 1}` : baseSlug;

				const resolved = resolveAutoAdapter(
					tpl.agent ?? "auto",
					tpl.model ?? null,
					cid,
				);
				const initialStatus =
					resolved.adapter === null ? "awaiting_key" : "idle";

				const row = assistantRepo.insertAgent({
					slug,
					displayName,
					modelId: resolved.model,
					systemPrompt: tpl.system_prompt ?? null,
					adapterType: resolved.adapter ?? "auto",
					skills: tpl.tools ?? null,
					status: initialStatus,
					companyId: cid,
				});
				emit("agent:created", { agent: row });
				const rowObj = row as { id?: string; slug?: string };
				await logActivity(
					c,
					"assistant.tool.hire_agent",
					"agent",
					rowObj.id ?? slug,
					{
						slug: rowObj.slug ?? slug,
						companyId: cid,
					},
				);
				return c.json({ ok: true, agent: row });
			}

			case "pause_agent":
			case "resume_agent": {
				const slug = String(body["slug"] ?? "");
				if (!slug) return c.json({ ok: false, error: "slug is required" }, 400);
				const newStatus = tool === "pause_agent" ? "paused" : "idle";
				const reason =
					tool === "pause_agent"
						? String(body["reason"] ?? "user_paused")
						: null;
				const changes = assistantRepo.updateAgentStatus(
					slug,
					newStatus,
					reason,
					cid,
				);
				if (changes === 0)
					return c.json({ ok: false, error: `agent "${slug}" not found` }, 404);
				emit("agent:status_changed", {
					slug,
					status: newStatus,
					reason,
					companyId: cid,
				});
				await logActivity(c, `assistant.tool.${tool}`, "agent", slug, {
					status: newStatus,
					companyId: cid,
				});
				return c.json({ ok: true, slug, status: newStatus });
			}

			case "set_agent_mode": {
				const slug = String(body["slug"] ?? "");
				const mode = String(body["mode"] ?? "");
				if (
					!slug ||
					!["write", "read_only", "plan", "conversation"].includes(mode)
				) {
					return c.json(
						{
							ok: false,
							error:
								"slug and valid mode (write|read_only|plan|conversation) required",
						},
						400,
					);
				}
				const changes = assistantRepo.updateAgentMode(slug, mode, cid);
				if (changes === 0)
					return c.json({ ok: false, error: `agent "${slug}" not found` }, 404);
				emit("agent:mode_changed", { slug, mode, companyId: cid });
				await logActivity(c, "assistant.tool.set_agent_mode", "agent", slug, {
					mode,
					companyId: cid,
				});
				return c.json({ ok: true, slug, mode });
			}

			case "set_agent_adapter": {
				const slug = String(body["slug"] ?? "");
				const adapter = String(body["adapter"] ?? "");
				if (!slug || !adapter)
					return c.json({ ok: false, error: "slug and adapter required" }, 400);
				const changes = assistantRepo.updateAgentAdapter(slug, adapter, cid);
				if (changes === 0)
					return c.json({ ok: false, error: `agent "${slug}" not found` }, 404);
				await logActivity(
					c,
					"assistant.tool.set_agent_adapter",
					"agent",
					slug,
					{
						adapter,
						companyId: cid,
					},
				);
				return c.json({ ok: true, slug, adapter });
			}

			case "set_agent_model": {
				const slug = String(body["slug"] ?? "");
				const model = String(body["model"] ?? "");
				if (!slug || !model)
					return c.json({ ok: false, error: "slug and model required" }, 400);
				const changes = assistantRepo.updateAgentModel(slug, model, cid);
				if (changes === 0)
					return c.json({ ok: false, error: `agent "${slug}" not found` }, 404);
				await logActivity(c, "assistant.tool.set_agent_model", "agent", slug, {
					model,
					companyId: cid,
				});
				return c.json({ ok: true, slug, model });
			}

			case "run_agent": {
				const slug = String(body["slug"] ?? "");
				const task = String(body["task"] ?? "").trim();
				if (!slug || !task)
					return c.json(
						{ ok: false, error: "slug and task are required" },
						400,
					);
				const ag = assistantRepo.getAgentBySlugScoped(slug, cid);
				if (!ag)
					return c.json({ ok: false, error: `agent "${slug}" not found` }, 404);
				if (ag.status === "awaiting_key")
					return c.json(
						{ ok: false, error: "agent is awaiting an API key" },
						422,
					);
				if (ag.status === "paused")
					return c.json({ ok: false, error: "agent is paused" }, 422);

				const BOARD_PROJECT_ID = "00000000000000000000000000000001";
				const boardPlotId = `bp${ag.id.replace(/-/g, "")}`.slice(0, 32);
				const now = new Date().toISOString();
				assistantRepo.ensureBoardProject(BOARD_PROJECT_ID, now);
				assistantRepo.ensureBoardPlot(boardPlotId, BOARD_PROJECT_ID, slug, now);

				const runId = crypto.randomUUID();
				assistantRepo.insertRun(runId, boardPlotId, slug, ag.model_id, now);
				assistantRepo.insertChunk(runId, task, now);
				emit("run:updated", { runId, agentId: slug, status: "pending" });
				void spawnServerRun({
					runId,
					agentSlug: slug,
					companyId: cid,
					task,
					issueId: null,
				});
				await logActivity(c, "assistant.tool.run_agent", "run", runId, {
					agentSlug: slug,
					companyId: cid,
				});
				return c.json({ ok: true, runId, agentSlug: slug, started: true });
			}

			case "run_agents_parallel": {
				const task = String(body["task"] ?? "").trim();
				if (!task) return c.json({ ok: false, error: "task is required" }, 400);

				const rawSlugs = Array.isArray(body["slugs"])
					? (body["slugs"] as unknown[]).map((s) => String(s).trim())
					: [];
				const uniqueSlugs = [...new Set(rawSlugs.filter(Boolean))];
				const maxAgents = Math.max(
					1,
					Math.min(12, Number(body["maxAgents"] ?? (uniqueSlugs.length || 3))),
				);

				const roster = assistantRepo.listAgents(cid);
				const runnable = roster.filter(
					(a) =>
						a.is_active === 1 &&
						a.status !== "paused" &&
						a.status !== "awaiting_key",
				);
				const picked = (
					uniqueSlugs.length > 0
						? runnable.filter((a) => uniqueSlugs.includes(a.slug))
						: runnable
				).slice(0, maxAgents);
				if (picked.length === 0) {
					return c.json(
						{
							ok: false,
							error:
								"No runnable agents found. Unpause agents or configure missing keys.",
						},
						422,
					);
				}

				const BOARD_PROJECT_ID = "00000000000000000000000000000001";
				const now = new Date().toISOString();
				assistantRepo.ensureBoardProject(BOARD_PROJECT_ID, now);

				const launched: Array<{ slug: string; runId: string }> = [];
				for (const ag of picked) {
					const boardPlotId = `bp${ag.id.replace(/-/g, "")}`.slice(0, 32);
					const runId = crypto.randomUUID();
					assistantRepo.ensureBoardPlot(
						boardPlotId,
						BOARD_PROJECT_ID,
						ag.slug,
						now,
					);
					assistantRepo.insertRun(
						runId,
						boardPlotId,
						ag.slug,
						ag.model_id,
						now,
					);
					assistantRepo.insertChunk(runId, task, now);
					emit("run:updated", { runId, agentId: ag.slug, status: "pending" });
					void spawnServerRun({
						runId,
						agentSlug: ag.slug,
						companyId: cid,
						task,
						issueId: null,
					});
					launched.push({ slug: ag.slug, runId });
				}
				await logActivity(
					c,
					"assistant.tool.run_agents_parallel",
					"run",
					"batch",
					{
						companyId: cid,
						launchedCount: launched.length,
						agents: launched.map((r) => r.slug),
					},
				);

				return c.json({
					ok: true,
					task,
					started: true,
					launchedCount: launched.length,
					launched,
				});
			}

			case "create_skill": {
				const name = String(body["name"] ?? "").trim();
				const prompt = String(body["prompt"] ?? "").trim();
				if (!name) {
					return c.json({ ok: false, error: "name is required" }, 400);
				}
				if (!prompt) {
					return c.json({ ok: false, error: "prompt is required" }, 400);
				}
				const categoryRaw = String(body["category"] ?? "custom").trim();
				const category = ["code", "web", "security", "data", "custom"].includes(
					categoryRaw,
				)
					? categoryRaw
					: "custom";
				const trigger = String(body["trigger"] ?? "").trim();
				const description = String(body["description"] ?? "").trim();
				const slugInput = String(body["slug"] ?? "").trim();
				const slugBase = (slugInput || name)
					.toLowerCase()
					.replace(/\s+/g, "-")
					.replace(/[^a-z0-9-]/g, "")
					.replace(/-+/g, "-")
					.replace(/(^-|-$)/g, "");
				const row = await skillsRepo.createSkill({
					companyId: cid,
					name,
					slug: slugBase || `skill-${Date.now()}`,
					description: description || null,
					category,
					trigger: trigger || null,
					prompt,
					isActive: true,
				});
				if (!row) {
					return c.json({ ok: false, error: "failed to create skill" }, 500);
				}
				emit("skill:created", {
					skillId: row.id,
					companyId: cid,
					name: row.name,
				});
				await logActivity(c, "assistant.tool.create_skill", "skill", row.id, {
					slug: row.slug,
					companyId: cid,
				});
				return c.json({ ok: true, skill: row });
			}

			case "list_companies": {
				const rows = assistantRepo.listCompaniesBasic();
				return c.json({ ok: true, companies: rows });
			}

			case "get_budget_summary": {
				const periodSpend = assistantRepo.getBudgetPeriodSpend();
				const limit = assistantRepo.getGlobalBudgetLimit();
				return c.json({
					ok: true,
					periodSpendUsd: periodSpend,
					limit: limit ?? null,
				});
			}

			case "set_budget": {
				const limitUsd = Number(body["limitUsd"] ?? 0);
				const periodDays = Number(body["periodDays"] ?? 30);
				const alertPercent = Number(body["alertPercent"] ?? 80);
				assistantRepo.upsertGlobalBudget(limitUsd, periodDays, alertPercent);
				emit("budget:settings_updated", { limitUsd, periodDays, alertPercent });
				await logActivity(c, "assistant.tool.set_budget", "budget", "global", {
					limitUsd,
					periodDays,
					alertPercent,
					companyId: cid,
				});
				return c.json({ ok: true, limitUsd, periodDays, alertPercent });
			}

			default:
				return c.json(
					{
						ok: false,
						error: `Unknown tool "${tool}".`,
						available: [
							"read_settings",
							"set_api_key",
							"list_agents",
							"hire_agent",
							"pause_agent",
							"resume_agent",
							"run_agent",
							"run_agents_parallel",
							"create_skill",
							"list_companies",
							"get_budget_summary",
							"set_budget",
						],
					},
					400,
				);
		}
	},
);

// GET /api/assistant/tools — list available tools (for Assistant prompt + UI)
assistantToolsRoute.get("/tools", (c) =>
	c.json({
		tools: [
			{
				name: "read_settings",
				description: "Read current settings (API keys are masked).",
			},
			{
				name: "set_api_key",
				description: "Save an API key for a provider.",
				params: ["provider", "value"],
			},
			{ name: "list_agents", description: "List all agents in the roster." },
			{
				name: "hire_agent",
				description: "Create a new agent.",
				params: ["templateId", "displayName"],
			},
			{
				name: "pause_agent",
				description: "Pause an agent.",
				params: ["slug", "reason?"],
			},
			{
				name: "resume_agent",
				description: "Resume a paused agent.",
				params: ["slug"],
			},
			{
				name: "run_agent",
				description: "Enqueue a run on an existing agent.",
				params: ["slug", "task"],
			},
			{
				name: "run_agents_parallel",
				description:
					"Launch the same task across multiple agents in parallel (autonomous swarm).",
				params: ["task", "slugs?", "maxAgents?"],
			},
			{
				name: "create_skill",
				description: "Create a new skill for this company.",
				params: ["name", "prompt", "category?", "trigger?", "description?"],
			},
			{ name: "list_companies", description: "List companies." },
			{
				name: "get_budget_summary",
				description: "Get current budget spend + limit.",
			},
			{
				name: "set_budget",
				description: "Update global budget.",
				params: ["limitUsd", "periodDays?", "alertPercent?"],
			},
		],
	}),
);

assistantToolsRoute.get("/tools/audit", (c) => {
	const cid =
		c.req.query("companyId") ??
		c.req.header("x-company-id") ??
		getDefaultCompanyId();
	const limit = Math.max(1, Math.min(200, Number(c.req.query("limit") ?? 50)));
	const rows = getRawDb()
		.prepare(
			`SELECT id, actor, event, entity_type AS entityType, entity_id AS entityId, payload, created_at AS createdAt
         FROM activity_log
        WHERE event LIKE 'assistant.tool.%' AND (company_id = ? OR company_id IS NULL)
        ORDER BY created_at DESC
	       LIMIT ?`,
		)
		.all(cid, limit);
	return c.json({ ok: true, companyId: cid, items: rows });
});
