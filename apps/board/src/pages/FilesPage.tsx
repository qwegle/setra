import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "../components/CodeEditor";
import {
	ConsolePanel,
	type CursorPosition,
	DatabasePanel,
	type EditorSettings,
	FileTree,
	GitPanel,
	type IDETab,
	IconRail,
	type JumpTarget,
	PackagesPanel,
	PreviewPanel,
	REPLIT,
	type RailAction,
	SearchPanel,
	SettingsPanel,
	TabBar,
	type TerminalEntry,
	type ToastState,
	ToolsPanel,
	TopBar,
	VaultPanel,
	buildFileDataUrl,
	extensionLabel,
	fileExt,
	fileName,
	formatBytes,
	isFileTab,
	isImagePath,
	isSvgPath,
	parsePackageSummary,
	replacePathPrefix,
	tabId,
} from "../components/ide";
import {
	type FileContentResponse,
	type FileTreeEntry,
	type Project,
	api,
} from "../lib/api";
import { cn } from "../lib/utils";

function createToolTab(
	type: Exclude<IDETab["type"], "file">,
	previewUrl: string,
): IDETab {
	if (type === "preview") return { type: "preview", url: previewUrl };
	return { type } as IDETab;
}

function FilesPageEmptyState({
	onOpenSearch,
	onToggleExplorer,
}: { onOpenSearch: () => void; onToggleExplorer: () => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 text-center">
			<div>
				<p className="text-xl font-semibold text-white">Your IDE is ready</p>
				<p className="mt-2 text-sm text-[#9DA2A6]">
					Open a file from the explorer or launch a tool tab from the left rail.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onToggleExplorer}
					className="rounded-md border px-3 py-2 text-sm text-white"
					style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
				>
					Open files
				</button>
				<button
					type="button"
					onClick={onOpenSearch}
					className="rounded-md px-3 py-2 text-sm text-white"
					style={{ backgroundColor: REPLIT.accent }}
				>
					Search project
				</button>
			</div>
		</div>
	);
}

