import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type Project, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { type EditorSettings, REPLIT } from "./types";

interface SettingsPanelProps {
	project: Project | undefined;
	currentBranch: string;
	settings: EditorSettings;
	onSettingsChange: (next: EditorSettings) => void;
	onToast?: (message: string, type?: "ok" | "err") => void;
}

export function SettingsPanel({
	project,
	currentBranch,
	settings,
	onSettingsChange,
	onToast,
}: SettingsPanelProps) {
	const qc = useQueryClient();
	const [workspacePathDraft, setWorkspacePathDraft] = useState("");
	const [defaultBranchDraft, setDefaultBranchDraft] = useState("");

	useEffect(() => {
		setWorkspacePathDraft(project?.workspacePath ?? "");
		setDefaultBranchDraft(project?.defaultBranch ?? currentBranch);
	}, [
		project?.id,
		project?.workspacePath,
		project?.defaultBranch,
		currentBranch,
	]);

	const updateProjectMut = useMutation({
		mutationFn: (body: {
			workspacePath?: string | null;
			defaultBranch?: string | null;
		}) => api.projects.update(project!.id, body),
		onSuccess: async () => {
			onToast?.("Project settings saved");
			await qc.invalidateQueries({ queryKey: ["projects"] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to update project",
				"err",
			),
	});

	if (!project) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-sm text-[#9DA2A6]">
				Select a project to change settings.
			</div>
		);
	}

	return (
		<div className="grid h-full min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-2">
			<section
				className="rounded-lg border"
				style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
			>
				<div
					className="flex items-center justify-between border-b px-3 py-2"
					style={{ borderColor: REPLIT.border }}
				>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
						Workspace settings
					</p>
					<button
						type="button"
						onClick={() =>
							updateProjectMut.mutate({
								workspacePath: workspacePathDraft || null,
								defaultBranch: defaultBranchDraft || null,
							})
						}
						className="rounded-md px-3 py-1 text-xs text-white"
						style={{ backgroundColor: REPLIT.accent }}
					>
						Save
					</button>
				</div>
				<div className="space-y-4 p-3">
					<div>
						<label className="mb-1 block text-[11px] text-[#5F6B7A]">
							Workspace path
						</label>
						<input
							value={workspacePathDraft}
							onChange={(event) => setWorkspacePathDraft(event.target.value)}
							placeholder="/path/to/workspace"
							className="h-10 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
							style={{ borderColor: REPLIT.border }}
						/>
					</div>
					<div>
						<label className="mb-1 block text-[11px] text-[#5F6B7A]">
							Default branch
						</label>
						<input
							value={defaultBranchDraft}
							onChange={(event) => setDefaultBranchDraft(event.target.value)}
							placeholder="main"
							className="h-10 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
							style={{ borderColor: REPLIT.border }}
						/>
					</div>
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
						Editor settings
					</p>
				</div>
				<div className="space-y-4 p-3">
					<div>
						<label className="mb-1 block text-[11px] text-[#5F6B7A]">
							Font size: {settings.fontSize}px
						</label>
						<input
							type="range"
							min="10"
							max="24"
							value={settings.fontSize}
							onChange={(event) =>
								onSettingsChange({
									...settings,
									fontSize: Number(event.target.value),
								})
							}
							className="w-full"
						/>
					</div>
					<div>
						<label className="mb-1 block text-[11px] text-[#5F6B7A]">
							Tab size: {settings.tabSize} spaces
						</label>
						<input
							type="range"
							min="2"
							max="8"
							step="2"
							value={settings.tabSize}
							onChange={(event) =>
								onSettingsChange({
									...settings,
									tabSize: Number(event.target.value),
								})
							}
							className="w-full"
						/>
					</div>
					<div className="flex items-center justify-between">
						<label className="text-[11px] text-[#5F6B7A]">Word wrap</label>
						<button
							type="button"
							onClick={() =>
								onSettingsChange({ ...settings, wordWrap: !settings.wordWrap })
							}
							className={cn(
								"relative h-6 w-11 rounded-full transition-colors",
								settings.wordWrap ? "bg-[#0079F2]" : "bg-[#2B3245]",
							)}
						>
							<span
								className={cn(
									"absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
									settings.wordWrap ? "left-[22px]" : "left-0.5",
								)}
							/>
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}
