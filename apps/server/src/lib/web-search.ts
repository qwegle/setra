import * as settingsRepo from "../repositories/settings.repo.js";
import { getCompanySettings } from "./company-settings.js";

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	score?: number;
}

export type SearchProvider = "tavily" | "brave" | "serper" | "duckduckgo";

function readConfiguredKey(
	settings: Record<string, unknown>,
	settingKey: "tavily_api_key" | "brave_api_key" | "serper_api_key",
	envKey: "TAVILY_API_KEY" | "BRAVE_SEARCH_API_KEY" | "SERPER_API_KEY",
): string | undefined {
	const configured = settings[settingKey];
	if (typeof configured === "string" && configured.trim().length > 0) {
		return configured.trim();
	}
	const envValue = process.env[envKey]?.trim();
	return envValue ? envValue : undefined;
}

function getSearchKeys(companyId: string | null | undefined): {
	tavily?: string | undefined;
	brave?: string | undefined;
	serper?: string | undefined;
} {
	const settings = getCompanySettings(companyId);
	return {
		tavily: readConfiguredKey(settings, "tavily_api_key", "TAVILY_API_KEY"),
		brave: readConfiguredKey(settings, "brave_api_key", "BRAVE_SEARCH_API_KEY"),
		serper: readConfiguredKey(settings, "serper_api_key", "SERPER_API_KEY"),
	};
}

export function isWebSearchEnabled(
	companyId: string | null | undefined,
): boolean {
	if (settingsRepo.isCompanyOfflineOnly(companyId)) return false;
	const settings = getCompanySettings(companyId);
	return settings["web_search_enabled"] !== false;
}

export function activeSearchProvider(
	companyId: string | null | undefined,
): SearchProvider {
	const keys = getSearchKeys(companyId);
	if (keys.tavily) return "tavily";
	if (keys.brave) return "brave";
	if (keys.serper) return "serper";
	return "duckduckgo";
}

async function searchTavily(
	query: string,
	apiKey: string,
	maxResults: number,
): Promise<SearchResult[]> {
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
	if (!res.ok) throw new Error(`Tavily ${res.status}`);
	const data = (await res.json()) as {
		results?: Array<{
			title: string;
			url: string;
			content: string;
			score?: number;
		}>;
	};
	return (data.results ?? []).map((result) => {
		const item: SearchResult = {
			title: result.title,
			url: result.url,
			snippet: result.content,
		};
		if (result.score !== undefined) item.score = result.score;
		return item;
	});
}

async function searchBrave(
	query: string,
	apiKey: string,
	maxResults: number,
): Promise<SearchResult[]> {
	const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
	const res = await fetch(url, {
		headers: {
			Accept: "application/json",
			"X-Subscription-Token": apiKey,
		},
	});
	if (!res.ok) throw new Error(`Brave ${res.status}`);
	const data = (await res.json()) as {
		web?: {
			results?: Array<{ title: string; url: string; description: string }>;
		};
	};
	return (data.web?.results ?? []).map((result) => ({
		title: result.title,
		url: result.url,
		snippet: result.description,
	}));
}

async function searchSerper(
	query: string,
	apiKey: string,
	maxResults: number,
): Promise<SearchResult[]> {
	const res = await fetch("https://google.serper.dev/search", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-API-KEY": apiKey,
		},
		body: JSON.stringify({ q: query, num: maxResults }),
	});
	if (!res.ok) throw new Error(`Serper ${res.status}`);
	const data = (await res.json()) as {
		organic?: Array<{ title: string; link: string; snippet: string }>;
	};
	return (data.organic ?? []).map((result) => ({
		title: result.title,
		url: result.link,
		snippet: result.snippet,
	}));
}

async function searchDuckDuckGo(
	query: string,
	maxResults: number,
): Promise<SearchResult[]> {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
	const res = await fetch(url, {
		headers: {
			"Accept-Language": "en-US,en;q=0.9",
			"User-Agent": "Mozilla/5.0 (compatible; setra/1.0)",
		},
		redirect: "follow",
	});
	if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
	const html = await res.text();

	const results: SearchResult[] = [];
	const blockRe =
		/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
	const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

	const titles: Array<{ title: string; rawHref: string }> = [];
	let match: RegExpExecArray | null;
	while ((match = blockRe.exec(html)) !== null) {
		const rawHref = match[1] ?? "";
		const rawTitle = (match[2] ?? "").replace(/<[^>]+>/g, "").trim();
		titles.push({ title: rawTitle, rawHref });
	}

	const snippets: string[] = [];
	while ((match = snippetRe.exec(html)) !== null) {
		snippets.push((match[1] ?? "").replace(/<[^>]+>/g, "").trim());
	}

	for (let index = 0; index < Math.min(titles.length, maxResults); index++) {
		const titleEntry = titles[index];
		if (!titleEntry) continue;
		const { title, rawHref } = titleEntry;
		const snippet = snippets[index] ?? "";

		let urlResult = rawHref;
		try {
			const wrapped = new URL(`https://duckduckgo.com${rawHref}`);
			const uddg = wrapped.searchParams.get("uddg");
			if (uddg) urlResult = decodeURIComponent(uddg);
		} catch {
			// Keep original URL when it cannot be decoded.
		}

		if (!urlResult || !title) continue;
		results.push({ title, url: urlResult, snippet });
	}

	return results;
}

export async function performWebSearch(
	query: string,
	options: {
		companyId?: string | null;
		maxResults?: number;
	} = {},
): Promise<{ provider: SearchProvider; results: SearchResult[] }> {
	const companyId = options.companyId ?? null;
	const trimmedQuery = query.trim();
	const maxResults = Math.min(Math.max(Number(options.maxResults ?? 8), 1), 20);
	const provider = activeSearchProvider(companyId);
	if (!trimmedQuery || !isWebSearchEnabled(companyId)) {
		return { provider, results: [] };
	}

	const keys = getSearchKeys(companyId);
	let results: SearchResult[] = [];

	try {
		if (provider === "tavily" && keys.tavily) {
			results = await searchTavily(trimmedQuery, keys.tavily, maxResults);
		} else if (provider === "brave" && keys.brave) {
			results = await searchBrave(trimmedQuery, keys.brave, maxResults);
		} else if (provider === "serper" && keys.serper) {
			results = await searchSerper(trimmedQuery, keys.serper, maxResults);
		} else {
			results = await searchDuckDuckGo(trimmedQuery, maxResults);
		}
	} catch {
		if (provider !== "duckduckgo") {
			try {
				results = await searchDuckDuckGo(trimmedQuery, maxResults);
			} catch {
				results = [];
			}
		}
	}

	return { provider, results };
}

export async function webSearch(
	query: string,
	options: {
		companyId?: string | null;
		maxResults?: number;
	} = {},
): Promise<SearchResult[]> {
	const response = await performWebSearch(query, options);
	return response.results;
}
