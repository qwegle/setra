/**
 * web-search.ts — IPC handler for web search from renderer/agents.
 * Supports Tavily and Brave Search APIs.
 * API keys are read from process.env (loaded by settings IPC at startup).
 */

import { ipcMain } from "electron";

interface SearchResult {
	title: string;
	url: string;
	content: string;
	score?: number;
}

interface SearchResponse {
	query: string;
	results: SearchResult[];
	provider: string;
}

async function searchTavily(
	query: string,
	maxResults = 5,
): Promise<SearchResponse> {
	const apiKey = process.env["TAVILY_API_KEY"];
	if (!apiKey) throw new Error("TAVILY_API_KEY not set");

	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			max_results: maxResults,
			search_depth: "basic",
			include_answer: true,
		}),
	});
	if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
	const data = (await res.json()) as {
		results?: Array<{
			title: string;
			url: string;
			content: string;
			score?: number;
		}>;
	};
	return {
		query,
		provider: "tavily",
		results: (data.results ?? []).map((r) => ({
			title: r.title,
			url: r.url,
			content: r.content,
			...(r.score !== undefined ? { score: r.score } : {}),
		})),
	};
}

async function searchBrave(
	query: string,
	maxResults = 5,
): Promise<SearchResponse> {
	const apiKey = process.env["BRAVE_SEARCH_API_KEY"];
	if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not set");

	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(maxResults));

	const res = await fetch(url.toString(), {
		headers: {
			Accept: "application/json",
			"Accept-Encoding": "gzip",
			"X-Subscription-Token": apiKey,
		},
	});
	if (!res.ok) throw new Error(`Brave Search error: ${res.status}`);
	const data = (await res.json()) as {
		web?: {
			results?: Array<{ title: string; url: string; description: string }>;
		};
	};
	return {
		query,
		provider: "brave",
		results: (data.web?.results ?? []).map((r) => ({
			title: r.title,
			url: r.url,
			content: r.description,
		})),
	};
}

export function registerWebSearchHandlers(): void {
	ipcMain.handle(
		"web-search:search",
		async (_e, query: string, maxResults?: number) => {
			const provider = process.env["WEB_SEARCH_PROVIDER"] ?? "none";
			if (provider === "tavily") return searchTavily(query, maxResults);
			if (provider === "brave") return searchBrave(query, maxResults);
			throw new Error(
				"No web search provider configured. Enable one in Settings → Web Search.",
			);
		},
	);

	ipcMain.handle("web-search:provider", async () => {
		return process.env["WEB_SEARCH_PROVIDER"] ?? "none";
	});
}
