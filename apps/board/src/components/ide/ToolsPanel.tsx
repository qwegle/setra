import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	type FilesActivity,
	type Issue,
	type ProjectContextDocument,
	api,
} from "../../lib/api";
import { timeAgo } from "../../lib/utils";
import { REPLIT } from "./types";

interface ToolsPanelProps {
	projectId: string;
	onToast?: (message: string, type?: "ok" | "err") => void;
}

export function ToolsPanel({ projectId, onToast }: ToolsPanelProps) {
	const qc = useQueryClient();
	const contextQuery = useQuery<ProjectContextDocument>({
		queryKey: ["project-context", projectId],
		queryFn: () => api.projectContext.get(projectId),
		enabled: Boolean(projectId),
	});
	const activityQuery = useQuery<FilesActivity[]>({
		queryKey: ["files-activity", projectId],
		queryFn: () => api.files.activity(projectId),
		enabled: Boolean(projectId),
		refetchInterval: 15_000,
	});
	const issuesQuery = useQuery<Issue[]>({
		queryKey: ["project-issues", projectId],
		queryFn: () => api.issues.list(projectId),
		enabled: Boolean(projectId),
	});
	const [contextDraft, setContextDraft] = useState("");

	useEffect(
		() => setContextDraft(contextQuery.data?.content ?? ""),
		[contextQuery.data?.content],
	);

	const activeIssues = useMemo(
		() =>
			(issuesQuery.data ?? [])
				.filter(
					(issue) => issue.status !== "done" && issue.status !== "cancelled",
				)
				.slice(0, 8),
		[issuesQuery.data],
	);
	const saveContextMut = useMutation({
		mutationFn: () => api.projectContext.update(projectId, contextDraft),
		onSuccess: async () => {
			onToast?.("Context saved");
			await qc.invalidateQueries({ queryKey: ["project-context", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to save context",
				"err",
			),
	});

	return (
		<div className="grid h-full min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(360px,1.1fr)_minmax(320px,0.9fr)]">
			<section
				className="rounded-lg border"
				style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
			>
				<div
					className="flex items-center justify-between border-b px-3 py-2"
					style={{ borderColor: REPLIT.border }}
				>
					<div className="flex items-center gap-2">
						<Sparkles className="h-4 w-4 text-[#4EA1FF]" />
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							AI context
						</p>
					</div>
					<button
						type="button"
						onClick={() => saveContextMut.mutate()}
						className="rounded-md px-3 py-1 text-xs text-[#2b2418]"
						style={{ backgroundColor: REPLIT.accent }}
					>
						Save
					</button>
				</div>
				<div className="p-3">
					<textarea
						value={contextDraft}
						onChange={(event) => setContextDraft(event.target.value)}
						placeholder="Describe architecture, conventions, constraints, and work in progress for AI helpers..."
						className="min-h-[360px] w-full rounded-md border bg-[#0E1525] p-3 text-sm text-[#2b2418] outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
				</div>
			</section>

			<div className="space-y-4">
				<section
					className="rounded-lg border"
					style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
				>
					<div
						className="border-b px-3 py-2"
						style={{ borderColor: REPLIT.border }}
					>
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							Recent activity
						</p>
					</div>
					<div className="space-y-2 p-3">
						{(activityQuery.data ?? []).slice(0, 6).map((activity) => (
							<div
								key={activity.runId}
								className="rounded-md border px-3 py-2"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								<div className="flex items-center gap-2 text-[11px] text-[#9DA2A6]">
									<span className="rounded bg-[#1C2333] px-1.5 py-0.5 text-[#2b2418]">
										{activity.status}
									</span>
									<span className="truncate">{activity.agentSlug}</span>
									<span className="ml-auto">{timeAgo(activity.updatedAt)}</span>
								</div>
								{activity.issueTitle ? (
									<p className="mt-1 text-xs text-[#2b2418]">
										{activity.issueTitle}
									</p>
								) : null}
								{activity.preview ? (
									<p className="mt-1 line-clamp-2 text-[11px] text-[#5F6B7A]">
										{activity.preview}
									</p>
								) : null}
							</div>
						))}
						{(activityQuery.data ?? []).length === 0 ? (
							<p className="text-sm text-[#9DA2A6]">No recent activity yet.</p>
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
							Open tasks
						</p>
					</div>
					<div className="space-y-2 p-3">
						{activeIssues.map((issue) => (
							<div
								key={issue.id}
								className="rounded-md border px-3 py-2"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								<p className="text-sm text-[#2b2418]">{issue.title}</p>
								<p className="mt-1 text-[11px] text-[#5F6B7A]">
									{issue.status.replaceAll("_", " ")}
								</p>
							</div>
						))}
						{activeIssues.length === 0 ? (
							<p className="text-sm text-[#9DA2A6]">
								No active tasks linked to this project.
							</p>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
