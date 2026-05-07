/**
 * wiki-tools.ts — MCP tool definitions and executor for the team wiki
 */

import type { McpToolDefinition } from "./db-tools.js";

export const WIKI_TOOLS: McpToolDefinition[] = [
	{
		name: "wiki_read",
		description:
			"Read a wiki article by slug. Returns content, metadata, and backlinks.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "Article slug, e.g. 'decisions/use-sqlite'",
				},
			},
			required: ["slug"],
		},
	},
	{
		name: "wiki_write",
		description:
			"Create or update a wiki article. slug uses path/format like 'decisions/use-postgres'. Content must start with # Title.",
		inputSchema: {
			type: "object",
			properties: {
				slug: {
					type: "string",
					description: "Article slug, e.g. 'decisions/use-postgres'",
				},
				content: {
					type: "string",
					description: "Full markdown content. Must start with # Title.",
				},
			},
			required: ["slug", "content"],
		},
	},
	{
		name: "wiki_list",
		description:
			"List all wiki articles, optionally filtered by section (people, projects, decisions, runbooks, leads).",
		inputSchema: {
			type: "object",
			properties: {
				section: {
					type: "string",
					description:
						"Optional section filter: people, projects, decisions, runbooks, or leads",
				},
			},
		},
	},
	{
		name: "wiki_search",
		description:
			"Search wiki articles by keyword. Returns matching slugs with excerpt.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search keyword or phrase" },
			},
			required: ["query"],
		},
	},
	{
		name: "wiki_toc",
		description: "Get the full table of contents for the team wiki.",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
];

export async function executeWikiTool(
	toolName: string,
	params: Record<string, string>,
	companySlug: string,
	agentSlug: string,
): Promise<string> {
	const {
		readArticle,
		writeArticle,
		listArticles,
		searchArticles,
		buildTableOfContents,
	} = await import("@setra/core/wiki.js");

	switch (toolName) {
		case "wiki_read": {
			const slug = params["slug"];
			if (!slug) return JSON.stringify({ error: "slug is required" });
			const article = await readArticle(companySlug, slug);
			if (!article)
				return JSON.stringify({ error: `Article not found: ${slug}` });
			return JSON.stringify(article);
		}

		case "wiki_write": {
			const slug = params["slug"];
			const content = params["content"];
			if (!slug || !content)
				return JSON.stringify({ error: "slug and content are required" });
			const result = await writeArticle(companySlug, slug, content, agentSlug);
			return JSON.stringify(result);
		}

		case "wiki_list": {
			const section = params["section"] || undefined;
			const articles = await listArticles(companySlug, section);
			return JSON.stringify(articles);
		}

		case "wiki_search": {
			const query = params["query"];
			if (!query) return JSON.stringify({ error: "query is required" });
			const results = await searchArticles(companySlug, query);
			return JSON.stringify(results);
		}

		case "wiki_toc": {
			const toc = await buildTableOfContents(companySlug);
			return JSON.stringify({ toc });
		}

		default:
			return JSON.stringify({ error: `Unknown wiki tool: ${toolName}` });
	}
}
