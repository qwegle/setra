const SETRA_API_URL = process.env.SETRA_API_URL ?? "http://localhost:3141";

export async function webSearch(
	query: string,
	maxResults = 5,
): Promise<string> {
	try {
		const res = await fetch(`${SETRA_API_URL}/api/search`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, maxResults }),
		});
		if (!res.ok) return `Search failed: ${res.status}`;
		const data = (await res.json()) as {
			results: Array<{ title: string; url: string; snippet: string }>;
			provider: string;
		};
		if (!data.results.length) return "No results found.";
		return [
			`Web search results for "${query}" via ${data.provider}:`,
			"",
			...data.results.map(
				(r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`,
			),
		].join("\n");
	} catch (e) {
		return `Search error: ${e instanceof Error ? e.message : String(e)}`;
	}
}
