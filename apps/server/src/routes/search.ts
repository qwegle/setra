import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	type SearchResult,
	activeSearchProvider,
	isWebSearchEnabled,
	performWebSearch,
} from "../lib/web-search.js";
import { SearchSchema } from "../validators/search.validators.js";

const app = new Hono();

export interface SearchResponse {
	query: string;
	provider: string;
	results: SearchResult[];
}

// POST /api/search
app.post("/", zValidator("json", SearchSchema), async (c) => {
	const body = c.req.valid("json");
	const query = (body.query ?? "").trim();
	if (!query) return c.json({ error: "query required" }, 400);
	const maxResults = Math.min(Number(body.maxResults ?? 8), 20);
	const companyId = c.req.header("x-company-id") ?? null;
	const { provider, results } = await performWebSearch(query, {
		companyId,
		maxResults,
	});
	const response: SearchResponse = { query, provider, results };
	return c.json(response);
});

// GET /api/search/provider
app.get("/provider", (c) => {
	const companyId = c.req.header("x-company-id") ?? null;
	const provider = activeSearchProvider(companyId);
	const hasKey = provider !== "duckduckgo";
	const enabled = isWebSearchEnabled(companyId);
	return c.json({ provider, hasKey, enabled });
});

export default app;
