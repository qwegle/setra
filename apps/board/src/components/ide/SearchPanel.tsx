import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useMemo } from "react";
import { type FileTreeEntry, api } from "../../lib/api";
import { REPLIT } from "./types";

interface SearchPanelProps {
	projectId: string;
	hasWorkspace: boolean;
	query: string;
	onQueryChange: (value: string) => void;
	onOpenFile: (
		path: string,
		target?: { line: number; column?: number },
	) => void;
}

function flattenFiles(nodes: FileTreeEntry[]): FileTreeEntry[] {
	return nodes.flatMap((node) =>
		node.type === "dir" ? flattenFiles(node.children ?? []) : [node],
	);
}

export function SearchPanel({
	projectId,
	hasWorkspace,
	query,
	onQueryChange,
	onOpenFile,
}: SearchPanelProps) {
	const treeQuery = useQuery({
		queryKey: ["files-tree", projectId],
		queryFn: () => api.files.tree(projectId),
		enabled: Boolean(projectId && hasWorkspace),
	});
	const contentSearchQuery = useQuery({
		queryKey: ["file-content-search", projectId, query],
		queryFn: () => api.files.search(projectId, query),
		enabled: Boolean(projectId && hasWorkspace && query.trim()),
		staleTime: 10_000,
	});
	const fileMatches = useMemo(() => {
		const lowered = query.trim().toLowerCase();
		if (!lowered) return [];
		return flattenFiles(treeQuery.data?.tree ?? [])
			.filter(
				(file) =>
					file.path.toLowerCase().includes(lowered) ||
					file.name.toLowerCase().includes(lowered),
			)
			.slice(0, 20);
	}, [query, treeQuery.data]);

	if (!hasWorkspace) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-sm text-[#9DA2A6]">
				Set a workspace path to search files.
			</div>
		);
	}

	return (
		<div
			className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
			style={{ backgroundColor: REPLIT.panelAlt }}
		>
			<div
				className="border-b px-4 py-4"
				style={{ borderColor: REPLIT.border }}
			>
				<div className="relative">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5F6B7A]" />
					<input
						value={query}
						onChange={(event) => onQueryChange(event.target.value)}
						placeholder="Search file contents (grep)..."
						className="h-10 w-full rounded-md border bg-[#0E1525] pl-9 pr-3 text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
				</div>
			</div>

			<div className="grid min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
				<section
					className="rounded-lg border"
					style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
				>
					<div
						className="border-b px-3 py-2"
						style={{ borderColor: REPLIT.border }}
					>
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							Matching files
						</p>
					</div>
					<div className="space-y-2 p-3">
						{query.trim() ? (
							fileMatches.map((file) => (
								<button
									key={file.path}
									type="button"
									onClick={() => onOpenFile(file.path)}
									className="block w-full rounded-md border px-3 py-2 text-left text-xs text-white hover:bg-[#0E1525]"
									style={{
										borderColor: REPLIT.border,
										backgroundColor: REPLIT.background,
									}}
								>
									<span className="truncate font-mono">{file.path}</span>
								</button>
							))
						) : (
							<p className="text-sm text-[#9DA2A6]">
								Start typing to search filenames.
							</p>
						)}
						{query.trim() && fileMatches.length === 0 ? (
							<p className="text-sm text-[#9DA2A6]">No filename matches.</p>
						) : null}
					</div>
				</section>

				<section
					className="rounded-lg border"
					style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
				>
					<div
						className="border-b px-3 py-2"
						style={{ borderColor: REPLIT.border }}
					>
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							Content results
						</p>
					</div>
					<div className="space-y-3 p-3">
						{contentSearchQuery.isPending ? (
							<div className="flex items-center gap-2 text-sm text-[#9DA2A6]">
								<Loader2 className="h-4 w-4 animate-spin" /> Searching…
							</div>
						) : null}
						{!query.trim() ? (
							<p className="text-sm text-[#9DA2A6]">
								Search across your project using the file search API.
							</p>
						) : null}
						{contentSearchQuery.data?.results.map((result) => (
							<div
								key={result.path}
								className="rounded-md border"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								<button
									type="button"
									onClick={() => onOpenFile(result.path)}
									className="w-full border-b px-3 py-2 text-left font-mono text-xs text-[#82AAFF]"
									style={{ borderColor: REPLIT.border }}
								>
									{result.path}
								</button>
								<div className="space-y-2 p-3">
									{result.matches.map((match, index) => (
										<button
											key={`${result.path}-${match.line}-${match.column}-${index}`}
											type="button"
											onClick={() =>
												onOpenFile(result.path, {
													line: match.line,
													column: match.column,
												})
											}
											className="block w-full rounded-md border px-3 py-2 text-left hover:bg-white/5"
											style={{ borderColor: REPLIT.border }}
										>
											<div className="mb-1 text-[11px] font-mono text-[#5F6B7A]">
												Ln {match.line}, Col {match.column}
											</div>
											<pre className="whitespace-pre-wrap font-mono text-xs text-[#F5F9FC]">
												{match.preview}
											</pre>
										</button>
									))}
								</div>
							</div>
						))}
						{query.trim() &&
						!contentSearchQuery.isPending &&
						(contentSearchQuery.data?.results.length ?? 0) === 0 ? (
							<p className="text-sm text-[#9DA2A6]">
								No content matches found.
							</p>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