function FileEditorPane({
	filePath,
	currentContent,
	fileData,
	canEdit,
	hasWorkspace,
	isDirty,
	onChange,
	onSave,
	onCursorChange,
	editorSettings,
	jumpTarget,
	onOpenPreview,
	onOpenConsole,
}: {
	filePath: string;
	currentContent: string;
	fileData: FileContentResponse | undefined;
	canEdit: boolean;
	hasWorkspace: boolean;
	isDirty: boolean;
	onChange: (value: string) => void;
	onSave: () => void;
	onCursorChange: (position: CursorPosition) => void;
	editorSettings: EditorSettings;
	jumpTarget: JumpTarget;
	onOpenPreview: () => void;
	onOpenConsole: () => void;
}) {
	const fileDataUrl = buildFileDataUrl(fileData);

	const header = (
		<div
			className="flex min-h-[40px] items-center gap-3 border-b px-4 text-xs"
			style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
		>
			<div className="flex min-w-0 items-center gap-2 text-[#9DA2A6]">
				{filePath.split("/").map((part, index) => (
					<div key={`${part}-${index}`} className="flex items-center gap-2">
						{index > 0 ? <span className="text-[#5F6B7A]">/</span> : null}
						<span
							className={
								index === filePath.split("/").length - 1
									? "text-white"
									: undefined
							}
						>
							{part}
						</span>
					</div>
				))}
			</div>
			<div className="ml-auto flex items-center gap-2">
				{isDirty ? (
					<span className="rounded bg-[#0079F2]/20 px-2 py-0.5 text-[#82AAFF]">
						Unsaved
					</span>
				) : null}
				<button
					type="button"
					onClick={onOpenPreview}
					className="rounded-md border px-2 py-1 text-[#9DA2A6] hover:text-white"
					style={{
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.background,
					}}
				>
					Preview
				</button>
				<button
					type="button"
					onClick={onOpenConsole}
					className="rounded-md border px-2 py-1 text-[#9DA2A6] hover:text-white"
					style={{
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.background,
					}}
				>
					Console
				</button>
				<button
					type="button"
					onClick={onSave}
					disabled={!isDirty || !hasWorkspace || !canEdit}
					className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-white disabled:opacity-50"
					style={{
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.background,
					}}
				>
					<Save className="h-3.5 w-3.5" /> Save
				</button>
			</div>
		</div>
	);

	if (fileData?.isBinary) {
		if (isImagePath(filePath) && fileDataUrl) {
			return (
				<div className="flex h-full flex-col">
					{header}
					<div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-6">
						<img
							src={fileDataUrl}
							alt={filePath}
							className="max-h-full max-w-full rounded-md border object-contain"
							style={{ borderColor: REPLIT.border }}
						/>
						<div className="text-xs text-[#9DA2A6]">
							{fileName(filePath)} · {formatBytes(fileData.size)}
						</div>
					</div>
				</div>
			);
		}
		return (
			<div className="flex h-full flex-col">
				{header}
				<div className="flex flex-1 items-center justify-center p-6 text-center text-[#9DA2A6]">
					Binary file — cannot edit.
				</div>
			</div>
		);
	}

	if (isSvgPath(filePath)) {
		return (
			<div className="grid h-full min-h-0 grid-cols-2">
				<div className="flex min-h-0 flex-col">
					{header}
					<div
						className="flex min-h-0 flex-1 items-center justify-center border-r p-4"
						style={{
							borderColor: REPLIT.border,
							backgroundColor: REPLIT.panelAlt,
						}}
					>
						<div
							className="flex max-h-full w-full items-center justify-center overflow-auto rounded-md border bg-white/5 p-4"
							style={{ borderColor: REPLIT.border }}
						>
							<img
								src={`data:image/svg+xml;utf8,${encodeURIComponent(currentContent)}`}
								alt={filePath}
								className="max-h-full max-w-full object-contain"
							/>
						</div>
					</div>
				</div>
				<CodeEditor
					value={currentContent}
					language={fileExt(filePath)}
					readOnly={!hasWorkspace || !canEdit}
					onChange={onChange}
					onCursorChange={onCursorChange}
					fontSize={editorSettings.fontSize}
					tabSize={editorSettings.tabSize}
					wordWrap={editorSettings.wordWrap}
					jumpTo={jumpTarget}
					className="h-full"
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{header}
			<div className="min-h-0 flex-1">
				<CodeEditor
					value={currentContent}
					language={fileExt(filePath)}
					readOnly={!hasWorkspace || !canEdit}
					onChange={onChange}
					onCursorChange={onCursorChange}
					fontSize={editorSettings.fontSize}
					tabSize={editorSettings.tabSize}
					wordWrap={editorSettings.wordWrap}
					jumpTo={jumpTarget}
					className="h-full"
				/>
			</div>
		</div>
	);
}

export function FilesPage() {
	const qc = useQueryClient();
	const toastTimeoutRef = useRef<number | null>(null);
	const execAbortRef = useRef<AbortController | null>(null);

	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [explorerOpen, setExplorerOpen] = useState(true);
	const [openTabs, setOpenTabs] = useState<IDETab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const [lastFilePath, setLastFilePath] = useState<string | null>(null);
	const [fileContents, setFileContents] = useState<Record<string, string>>({});
	const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());
	const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
		line: 1,
		column: 1,
	});
	const [jumpTarget, setJumpTarget] = useState<JumpTarget>(null);
	const [previewUrl, setPreviewUrl] = useState("http://localhost:3000");
	const [searchQuery, setSearchQuery] = useState("");
	const [toast, setToast] = useState<ToastState>(null);

	const [consoleEntries, setConsoleEntries] = useState<TerminalEntry[]>([]);
	const [consoleInput, setConsoleInput] = useState("");
	const [consoleHistory, setConsoleHistory] = useState<string[]>([]);
	const [consoleHistoryIndex, setConsoleHistoryIndex] = useState<number | null>(
		null,
	);
	const [isRunning, setIsRunning] = useState(false);

	const [editorSettings, setEditorSettings] = useState<EditorSettings>({
		fontSize: Number(localStorage.getItem("setra:editorFontSize") ?? 14),
		tabSize: Number(localStorage.getItem("setra:editorTabSize") ?? 2),
		wordWrap: localStorage.getItem("setra:editorWordWrap") === "true",
	});

	useEffect(() => {
		localStorage.setItem(
			"setra:editorFontSize",
			String(editorSettings.fontSize),
		);
		localStorage.setItem("setra:editorTabSize", String(editorSettings.tabSize));
		localStorage.setItem(
			"setra:editorWordWrap",
			String(editorSettings.wordWrap),
		);
	}, [editorSettings]);

	const { data: projects = [] } = useQuery<Project[]>({
		queryKey: ["projects"],
		queryFn: api.projects.list,
	});

	useEffect(() => {
		if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id);
	}, [projects, selectedProjectId]);

	const selectedProject = projects.find(
		(project) => project.id === selectedProjectId,
	);
	const hasWorkspace = Boolean(selectedProject?.workspacePath);

	const branchesQuery = useQuery({
		queryKey: ["git-branches", selectedProjectId],
		queryFn: () => api.projectGit.branches(selectedProjectId),
		enabled: Boolean(selectedProjectId && hasWorkspace),
		refetchInterval: 30_000,
	});
	const treeQuery = useQuery({
		queryKey: ["files-tree", selectedProjectId],
		queryFn: () => api.files.tree(selectedProjectId),
		enabled: Boolean(selectedProjectId && hasWorkspace),
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
		queryKey: ["package-json", selectedProjectId, packageJsonPath],
		queryFn: () => api.files.content(selectedProjectId, packageJsonPath!),
		enabled: Boolean(selectedProjectId && packageJsonPath && hasWorkspace),
	});
	const packageSummary = useMemo(
		() => parsePackageSummary(packageJsonQuery.data?.content ?? null),
		[packageJsonQuery.data?.content],
	);

	const activeTab = useMemo(
		() => openTabs.find((tab) => tabId(tab) === activeTabId) ?? null,
		[activeTabId, openTabs],
	);
	const activeFilePath =
		activeTab && isFileTab(activeTab) ? activeTab.path : lastFilePath;
	const fileQuery = useQuery({
		queryKey: ["files-content", selectedProjectId, activeFilePath],
		queryFn: () => api.files.content(selectedProjectId, activeFilePath!),
		enabled: Boolean(selectedProjectId && activeFilePath && hasWorkspace),
	});

	useEffect(() => {
		const fetchedContent = fileQuery.data?.content;
		if (
			!activeFilePath ||
			fetchedContent === undefined ||
			fetchedContent === null
		)
			return;
		setFileContents((current) => {
			if (
				dirtyFiles.has(activeFilePath) &&
				current[activeFilePath] !== undefined
			)
				return current;
			return { ...current, [activeFilePath]: fetchedContent };
		});
	}, [activeFilePath, dirtyFiles, fileQuery.data]);

	useEffect(
		() => () => {
			if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
		},
		[],
	);

	const showToast = useCallback((msg: string, type: "ok" | "err" = "ok") => {
		setToast({ msg, type });
		if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
		toastTimeoutRef.current = window.setTimeout(() => setToast(null), 3200);
	}, []);

	const pushConsole = useCallback(
		(text: string, tone: TerminalEntry["tone"] = "default") => {
			setConsoleEntries((current) => [
				...current,
				{ id: `${Date.now()}-${current.length}`, text, tone },
			]);
		},
		[],
	);

	const currentBranch =
		branchesQuery.data?.branches.find((branch) => branch.current)?.name ??
		selectedProject?.defaultBranch ??
		"main";
	const currentContent = activeFilePath
		? (fileContents[activeFilePath] ?? fileQuery.data?.content ?? "")
		: "";
	const currentFileData = fileQuery.data as FileContentResponse | undefined;
	const canEditCurrentFile = Boolean(
		activeFilePath && currentFileData && !currentFileData.isBinary,
	);
	const isDirty = activeFilePath ? dirtyFiles.has(activeFilePath) : false;

	const tabs = useMemo(
		() =>
			openTabs.map((tab) =>
				tab.type === "file"
					? { ...tab, isDirty: dirtyFiles.has(tab.path) }
					: tab,
			),
		[dirtyFiles, openTabs],
	);

	const saveFileMut = useMutation({
		mutationFn: () =>
			api.files.save({
				projectId: selectedProjectId,
				path: activeFilePath!,
				content: currentContent,
			}),
		onSuccess: async () => {
			if (activeFilePath) {
				setDirtyFiles((current) => {
					const next = new Set(current);
					next.delete(activeFilePath);
					return next;
				});
			}
			showToast("File saved");
			await Promise.all([
				qc.invalidateQueries({
					queryKey: ["files-content", selectedProjectId, activeFilePath],
				}),
				qc.invalidateQueries({ queryKey: ["git-status", selectedProjectId] }),
			]);
		},
		onError: (error) =>
			showToast(
				error instanceof Error ? error.message : "Failed to save file",
				"err",
			),
	});

	const openFile = useCallback(
		(path: string, target?: { line: number; column?: number }) => {
			setLastFilePath(path);
			setOpenTabs((current) => {
				if (current.some((tab) => tab.type === "file" && tab.path === path))
					return current;
				return [
					...current,
					{ type: "file", path, name: fileName(path), isDirty: false },
				];
			});
			setActiveTabId(`file:${path}`);
			if (target) setJumpTarget({ ...target, token: Date.now() });
		},
		[],
	);

	const openToolTab = useCallback(
		(type: Exclude<IDETab["type"], "file">) => {
			const nextTab = createToolTab(type, previewUrl);
			setOpenTabs((current) => {
				const existing = current.find((tab) => tab.type === type);
				if (existing) {
					return current.map((tab) =>
						tab.type === "preview" && type === "preview" ? nextTab : tab,
					);
				}
				return [...current, nextTab];
			});
			setActiveTabId(type === "preview" ? "tool:preview" : `tool:${type}`);
		},
		[previewUrl],
	);

	const closeTab = useCallback(
		(id: string) => {
			setOpenTabs((current) => {
				const index = current.findIndex((tab) => tabId(tab) === id);
				if (index === -1) return current;
				const closing = current[index]!;
				const nextTabs = current.filter((tab) => tabId(tab) !== id);
				if (closing.type === "file") {
					setDirtyFiles((existing) => {
						const next = new Set(existing);
						next.delete(closing.path);
						return next;
					});
					setFileContents((existing) => {
						const next = { ...existing };
						delete next[closing.path];
						return next;
					});
					if (lastFilePath === closing.path)
						setLastFilePath(
							[...nextTabs]
								.reverse()
								.find(
									(tab): tab is Extract<IDETab, { type: "file" }> =>
										tab.type === "file",
								)?.path ?? null,
						);
				}
				if (activeTabId === id) {
					const fallback = nextTabs[index - 1] ?? nextTabs[index] ?? null;
					setActiveTabId(fallback ? tabId(fallback) : null);
				}
				return nextTabs;
			});
		},
		[activeTabId, lastFilePath],
	);

	const updatePreviewUrl = (value: string) => {
		setPreviewUrl(value);
		setOpenTabs((current) =>
			current.map((tab) =>
				tab.type === "preview" ? { ...tab, url: value } : tab,
			),
		);
	};

	const handleProjectChange = (projectId: string) => {
		setSelectedProjectId(projectId);
		setOpenTabs([]);
		setActiveTabId(null);
		setLastFilePath(null);
		setFileContents({});
		setDirtyFiles(new Set());
		setSearchQuery("");
		setConsoleEntries([]);
		setConsoleInput("");
		setConsoleHistory([]);
		setConsoleHistoryIndex(null);
		setIsRunning(false);
	};

	const onPathRenamed = (fromPath: string, toPath: string) => {
		setLastFilePath((current) =>
			current ? replacePathPrefix(current, fromPath, toPath) : current,
		);
		setOpenTabs((current) =>
			current.map((tab) =>
				tab.type === "file"
					? {
							...tab,
							path: replacePathPrefix(tab.path, fromPath, toPath),
							name: fileName(replacePathPrefix(tab.path, fromPath, toPath)),
						}
					: tab,
			),
		);
		setFileContents((current) => {
			const next: Record<string, string> = {};
			for (const [path, content] of Object.entries(current))
				next[replacePathPrefix(path, fromPath, toPath)] = content;
			return next;
		});
		setDirtyFiles(
			(current) =>
				new Set(
					Array.from(current, (path) =>
						replacePathPrefix(path, fromPath, toPath),
					),
				),
		);
		setActiveTabId((current) =>
			current?.startsWith("file:")
				? `file:${replacePathPrefix(current.slice(5), fromPath, toPath)}`
				: current,
		);
	};

	const onPathDeleted = (path: string) => {
		setOpenTabs((current) =>
			current.filter(
				(tab) =>
					tab.type !== "file" ||
					(tab.path !== path && !tab.path.startsWith(`${path}/`)),
			),
		);
		setFileContents((current) =>
			Object.fromEntries(
				Object.entries(current).filter(
					([entryPath]) =>
						entryPath !== path && !entryPath.startsWith(`${path}/`),
				),
			),
		);
		setDirtyFiles(
			(current) =>
				new Set(
					Array.from(current).filter(
						(entryPath) =>
							entryPath !== path && !entryPath.startsWith(`${path}/`),
					),
				),
		);
		setLastFilePath((current) =>
			current === path || current?.startsWith(`${path}/`) ? null : current,
		);
		setActiveTabId((current) =>
			current?.startsWith(`file:${path}`) ? null : current,
		);
	};

	const runCommand = useCallback(
		async (command: string) => {
			const trimmed = command.trim();
			if (!trimmed || !selectedProjectId) return;
			openToolTab("console");
			pushConsole(`$ ${trimmed}`, "default");
			setConsoleHistory((current) => [...current, trimmed]);
			setConsoleHistoryIndex(null);
			setConsoleInput("");
			setIsRunning(true);
			const controller = new AbortController();
			execAbortRef.current = controller;
			try {
				const result = await api.projectWorkspace.exec(
					selectedProjectId,
					{ command: trimmed },
					{ signal: controller.signal },
				);
				if (result.stdout) pushConsole(result.stdout, "default");
				if (result.stderr) pushConsole(result.stderr, "error");
				pushConsole(
					result.exitCode === 0
						? `✔ Exit code ${result.exitCode}`
						: `✘ Exit code ${result.exitCode}`,
					result.exitCode === 0 ? "success" : "error",
				);
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					pushConsole("Command aborted", "muted");
				} else {
					pushConsole(
						`Error: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
			} finally {
				execAbortRef.current = null;
				setIsRunning(false);
			}
		},
		[openToolTab, pushConsole, selectedProjectId],
	);

	const stopCommand = useCallback(async () => {
		execAbortRef.current?.abort();
		execAbortRef.current = null;
		setIsRunning(false);
		if (!selectedProjectId) return;
		try {
			await api.projectWorkspace.stopExec(selectedProjectId);
			pushConsole("■ Process stopped", "error");
		} catch (error) {
			pushConsole(
				`Error stopping: ${error instanceof Error ? error.message : "Unknown"}`,
				"error",
			);
		}
	}, [pushConsole, selectedProjectId]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const isShortcut = event.metaKey || event.ctrlKey;
			if (!isShortcut) return;
			if (event.key.toLowerCase() === "s") {
				if (activeFilePath && isDirty && !saveFileMut.isPending) {
					event.preventDefault();
					saveFileMut.mutate();
				}
			}
			if (event.key.toLowerCase() === "p") {
				event.preventDefault();
				openToolTab("search");
			}
			if (event.key.toLowerCase() === "f") {
				event.preventDefault();
				openToolTab("search");
			}
			if (event.key === "`") {
				event.preventDefault();
				openToolTab("console");
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeFilePath, isDirty, openToolTab, saveFileMut]);

	const activeRailItem: RailAction | null = explorerOpen
		? "files"
		: activeTab &&
				activeTab.type !== "file" &&
				activeTab.type !== "console" &&
				activeTab.type !== "preview"
			? activeTab.type
			: null;

	const renderDeployTab = () => {
		const deployScripts =
			packageSummary?.scripts.filter(([name]) =>
				/deploy|build|start|preview/i.test(name),
			) ?? [];
		return (
			<div className="grid h-full min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-[360px_minmax(0,1fr)]">
				<section
					className="rounded-lg border"
					style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
				>
					<div
						className="border-b px-3 py-2"
						style={{ borderColor: REPLIT.border }}
					>
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							Deploy actions
						</p>
					</div>
					<div className="space-y-3 p-3">
						{deployScripts.length === 0 ? (
							<p className="text-sm text-[#9DA2A6]">
								No obvious deploy scripts found. Use Console for custom
								commands.
							</p>
						) : null}
						{deployScripts.map(([name, value]) => (
							<div
								key={name}
								className="rounded-md border px-3 py-3"
								style={{
									borderColor: REPLIT.border,
									backgroundColor: REPLIT.background,
								}}
							>
								<div className="flex items-center justify-between gap-3">
									<div>
										<p className="font-mono text-sm text-white">
											npm run {name}
										</p>
										<p className="mt-1 font-mono text-[11px] text-[#5F6B7A]">
											{value}
										</p>
									</div>
									<button
										type="button"
										onClick={() => runCommand(`npm run ${name}`)}
										className="rounded-md px-3 py-2 text-xs font-semibold text-white"
										style={{ backgroundColor: REPLIT.accent }}
									>
										Run
									</button>
								</div>
							</div>
						))}
						<button
							type="button"
							onClick={() => openToolTab("preview")}
							className="w-full rounded-md border px-3 py-2 text-sm text-white"
							style={{
								borderColor: REPLIT.border,
								backgroundColor: REPLIT.panelAlt,
							}}
						>
							Open Preview tab
						</button>
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
							Release notes
						</p>
					</div>
					<div className="space-y-3 p-3 text-sm text-[#9DA2A6]">
						<p>
							Deploy runs from the real project workspace through the exec API.
							Use a script above or open Console for custom deployment commands.
						</p>
						<div
							className="rounded-md border px-3 py-3"
							style={{
								borderColor: REPLIT.border,
								backgroundColor: REPLIT.background,
							}}
						>
							<p className="text-xs uppercase tracking-[0.18em] text-[#5F6B7A]">
								Preview URL
							</p>
							<p className="mt-2 font-mono text-sm text-white">{previewUrl}</p>
						</div>
					</div>
				</section>
			</div>
		);
	};

	const mainContent = () => {
		if (!selectedProject) {
			return (
				<div className="flex h-full items-center justify-center text-sm text-[#9DA2A6]">
					Select a project to open the IDE.
				</div>
			);
		}

		if (!activeTab) {
			return (
				<FilesPageEmptyState
					onOpenSearch={() => openToolTab("search")}
					onToggleExplorer={() => setExplorerOpen((current) => !current)}
				/>
			);
		}

		if (activeTab.type === "file") {
			if (fileQuery.isPending) {
				return (
					<div className="flex h-full items-center justify-center text-[#9DA2A6]">
						<Loader2 className="h-5 w-5 animate-spin" />
					</div>
				);
			}
			return (
				<FileEditorPane
					filePath={activeTab.path}
					currentContent={currentContent}
					fileData={currentFileData}
					canEdit={canEditCurrentFile}
					hasWorkspace={hasWorkspace}
					isDirty={isDirty}
					onChange={(value) => {
						setFileContents((current) => ({
							...current,
							[activeTab.path]: value,
						}));
						setDirtyFiles((current) => new Set(current).add(activeTab.path));
					}}
					onSave={() => saveFileMut.mutate()}
					onCursorChange={setCursorPosition}
					editorSettings={editorSettings}
					jumpTarget={jumpTarget}
					onOpenPreview={() => openToolTab("preview")}
					onOpenConsole={() => openToolTab("console")}
				/>
			);
		}

		if (activeTab.type === "git")
			return (
				<GitPanel
					projectId={selectedProjectId}
					hasWorkspace={hasWorkspace}
					currentBranch={currentBranch}
					onOpenFile={openFile}
					onToast={showToast}
				/>
			);
		if (activeTab.type === "console")
			return (
				<ConsolePanel
					entries={consoleEntries}
					input={consoleInput}
					onInputChange={setConsoleInput}
					onInputKeyDown={(event) => {
						if (event.key === "Enter") runCommand(consoleInput);
						if (event.key === "ArrowUp") {
							event.preventDefault();
							setConsoleHistoryIndex((current) => {
								const next =
									current === null
										? consoleHistory.length - 1
										: Math.max(current - 1, 0);
								setConsoleInput(consoleHistory[next] ?? "");
								return next >= 0 ? next : null;
							});
						}
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setConsoleHistoryIndex((current) => {
								if (current === null) return null;
								const next = current + 1;
								if (next >= consoleHistory.length) {
									setConsoleInput("");
									return null;
								}
								setConsoleInput(consoleHistory[next] ?? "");
								return next;
							});
						}
					}}
					onRun={() => runCommand(consoleInput)}
					onStop={stopCommand}
					isRunning={isRunning}
					scripts={packageSummary?.scripts ?? []}
					onRunScript={(script) => runCommand(`npm run ${script}`)}
					workspacePath={selectedProject.workspacePath}
				/>
			);
		if (activeTab.type === "search")
			return (
				<SearchPanel
					projectId={selectedProjectId}
					hasWorkspace={hasWorkspace}
					query={searchQuery}
					onQueryChange={setSearchQuery}
					onOpenFile={openFile}
				/>
			);
		if (activeTab.type === "vault")
			return <VaultPanel projectId={selectedProjectId} onToast={showToast} />;
		if (activeTab.type === "packages")
			return (
				<PackagesPanel
					projectId={selectedProjectId}
					hasWorkspace={hasWorkspace}
					onOpenFile={openFile}
					onRunScript={(script) => runCommand(`npm run ${script}`)}
				/>
			);
		if (activeTab.type === "tools")
			return <ToolsPanel projectId={selectedProjectId} onToast={showToast} />;
		if (activeTab.type === "database")
			return <DatabasePanel projectId={selectedProjectId} />;
		if (activeTab.type === "settings")
			return (
				<SettingsPanel
					project={selectedProject}
					currentBranch={currentBranch}
					settings={editorSettings}
					onSettingsChange={setEditorSettings}
					onToast={showToast}
				/>
			);
		if (activeTab.type === "preview")
			return (
				<PreviewPanel
					url={activeTab.url}
					onUrlChange={updatePreviewUrl}
					filePath={null}
					currentContent=""
				/>
			);
		if (activeTab.type === "deploy") return renderDeployTab();
		return null;
	};

	return (
		<div
			className="flex h-full min-h-0 flex-col overflow-hidden"
			style={{ backgroundColor: REPLIT.background, color: REPLIT.text }}
		>
			<TopBar
				projects={projects}
				selectedProjectId={selectedProjectId}
				onSelectProject={handleProjectChange}
				isRunning={isRunning}
				onOpenSearch={() => openToolTab("search")}
				onOpenDeploy={() => openToolTab("deploy")}
				onOpenConsole={() => openToolTab("console")}
			/>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<IconRail
					activeItem={activeRailItem}
					onSelect={(item) => {
						if (item === "files") {
							setExplorerOpen((current) => !current);
							return;
						}
						openToolTab(item);
						setExplorerOpen(false);
					}}
					userInitial={selectedProject?.name?.slice(0, 1) ?? "U"}
				/>

				<div
					className={cn(
						"overflow-hidden border-r transition-all duration-200",
						explorerOpen ? "w-[260px] min-w-[260px]" : "w-0 min-w-0 border-r-0",
					)}
					style={{
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.background,
					}}
				>
					{selectedProjectId && explorerOpen ? (
						<FileTree
							projectId={selectedProjectId}
							workspacePath={selectedProject?.workspacePath}
							hasWorkspace={hasWorkspace}
							selectedFile={activeFilePath}
							onOpenFile={openFile}
							onCreated={(path, entity) => {
								if (entity === "file") openFile(path);
								qc.invalidateQueries({
									queryKey: ["git-status", selectedProjectId],
								});
							}}
							onRenamed={onPathRenamed}
							onDeleted={onPathDeleted}
							onToast={showToast}
						/>
					) : null}
				</div>

				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<TabBar
						tabs={tabs}
						activeTabId={activeTabId}
						onSelect={setActiveTabId}
						onClose={closeTab}
					/>
					<div
						className="min-h-0 flex-1 overflow-hidden"
						style={{ backgroundColor: REPLIT.panelAlt }}
					>
						{mainContent()}
					</div>
				</div>
			</div>

			<div
				className="flex h-6 items-center gap-4 border-t px-3 text-[11px] text-[#9DA2A6]"
				style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
			>
				<span>{extensionLabel(activeFilePath)}</span>
				<span>
					Ln {cursorPosition.line}, Col {cursorPosition.column}
				</span>
				<span> {currentBranch}</span>
				<span className="ml-auto">
					{dirtyFiles.size > 0
						? `${dirtyFiles.size} unsaved`
						: "All changes saved"}
				</span>
			</div>

			{toast ? (
				<div
					className="pointer-events-none fixed bottom-10 right-4 z-50 rounded-md border px-3 py-2 text-sm shadow-xl"
					style={{
						borderColor:
							toast.type === "err"
								? "rgba(255,82,82,0.3)"
								: "rgba(0,200,83,0.3)",
						backgroundColor:
							toast.type === "err"
								? "rgba(255,82,82,0.14)"
								: "rgba(0,200,83,0.12)",
						color: toast.type === "err" ? "#FFB4B4" : "#C8E6C9",
					}}
				>
					{toast.msg}
				</div>
			) : null}
		</div>
	);
}
