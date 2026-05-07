import { BaseNode, type PipelineState } from "../base-node.js";

interface FetchNodeRuntimeConfig {
	urlKey: string;
	outputKey: string;
	format: "markdown" | "html" | "text" | "json";
}

/**
 * Fetches remote content and normalizes it into a requested format.
 */
export class FetchNode extends BaseNode {
	async execute(state: PipelineState): Promise<PipelineState> {
		const urlKey = this.getRequiredConfig("urlKey");
		const outputKey = this.getRequiredConfig("outputKey");
		const format = this.getRequiredConfig("format");
		const url = state[urlKey];

		if (typeof url !== "string" || url.length === 0) {
			throw new Error(
				`FetchNode expected state.${urlKey} to contain a URL string.`,
			);
		}

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`FetchNode request failed with status ${response.status} for ${url}.`,
			);
		}

		const contentType = response.headers.get("content-type") ?? "";
		const rawText = await response.text();
		const normalized = normalizeContent(rawText, contentType, format);
		this.setExecutionMetrics({});

		return {
			...state,
			[outputKey]: normalized,
		};
	}

	private getRequiredConfig<K extends keyof FetchNodeRuntimeConfig>(
		key: K,
	): NonNullable<FetchNodeRuntimeConfig[K]> {
		const value = this.getConfigValue<FetchNodeRuntimeConfig[K]>(key);
		if (value === undefined || value === null) {
			throw new Error(`Missing required FetchNode config: ${String(key)}.`);
		}
		return value as NonNullable<FetchNodeRuntimeConfig[K]>;
	}
}

function normalizeContent(
	rawText: string,
	contentType: string,
	format: FetchNodeRuntimeConfig["format"],
): unknown {
	if (format === "html") {
		return rawText;
	}

	if (format === "json") {
		return JSON.parse(rawText);
	}

	const isHtml = /html/i.test(contentType) || /<html[\s>]/i.test(rawText);
	if (format === "markdown") {
		return isHtml ? htmlToMarkdown(rawText) : rawText;
	}

	if (format === "text") {
		return isHtml ? htmlToText(rawText) : rawText;
	}

	return rawText;
}

function htmlToMarkdown(html: string): string {
	return cleanupText(
		decodeEntities(
			html
				.replace(/<script[\s\S]*?<\/script>/gi, "")
				.replace(/<style[\s\S]*?<\/style>/gi, "")
				.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
				.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
				.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n")
				.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
				.replace(
					/<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/a>/gi,
					"[$2]($1)",
				)
				.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
				.replace(/<br\s*\/?\s*>/gi, "\n")
				.replace(/<[^>]+>/g, " "),
		),
	);
}

function htmlToText(html: string): string {
	return cleanupText(
		decodeEntities(
			html
				.replace(/<script[\s\S]*?<\/script>/gi, "")
				.replace(/<style[\s\S]*?<\/style>/gi, "")
				.replace(/<br\s*\/?\s*>/gi, "\n")
				.replace(/<[^>]+>/g, " "),
		),
	);
}

function decodeEntities(input: string): string {
	return input
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");
}

function cleanupText(input: string): string {
	return input
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}
