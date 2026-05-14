import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type FileTreeEntry, api } from "../../lib/api";
import { REPLIT, parsePackageSummary } from "./types";

interface PackagesPanelProps {
	projectId: string;
	hasWorkspace: boolean;
	onOpenFile: (path: string) => void;
	onRunScript: (script: string) => void;
}

export function PackagesPanel({
	projectId,
	hasWorkspace,
	onOpenFile,
	onRunScript,
}: PackagesPanelProps) {
	const treeQuery = useQuery({
		queryKey: ["files-tree", projectId],
		queryFn: () => api.files.tree(projectId),
		enabled: Boolean(projectId && hasWorkspace),
	});
	const packageJsonPath = useMemo(() => {
		const walk = (nodes: FileTreeEntry[] | undefined): string | null => {
			for (const node of nodes ?? []) {
				if (node.type === "file" && node.name === "package.json")
					return node.path;
				if (node.type === "dir") {
					const nested = walk(node.children ?? []);
					if (nested) return nested;
				}
			}
			return null;
		};
		return treeQuery.data ? walk(treeQuery.data.tree) : null;
	}, [treeQuery.data]);
	const packageJsonQuery = useQuery({
		queryKey: ["package-json", projectId, packageJsonPath],
		queryFn: () => api.files.content(projectId, packageJsonPath!),
		enabled: Boolean(projectId && packageJsonPath && hasWorkspace),
	});
	const summary = useMemo(
		() => parsePackageSummary(packageJsonQuery.data?.content ?? null),
		[packageJsonQuery.data?.content],
	);

	if (!hasWorkspace) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-sm text-[#9DA2A6]">
				Set a workspace path to inspect packages.
			</div>
		);
	}

	return (
		<div className="grid h-full min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[340px_minmax(0,1fr)]">
			<section
				className="rounded-lg border"
				style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
			>
				<div
					className="flex items-center justify-between border-b px-3 py-2"
					style={{ borderColor: REPLIT.border }}
				>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
						Scripts
					</p>
					{packageJsonPath ? (
						<button
							type="button"
							onClick={() => onOpenFile(packageJsonPath)}
							className="text-xs text-[#4EA1FF]"
						>
							Open package.json
						</button>
					) : null}
				</div>
				<div className="space-y-2 p-3">
					{!packageJsonPath ? (
						<p className="text-sm text-[#9DA2A6]">
							No package.json found in this workspace.
						</p>
					) : null}
					{summary?.scripts.map(([name, value]) => (
						<div
							key={name}
							className="rounded-md border px-3 py-3"
							style={{
								borderColor: REPLIT.border,
								backgroundColor: REPLIT.background,
							}}
						>
							<div className="flex items-center justify-between gap-3">
								<span className="font-mono text-sm text-[#2b2418]">{name}</span>
								<button
									type="button"
									onClick={() => onRunScript(name)}
									className="rounded-md px-2 py-1 text-xs text-[#2b2418]"
									style={{ backgroundColor: REPLIT.accent }}
								>
									Run
								</button>
							</div>
							<p className="mt-2 font-mono text-[11px] text-[#5F6B7A]">
								{value}
							</p>
						</div>
					))}
					{summary && summary.scripts.length === 0 ? (
						<p className="text-sm text-[#9DA2A6]">No scripts defined.</p>
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
						Dependencies
					</p>
				</div>
				<div className="grid gap-4 p-3 lg:grid-cols-2">
					<div>
						<p className="mb-2 text-xs uppercase tracking-[0.18em] text-[#5F6B7A]">
							Dependencies
						</p>
						<div className="space-y-2">
							{summary?.dependencies.map(([name, value]) => (
								<div
									key={name}
									className="flex items-center justify-between rounded-md border px-3 py-2 font-mono text-xs text-[#2b2418]"
									style={{
										borderColor: REPLIT.border,
										backgroundColor: REPLIT.background,
									}}
								>
									<span>{name}</span>
									<span className="text-[#9DA2A6]">{value}</span>
								</div>
							))}
							{summary && summary.dependencies.length === 0 ? (
								<p className="text-sm text-[#9DA2A6]">No dependencies.</p>
							) : null}
						</div>
					</div>
					<div>
						<p className="mb-2 text-xs uppercase tracking-[0.18em] text-[#5F6B7A]">
							Dev dependencies
						</p>
						<div className="space-y-2">
							{summary?.devDependencies.map(([name, value]) => (
								<div
									key={name}
									className="flex items-center justify-between rounded-md border px-3 py-2 font-mono text-xs text-[#2b2418]"
									style={{
										borderColor: REPLIT.border,
										backgroundColor: REPLIT.background,
									}}
								>
									<span>{name}</span>
									<span className="text-[#9DA2A6]">{value}</span>
								</div>
							))}
							{summary && summary.devDependencies.length === 0 ? (
								<p className="text-sm text-[#9DA2A6]">No dev dependencies.</p>
							) : null}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
