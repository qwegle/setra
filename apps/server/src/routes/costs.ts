import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import { getCompanySettings } from "../lib/company-settings.js";
import * as agentsRepo from "../repositories/agents.repo.js";
import * as budgetRepo from "../repositories/budget.repo.js";
import * as costsRepo from "../repositories/costs.repo.js";
import { UpdateAgentBudgetSchema } from "../validators/costs.validators.js";

export const costsRoute = new Hono();

costsRoute.get("/summary", async (c) => {
	const cid = getCompanyId(c);
	const now = new Date();
	const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
	const daysInMonth = new Date(
		now.getFullYear(),
		now.getMonth() + 1,
		0,
	).getDate();
	const dayOfMonth = now.getDate();

	const mtdRuns = await costsRepo.getMtdRuns(mtdStart, cid);
	const totalMtdUsd = mtdRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);

	const dailyMap = new Map<string, number>();
	for (const r of mtdRuns) {
		const date = r.startedAt.slice(0, 10);
		dailyMap.set(date, (dailyMap.get(date) ?? 0) + (r.costUsd ?? 0));
	}
	const dailySeries = Array.from(dailyMap.entries())
		.map(([date, costUsd]) => ({ date, costUsd }))
		.sort((a, b) => a.date.localeCompare(b.date));

	const byAgent = (await costsRepo.getAgentCostsMtd(mtdStart, cid)).map(
		(r) => ({
			agentId: r.agent,
			agentSlug: r.agent,
			agentName: r.agent,
			tasks: Number(r.runCount ?? 0),
			tokens: Number(r.promptTokens ?? 0) + Number(r.completionTokens ?? 0),
			costUsd: Number(r.totalCostUsd ?? 0),
		}),
	);

	const byProject = (await costsRepo.getProjectCostsMtd(mtdStart, cid)).map(
		(r) => ({
			projectId: r.projectId,
			projectName: r.projectName,
			tasks: Number(r.runCount ?? 0),
			tokens: Number(r.promptTokens ?? 0) + Number(r.completionTokens ?? 0),
			costUsd: Number(r.totalCostUsd ?? 0),
		}),
	);

	const budgetRows = await costsRepo.getBudgetLimits(cid);
	const globalBudget = await budgetRepo.getGlobalBudgetSettings(cid);
	const budgetMonthlyUsd =
		budgetRows.reduce((sum, r) => sum + (r.limitUsd ?? 0), 0) +
		(globalBudget.limitUsd ?? 0);

	const projectedMonthEndUsd =
		dayOfMonth > 0 ? (totalMtdUsd / dayOfMonth) * daysInMonth : 0;
	const costPerTaskUsd = mtdRuns.length > 0 ? totalMtdUsd / mtdRuns.length : 0;

	return c.json({
		totalMtdUsd,
		budgetMonthlyUsd,
		projectedMonthEndUsd,
		costPerTaskUsd,
		dailySeries,
		byAgent,
		byProject,
	});
});

costsRoute.get("/budgets", async (c) => {
	const cid = getCompanyId(c);
	const rows = await costsRepo.getBudgetLimits(cid);
	const enriched = await Promise.all(
		rows.map(async (r) => {
			const days = r.periodDays ?? 30;
			const start = new Date();
			start.setDate(start.getDate() - days);
			const usedUsd = r.agentSlug
				? await costsRepo.getAgentUsedUsd(r.agentSlug, start, cid)
				: await costsRepo.getTotalUsedUsd(start, cid);
			return {
				...r,
				agentId: r.agentId ?? r.id,
				usedUsd,
			};
		}),
	);
	return c.json(enriched);
});

costsRoute.put(
	"/budgets/:agentId",
	zValidator("json", UpdateAgentBudgetSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const agentId = c.req.param("agentId");
		const body = c.req.valid("json");

		const payload: {
			limitUsd?: number;
			periodDays?: number;
			alertPercent?: number;
		} = {};
		if (body.limitUsd !== undefined) payload.limitUsd = body.limitUsd;
		if (body.periodDays !== undefined) payload.periodDays = body.periodDays;
		if (body.alertPercent !== undefined)
			payload.alertPercent = body.alertPercent;

		if (agentId === "global") {
			await budgetRepo.updateGlobalBudgetSettings(cid, payload);
			return c.json({ ok: true });
		}

		const agent = await agentsRepo.getAgentSlugByIdScoped(agentId, cid);
		if (!agent?.slug) {
			return c.json({ error: "agent not found" }, 404);
		}

		const existing = await costsRepo.getExistingBudgetByAgent(agent.slug, cid);
		if (existing) {
			const updated = await costsRepo.updateAgentBudget(
				agent.slug,
				cid,
				payload,
			);
			return c.json(updated);
		}

		const created = await costsRepo.createAgentBudget(agent.slug, cid, payload);
		return c.json(created, 201);
	},
);

costsRoute.get("/providers", async (c) => {
	const cid = getCompanyId(c);
	const settings = getCompanySettings(cid);

	const baseProviders = [
		{
			id: "anthropic",
			name: "Anthropic",
			models: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-3-5"],
			settingKey: "anthropic_api_key",
		},
		{
			id: "openai",
			name: "OpenAI",
			models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
			settingKey: "openai_api_key",
		},
		{
			id: "gemini",
			name: "Google",
			models: ["gemini-2-5-pro", "gemini-2-5-flash"],
			settingKey: "gemini_api_key",
		},
		{ id: "ollama", name: "Ollama", models: [], settingKey: "ollama_url" },
		{
			id: "openrouter",
			name: "OpenRouter",
			models: [],
			settingKey: "openrouter_api_key",
		},
	];

	const now = new Date();
	const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
	const spendRows = costsRepo.getModelSpendMtd(mtdStart, cid);

	function inferProvider(model: string | null): string {
		if (!model) return "unknown";
		const m = model.toLowerCase();
		if (m.includes("claude")) return "anthropic";
		if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3"))
			return "openai";
		if (m.includes("gemini")) return "gemini";
		if (m.includes("/")) return "openrouter";
		if (m.includes("llama") || m.includes("mistral")) return "ollama";
		return "unknown";
	}

	const spendByProvider: Record<string, number> = {};
	for (const r of spendRows) {
		const p = inferProvider(r.model);
		spendByProvider[p] = (spendByProvider[p] ?? 0) + Number(r.cost ?? 0);
	}

	function readKey(key: string): string | null {
		const value = settings[key];
		if (typeof value !== "string") return null;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	const providers = baseProviders.map((p) => {
		const val = readKey(p.settingKey);
		const isConfigured = !!val && val.length > 4;
		const keyHint = isConfigured && val ? `••••${val.slice(-4)}` : null;
		return {
			...p,
			isConfigured,
			keyHint,
			status: isConfigured ? "ok" : "unconfigured",
			spendMtdUsd: spendByProvider[p.id] ?? 0,
		};
	});
	return c.json(providers);
});
