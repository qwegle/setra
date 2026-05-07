import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Download,
	GitCommitHorizontal,
	Loader2,
	Minus,
	Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cn, timeAgo } from "../../lib/utils";
import { REPLIT } from "./types";

interface GitPanelProps {
	projectId: string;
	hasWorkspace: boolean;
	currentBranch: string;
	onOpenFile: (path: string) => void;
	onToast?: (message: string, type?: "ok" | "err") => void;
}

function Section({
	title,
	action,
	children,
}: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
	return (
		<section
			className="rounded-lg border"
			style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
		>
			<div
				className="flex items-center justify-between border-b px-3 py-2"
				style={{ borderColor: REPLIT.border }}
			>
				<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
					{title}
				</p>
				{action}
			</div>
			<div className="p-3">{children}</div>
		</section>
	);
}

export function GitPanel({
	projectId,
	hasWorkspace,
	currentBranch,
	onOpenFile,
	onToast,
}: GitPanelProps) {
	const qc = useQueryClient();
	const [diffFile, setDiffFile] = useState<string | null>(null);
	const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(
		null,
	);
	const [commitMessage, setCommitMessage] = useState("");
	const [actionOutput, setActionOutput] = useState("");

	const branchesQuery = useQuery({
		queryKey: ["git-branches", projectId],
		queryFn: () => api.projectGit.branches(projectId),
		enabled: Boolean(projectId && hasWorkspace),
	});
	const statusQuery = useQuery({
		queryKey: ["git-status", projectId],
		queryFn: () => api.projectGit.status(projectId),
		enabled: Boolean(projectId && hasWorkspace),
		refetchInterval: 10_000,
	});
	const logQuery = useQuery({
		queryKey: ["git-log", projectId],
		queryFn: () => api.projectGit.log(projectId),
		enabled: Boolean(projectId && hasWorkspace),
		refetchInterval: 30_000,
	});
	const workingDiffQuery = useQuery({
		queryKey: ["git-working-diff", projectId, diffFile],
		queryFn: () => api.projectGit.workingDiff(projectId, diffFile!),
		enabled: Boolean(projectId && diffFile && hasWorkspace),
	});
	const commitDiffQuery = useQuery({
		queryKey: ["git-commit-diff", projectId, selectedCommitSha],
		queryFn: () => api.projectGit.diff(projectId, selectedCommitSha!),
		enabled: Boolean(projectId && selectedCommitSha && hasWorkspace),
	});

	useEffect(() => {
		const files = statusQuery.data?.files ?? [];
		if (!files.length) {
			setDiffFile(null);
			return;
		}
		if (diffFile && files.some((file) => file.path === diffFile)) return;
		setDiffFile(files[0]?.path ?? null);
	}, [diffFile, statusQuery.data?.files]);

	const refreshGit = async () => {
		await Promise.all([
			qc.invalidateQueries({ queryKey: ["git-branches", projectId] }),
			qc.invalidateQueries({ queryKey: ["git-status", projectId] }),
			qc.invalidateQueries({ queryKey: ["git-log", projectId] }),
			qc.invalidateQueries({ queryKey: ["git-working-diff", projectId] }),
		]);
	};

	const checkoutMut = useMutation({
		mutationFn: (branch: string) => api.projectGit.checkout(projectId, branch),
		onSuccess: async (data) => {
			setActionOutput(`git checkout ${data.branch}`);
			onToast?.(`Switched to ${data.branch}`);
			await refreshGit();
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Checkout failed",
				"err",
			),
	});
	const pullMut = useMutation({
		mutationFn: () => api.projectGit.pull(projectId),
		onSuccess: async (data) => {
			setActionOutput(`git pull\n${data.output}`);
			onToast?.("Pulled from remote");
			await refreshGit();
		},
		onError: (error) =>
			onToast?.(error instanceof Error ? error.message : "Pull failed", "err"),
	});
	const pushMut = useMutation({
		mutationFn: () => api.projectGit.push(projectId),
		onSuccess: async (data) => {
			setActionOutput(`git push\n${data.output}`);
			onToast?.("Pushed to remote");
			await refreshGit();
		},
		onError: (error) =>
			onToast?.(error instanceof Error ? error.message : "Push failed", "err"),
	});
	const stageMut = useMutation({
		mutationFn: (filePath: string) => api.projectGit.stage(projectId, filePath),
		onSuccess: async (data) => {
			onToast?.(`Staged ${data.path}`);
			await qc.invalidateQueries({ queryKey: ["git-status", projectId] });
		},
		onError: (error) =>
			onToast?.(error instanceof Error ? error.message : "Stage failed", "err"),
	});
	const unstageMut = useMutation({
		mutationFn: (filePath: string) =>
			api.projectGit.unstage(projectId, filePath),
		onSuccess: async (data) => {
			onToast?.(`Unstaged ${data.path}`);
			await qc.invalidateQueries({ queryKey: ["git-status", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Unstage failed",
				"err",
			),
	});
	const stashSaveMut = useMutation({
		mutationFn: () =>
			api.projectGit.stashSave(projectId, `stash-${Date.now()}`),
		onSuccess: async (data) => {
			setActionOutput(`git stash\n${data.output}`);
			onToast?.("Changes stashed");
			await refreshGit();
		},
		onError: (error) =>
			onToast?.(error instanceof Error ? error.message : "Stash failed", "err"),
	});
	const stashPopMut = useMutation({
		mutationFn: () => api.projectGit.stashPop(projectId),
		onSuccess: async (data) => {
			setActionOutput(`git stash pop\n${data.output}`);
			onToast?.("Stash applied");
			await refreshGit();
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Stash pop failed",
				"err",
			),
	});
	const commitMut = useMutation({
		mutationFn: () => api.projectGit.commit(projectId, commitMessage.trim()),
		onSuccess: async (data) => {
			setActionOutput(`git commit -m \"${commitMessage.trim()}\"\n${data.sha}`);
			setCommitMessage("");
			onToast?.("Commit created");
			await refreshGit();
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Commit failed",
				"err",
			),
	});

	const files = statusQuery.data?.files ?? [];
	const hasStagedFiles = useMemo(
		() => files.some((file) => file.staged),
		[files],
	);
	const diffText = selectedCommitSha
		? commitDiffQuery.data?.diff
		: workingDiffQuery.data?.diff;

	if (!hasWorkspace) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-sm text-[#9DA2A6]">
				Set a workspace path to use Git tools.
			</div>
		);
	}

	return (
		<div className="grid h-full min-h-0 gap-3 overflow-auto p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
			<div className="space-y-3">
				<Section
					title="Branch"
					action={
						<span className="text-[11px] text-[#9DA2A6]">
							 {currentBranch}
						</span>
					}
				>
					<div className="space-y-2">
						<select
							value={currentBranch}
							onChange={(event) => {
								setSelectedCommitSha(null);
								if (event.target.value !== currentBranch)
									checkoutMut.mutate(event.target.value);
							}}
							className="h-9 w-full rounded-md border bg-[#0E1525] px-3 text-sm text-white outline-none"
							style={{ borderColor: REPLIT.border }}
						>
							{(branchesQuery.data?.branches ?? []).map((branch) => (
								<option key={branch.name} value={branch.name}>
									{branch.name}
								</option>
							))}
						</select>
						<div className="grid grid-cols-2 gap-2 text-xs">
							<button
								type="button"
								onClick={() => pullMut.mutate()}
								className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-white hover:bg-[#111827]"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								<Download className="h-4 w-4" />
								Pull
							</button>
							<button
								type="button"
								onClick={() => pushMut.mutate()}
								className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-white hover:bg-[#111827]"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								<Upload className="h-4 w-4" />
								Push
							</button>
							<button
								type="button"
								onClick={() => stashSaveMut.mutate()}
								className="rounded-md border px-3 py-2 text-white hover:bg-[#111827]"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								Stash save
							</button>
							<button
								type="button"
								onClick={() => stashPopMut.mutate()}
								className="rounded-md border px-3 py-2 text-white hover:bg-[#111827]"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								Stash pop
							</button>
						</div>
					</div>
				</Section>

				<Section
					title="Working tree"
					action={
						<span className="text-[11px] text-[#9DA2A6]">
							{files.length} files
						</span>
					}
				>
					<div className="space-y-2">
						{statusQuery.isPending ? (
							<div className="flex items-center gap-2 text-xs text-[#9DA2A6]">
								<Loader2 className="h-4 w-4 animate-spin" /> Loading status…
							</div>
						) : null}
						{!statusQuery.isPending && files.length === 0 ? (
							<p className="text-xs text-[#9DA2A6]">Clean working tree.</p>
						) : null}
						{files.map((file) => (
							<div
								key={file.path}
								className={cn(
									"rounded-md border px-2 py-2 text-xs",
									diffFile === file.path && !selectedCommitSha
										? "text-white"
										: "text-[#9DA2A6]",
								)}
								style={{
									borderColor:
										diffFile === file.path && !selectedCommitSha
											? REPLIT.accent
											: REPLIT.border,
									backgroundColor:
										diffFile === file.path && !selectedCommitSha
											? REPLIT.background
											: REPLIT.panelAlt,
								}}
							>
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() =>
											file.staged
												? unstageMut.mutate(file.path)
												: stageMut.mutate(file.path)
										}
										className={cn(
											"flex h-6 w-6 items-center justify-center rounded border",
											file.staged
												? "text-[#00E676]"
												: "text-[#5F6B7A] hover:text-white",
										)}
										style={{
											borderColor: file.staged ? REPLIT.success : REPLIT.border,
											backgroundColor: file.staged
												? "rgba(0,200,83,0.1)"
												: "transparent",
										}}
									>
										{file.staged ? (
											<Check className="h-3.5 w-3.5" />
										) : (
											<Minus className="h-3.5 w-3.5" />
										)}
									</button>
									<button
										type="button"
										onClick={() => {
											setSelectedCommitSha(null);
											setDiffFile(file.path);
										}}
										className="flex min-w-0 flex-1 items-center gap-2 text-left"
									>
										<span className="w-5 rounded bg-[#1C2333] py-0.5 text-center text-[10px] text-[#FFD600]">
											{file.status}
										</span>
										<span className="truncate font-mono">{file.path}</span>
									</button>
								</div>
								<button
									type="button"
									onClick={() => onOpenFile(file.path)}
									className="mt-2 text-[11px] text-[#4EA1FF] hover:text-[#82AAFF]"
								>
									Open file
								</button>
							</div>
						))}
					</div>
				</Section>

				<Section title="Commit">
					<div className="space-y-3">
						<input
							value={commitMessage}
							onChange={(event) => setCommitMessage(event.target.value)}
							placeholder="feat: improve IDE"
							className="h-10 w-full rounded-md border bg-[#0E1525] px-3 text-sm text-white outline-none"
							style={{ borderColor: REPLIT.border }}
						/>
						<button
							type="button"
							disabled={!commitMessage.trim() || !hasStagedFiles}
							onClick={() => commitMut.mutate()}
							className="w-full rounded-md px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
							style={{ backgroundColor: REPLIT.accent }}
						>
							Commit staged changes
						</button>
					</div>
				</Section>
			</div>

			<div className="space-y-3">
				<Section
					title={selectedCommitSha ? "Commit diff" : "Diff viewer"}
					action={
						selectedCommitSha ? (
							<button
								type="button"
								onClick={() => setSelectedCommitSha(null)}
								className="text-[11px] text-[#4EA1FF]"
							>
								Back to working diff
							</button>
						) : null
					}
				>
					<div className="space-y-2">
						<p className="truncate font-mono text-xs text-[#9DA2A6]">
							{selectedCommitSha
								? selectedCommitSha
								: (diffFile ?? "No file selected")}
						</p>
						<pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-[#0E1525] p-3 font-mono text-[11px] text-[#F5F9FC]">
							{diffText || "No diff available."}
						</pre>
					</div>
				</Section>

				<Section title="Recent commits">
					<div className="space-y-2">
						{(logQuery.data?.commits ?? []).slice(0, 8).map((commit) => (
							<button
								key={commit.sha}
								type="button"
								onClick={() => setSelectedCommitSha(commit.sha)}
								className={cn(
									"w-full rounded-md border px-3 py-2 text-left",
									selectedCommitSha === commit.sha &&
										"border-[#0079F2] bg-[#0E1525]",
								)}
								style={{
									borderColor:
										selectedCommitSha === commit.sha
											? REPLIT.accent
											: REPLIT.border,
									backgroundColor:
										selectedCommitSha === commit.sha
											? REPLIT.background
											: REPLIT.panelAlt,
								}}
							>
								<div className="flex items-center gap-2 text-xs text-white">
									<GitCommitHorizontal className="h-3.5 w-3.5 text-[#9DA2A6]" />
									<span className="truncate">{commit.message}</span>
								</div>
								<div className="mt-1 flex items-center gap-2 text-[11px] text-[#5F6B7A]">
									<span className="font-mono">{commit.shortSha}</span>
									<span className="truncate">{commit.author}</span>
									<span className="ml-auto">{timeAgo(commit.date)}</span>
								</div>
							</button>
						))}
						{(logQuery.data?.commits ?? []).length === 0 ? (
							<p className="text-xs text-[#9DA2A6]">No commits yet.</p>
						) : null}
					</div>
				</Section>

				<Section title="Latest Git output">
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-[#0E1525] p-3 font-mono text-[11px] text-[#F5F9FC]">
						{actionOutput || "Run a Git action to see output here."}
					</pre>
				</Section>
			</div>
		</div>
	);
}
