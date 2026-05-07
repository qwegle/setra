import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, Search } from "lucide-react";
import { useRef, useState } from "react";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	Input,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { type SearchResult, api } from "../lib/api";

const providerLabel: Record<string, string> = {
	tavily: "Tavily",
	brave: "Brave Search",
	serper: "Serper (Google)",
	duckduckgo: "DuckDuckGo (free)",
};

export function SearchPage() {
	const [input, setInput] = useState("");
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const { data: providerData } = useQuery({
		queryKey: ["search-provider"],
		queryFn: () => api.search.provider(),
		staleTime: 60_000,
	});

	const { data, isLoading, isError, error } = useQuery({
		queryKey: ["search", query],
		queryFn: () => api.search.query(query),
		enabled: !!query && query.length > 2,
		staleTime: 30_000,
	});

	function submit() {
		const q = input.trim();
		if (q.length > 2) setQuery(q);
	}

	return (
		<div className="mx-auto w-full max-w-4xl space-y-6">
			<PageHeader
				title="Web Search"
				subtitle="Search the web from within setra and inject results into agent context."
				actions={
					providerData ? (
						<Badge variant="info">
							Using{" "}
							{providerLabel[providerData.provider] ?? providerData.provider}
						</Badge>
					) : null
				}
			/>

			<Card>
				<div className="flex flex-col gap-3 md:flex-row">
					<Input
						ref={inputRef}
						label="Search query"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && submit()}
						placeholder="Search anything…"
						className="md:text-base"
					/>
					<div className="flex items-end">
						<Button
							type="button"
							onClick={submit}
							disabled={input.trim().length <= 2}
							icon={<Search className="h-4 w-4" aria-hidden="true" />}
							className="w-full md:w-auto"
						>
							Search
						</Button>
					</div>
				</div>
				{providerData ? (
					<div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground/70">
						<Globe className="h-4 w-4" aria-hidden="true" />
						<span>
							Results powered by{" "}
							{providerLabel[providerData.provider] ?? providerData.provider}
						</span>
						{!providerData.hasKey ? (
							<Badge>Add a search API key in Settings for better results</Badge>
						) : null}
					</div>
				) : null}
			</Card>

			{!query && (
				<EmptyState
					icon={<Search className="h-10 w-10" aria-hidden="true" />}
					title="Enter a search query"
					description="Search results will appear here once you run a query."
				/>
			)}

			{query && isLoading && (
				<Card>
					<div className="space-y-4">
						<Skeleton variant="rect" height="90px" />
						<Skeleton variant="rect" height="90px" />
						<Skeleton variant="rect" height="90px" />
					</div>
				</Card>
			)}

			{query && isError && (
				<Card>
					<p className="text-sm text-red-400">
						Search failed:{" "}
						{error instanceof Error ? error.message : "Unknown error"}
					</p>
				</Card>
			)}

			{query && !isLoading && !isError && data && data.results.length === 0 && (
				<EmptyState
					icon={<Search className="h-10 w-10" aria-hidden="true" />}
					title={`No results for “${query}”`}
					description="Try a broader query or add a search provider API key for richer results."
				/>
			)}

			{data && data.results.length > 0 && (
				<div className="space-y-3">
					<p className="text-xs text-muted-foreground/50">
						{data.results.length} result{data.results.length !== 1 ? "s" : ""}{" "}
						via {providerLabel[data.provider] ?? data.provider}
					</p>
					{data.results.map((result: SearchResult, index: number) => (
						<Card
							key={`${result.url}-${index}`}
							className="transition-colors hover:border-setra-600/30"
						>
							<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
								<div className="min-w-0 flex-1 space-y-1.5">
									<a
										href={result.url}
										target="_blank"
										rel="noreferrer"
										className="line-clamp-2 text-sm font-medium text-setra-300 transition-colors hover:text-setra-200 md:text-base"
									>
										{result.title}
									</a>
									<p className="truncate text-xs text-muted-foreground/50">
										{result.url}
									</p>
									{result.snippet ? (
										<p className="line-clamp-3 text-sm text-muted-foreground/80">
											{result.snippet}
										</p>
									) : null}
								</div>
								<div className="flex items-center gap-2 self-start md:flex-col md:items-end">
									<a
										href={result.url}
										target="_blank"
										rel="noreferrer"
										className="text-muted-foreground/40 transition-colors hover:text-muted-foreground"
										aria-label="Open result in new tab"
									>
										<ExternalLink className="h-4 w-4" />
									</a>
									{result.score !== undefined ? (
										<Badge
											variant={result.score >= 0.7 ? "success" : "default"}
										>
											{(result.score * 100).toFixed(0)}%
										</Badge>
									) : null}
								</div>
							</div>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
