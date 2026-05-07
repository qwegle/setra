import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	File,
	FileCode2,
	FileJson2,
	FilePlus2,
	Folder,
	FolderOpen,
	FolderPlus,
	Loader2,
	Search,
	Trash2,
} from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { type FileTreeEntry, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button, Modal } from "../ui";
import { REPLIT, fileExt } from "./types";

type PathDialogState = {
	mode: "create" | "rename";
	entity: "file" | "folder";
	value: string;
	title: string;
	description: string;
};

type ContextMenuState = {
	x: number;
	y: number;
	node: FileTreeEntry;
};

interface FileTreeProps {
	projectId: string;
	workspacePath?: string | null | undefined;
	hasWorkspace: boolean;
	selectedFile: string | null;
	onOpenFile: (path: string) => void;
	onCreated?: (path: string, entity: "file" | "folder") => void;
	onRenamed?: (fromPath: string, toPath: string) => void;
	onDeleted?: (path: string) => void;
	onToast?: (message: string, type?: "ok" | "err") => void;
}

function collectOpenFolders(
	nodes: FileTreeEntry[],
	depth = 0,
	folders = new Set<string>(),
): Set<string> {
	for (const node of nodes) {
		if (node.type === "dir") {
			if (depth < 1) folders.add(node.path);
			collectOpenFolders(node.children ?? [], depth + 1, folders);
		}
	}
	return folders;
}

function filterTree(nodes: FileTreeEntry[], query: string): FileTreeEntry[] {
	if (!query.trim()) return nodes;
	const lowered = query.trim().toLowerCase();
	return nodes.reduce<FileTreeEntry[]>((acc, node) => {
		if (node.type === "dir") {
			const children = filterTree(node.children ?? [], lowered);
			if (node.name.toLowerCase().includes(lowered) || children.length > 0) {
				acc.push({ ...node, children });
			}
			return acc;
		}
		if (
			node.name.toLowerCase().includes(lowered) ||
			node.path.toLowerCase().includes(lowered)
		) {
			acc.push(node);
		}
		return acc;
	}, []);
}

function nodeIcon(node: FileTreeEntry, open = false) {
	if (node.type === "dir")
		return open ? (
			<FolderOpen className="h-4 w-4 text-[#FFCB6B]" />
		) : (
			<Folder className="h-4 w-4 text-[#FFCB6B]" />
		);
	const ext = fileExt(node.name);
	if (
		[
			"ts",
			"tsx",
			"js",
			"jsx",
			"mjs",
			"cjs",
			"css",
			"scss",
			"sass",
			"less",
			"html",
			"md",
			"mdx",
		].includes(ext)
	)
		return <FileCode2 className="h-4 w-4 text-[#4EA1FF]" />;
	if (["json", "yaml", "yml", "toml"].includes(ext))
		return <FileJson2 className="h-4 w-4 text-[#FFB86C]" />;
	return <File className="h-4 w-4 text-[#9DA2A6]" />;
}

function TreeNode({
	node,
	depth,
	selectedFile,
	openFolders,
	searchActive,
	onToggleFolder,
	onOpenFile,
	onContextMenu,
}: {
	node: FileTreeEntry;
	depth: number;
	selectedFile: string | null;
	openFolders: Set<string>;
	searchActive: boolean;
	onToggleFolder: (path: string) => void;
	onOpenFile: (path: string) => void;
	onContextMenu: (
		event: ReactMouseEvent<HTMLDivElement>,
		node: FileTreeEntry,
	) => void;
}) {
	const isDir = node.type === "dir";
	const isOpen = isDir && (searchActive || openFolders.has(node.path));
	const isActive = node.type === "file" && selectedFile === node.path;

	return (
		<div>
			<div
				onContextMenu={(event) => onContextMenu(event, node)}
				className={cn(
					"group flex h-8 items-center gap-2 rounded-md pr-2 text-sm",
					isActive
						? "bg-[#24304A] text-white"
						: "text-[#9DA2A6] hover:bg-[#1C2333] hover:text-white",
				)}
				style={{ paddingLeft: `${12 + depth * 14}px` }}
			>
				<button
					type="button"
					onClick={() =>
						isDir ? onToggleFolder(node.path) : onOpenFile(node.path)
					}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					{isDir ? (
						<ChevronRight
							className={cn(
								"h-4 w-4 shrink-0 text-[#5F6B7A] transition-transform",
								isOpen && "rotate-90",
							)}
						/>
					) : (
						<span className="ml-4" />
					)}
					{nodeIcon(node, isOpen)}
					<span className="truncate text-xs">{node.name}</span>
				</button>
			</div>
			{isDir && isOpen ? (
				<div>
					{(node.children ?? []).length === 0 ? (
						<div
							className="px-6 py-2 text-xs text-[#5F6B7A]"
							style={{ paddingLeft: `${28 + depth * 14}px` }}
						>
							empty folder
						</div>
					) : (
						(node.children ?? []).map((child) => (
							<TreeNode
								key={child.path}
								node={child}
								depth={depth + 1}
								selectedFile={selectedFile}
								openFolders={openFolders}
								searchActive={searchActive}
								onToggleFolder={onToggleFolder}
								onOpenFile={onOpenFile}
								onContextMenu={onContextMenu}
							/>
						))
					)}
				</div>
			) : null}
		</div>
	);
}

export function FileTree({
	projectId,
	workspacePath,
	hasWorkspace,
	selectedFile,
	onOpenFile,
	onCreated,
	onRenamed,
	onDeleted,
	onToast,
}: FileTreeProps) {
	const qc = useQueryClient();
	const [searchQuery, setSearchQuery] = useState("");
	const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
	const [pathDialog, setPathDialog] = useState<PathDialogState | null>(null);
	const [pathValue, setPathValue] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<{
		path: string;
		isDir: boolean;
	} | null>(null);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

	const treeQuery = useQuery<{ root: string; tree: FileTreeEntry[] }, Error>({
		queryKey: ["files-tree", projectId],
		queryFn: () => api.files.tree(projectId),
		enabled: Boolean(projectId && hasWorkspace),
	});

	useEffect(() => {
		setOpenFolders(
			treeQuery.data ? collectOpenFolders(treeQuery.data.tree) : new Set(),
		);
	}, [treeQuery.data]);

	useEffect(() => {
		setPathValue(pathDialog?.value ?? "");
	}, [pathDialog]);

	useEffect(() => {
		const close = () => setContextMenu(null);
		window.addEventListener("click", close);
		return () => window.removeEventListener("click", close);
	}, []);

	const filteredTree = useMemo(
		() => filterTree(treeQuery.data?.tree ?? [], searchQuery),
		[searchQuery, treeQuery.data],
	);

	const createMut = useMutation({
		mutationFn: ({
			entity,
			path,
		}: { entity: "file" | "folder"; path: string }) =>
			entity === "file"
				? api.files.createFile({ projectId, path })
				: api.files.createFolder({ projectId, path }),
		onSuccess: async (_, variables) => {
			setPathDialog(null);
			onToast?.(`${variables.entity === "file" ? "File" : "Folder"} created`);
			onCreated?.(variables.path, variables.entity);
			await qc.invalidateQueries({ queryKey: ["files-tree", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to create path",
				"err",
			),
	});

	const renameMut = useMutation({
		mutationFn: ({ fromPath, toPath }: { fromPath: string; toPath: string }) =>
			api.files.renamePath({ projectId, fromPath, toPath }),
		onSuccess: async ({ fromPath, toPath }) => {
			setPathDialog(null);
			onToast?.("Path renamed");
			onRenamed?.(fromPath, toPath);
			await qc.invalidateQueries({ queryKey: ["files-tree", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to rename path",
				"err",
			),
	});

	const deleteMut = useMutation({
		mutationFn: (path: string) => api.files.deletePath(projectId, path),
		onSuccess: async (_, path) => {
			setDeleteTarget(null);
			onToast?.("Path deleted");
			onDeleted?.(path);
			await qc.invalidateQueries({ queryKey: ["files-tree", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to delete path",
				"err",
			),
	});

	if (!hasWorkspace) {
		return (
			<div className="flex h-full items-center justify-center p-4 text-sm text-[#9DA2A6]">
				Set a workspace path to browse files.
			</div>
		);
	}

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			style={{ backgroundColor: REPLIT.background }}
		>
			<div
				className="border-b px-3 py-3"
				style={{ borderColor: REPLIT.border }}
			>
				<div className="flex items-center justify-between gap-2">
					<span className="truncate text-[11px] uppercase tracking-[0.2em] text-[#5F6B7A]">
						Explorer
					</span>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() =>
								setPathDialog({
									mode: "create",
									entity: "file",
									value: "",
									title: "Create file",
									description: "Create a new file in this workspace.",
								})
							}
							className="rounded-md p-1.5 text-[#9DA2A6] hover:bg-[#1C2333] hover:text-white"
						>
							<FilePlus2 className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() =>
								setPathDialog({
									mode: "create",
									entity: "folder",
									value: "",
									title: "Create folder",
									description: "Create a new folder in this workspace.",
								})
							}
							className="rounded-md p-1.5 text-[#9DA2A6] hover:bg-[#1C2333] hover:text-white"
						>
							<FolderPlus className="h-4 w-4" />
						</button>
					</div>
				</div>
				<p className="mt-1 truncate text-[11px] text-[#5F6B7A]">
					{workspacePath ?? treeQuery.data?.root ?? "Workspace"}
				</p>
				<div className="relative mt-3">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5F6B7A]" />
					<input
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						placeholder="Search files..."
						className="h-9 w-full rounded-md border bg-[#0E1525] pl-9 pr-3 text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-2 py-3">
				{treeQuery.isPending ? (
					<div className="flex items-center justify-center py-10 text-[#9DA2A6]">
						<Loader2 className="h-4 w-4 animate-spin" />
					</div>
				) : treeQuery.isError ? (
					<div
						className="rounded-md border px-3 py-3 text-sm text-[#FFB4B4]"
						style={{
							borderColor: "rgba(255,82,82,0.3)",
							backgroundColor: "rgba(255,82,82,0.1)",
						}}
					>
						{treeQuery.error.message}
					</div>
				) : filteredTree.length === 0 ? (
					<div
						className="rounded-md border px-3 py-4 text-sm text-[#9DA2A6]"
						style={{
							borderColor: REPLIT.border,
							backgroundColor: REPLIT.panelAlt,
						}}
					>
						{searchQuery
							? "No files match your search."
							: "Workspace is empty."}
					</div>
				) : (
					filteredTree.map((node) => (
						<TreeNode
							key={node.path}
							node={node}
							depth={0}
							selectedFile={selectedFile}
							openFolders={openFolders}
							searchActive={Boolean(searchQuery.trim())}
							onToggleFolder={(path) =>
								setOpenFolders((current) => {
									const next = new Set(current);
									if (next.has(path)) next.delete(path);
									else next.add(path);
									return next;
								})
							}
							onOpenFile={onOpenFile}
							onContextMenu={(event, node) => {
								event.preventDefault();
								setContextMenu({ x: event.clientX, y: event.clientY, node });
							}}
						/>
					))
				)}
			</div>

			{contextMenu ? (
				<div
					className="fixed z-50 w-40 rounded-md border p-1 shadow-2xl"
					style={{
						left: contextMenu.x,
						top: contextMenu.y,
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.panelAlt,
					}}
				>
					{contextMenu.node.type === "dir" ? (
						<>
							<button
								type="button"
								onClick={() => {
									setPathDialog({
										mode: "create",
										entity: "file",
										value: `${contextMenu.node.path}/`,
										title: "Create file",
										description: `Create a new file inside ${contextMenu.node.path}.`,
									});
									setContextMenu(null);
								}}
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-white hover:bg-[#1C2333]"
							>
								<FilePlus2 className="h-3.5 w-3.5" />
								New file
							</button>
							<button
								type="button"
								onClick={() => {
									setPathDialog({
										mode: "create",
										entity: "folder",
										value: `${contextMenu.node.path}/`,
										title: "Create folder",
										description: `Create a new folder inside ${contextMenu.node.path}.`,
									});
									setContextMenu(null);
								}}
								className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-white hover:bg-[#1C2333]"
							>
								<FolderPlus className="h-3.5 w-3.5" />
								New folder
							</button>
						</>
					) : null}
					<button
						type="button"
						onClick={() => {
							setPathDialog({
								mode: "rename",
								entity: contextMenu.node.type === "dir" ? "folder" : "file",
								value: contextMenu.node.path,
								title: `Rename ${contextMenu.node.type === "dir" ? "folder" : "file"}`,
								description: `Rename or move ${contextMenu.node.path}.`,
							});
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-white hover:bg-[#1C2333]"
					>
						Rename
					</button>
					<button
						type="button"
						onClick={async () => {
							await navigator.clipboard.writeText(contextMenu.node.path);
							onToast?.("Path copied");
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-white hover:bg-[#1C2333]"
					>
						Copy path
					</button>
					<button
						type="button"
						onClick={() => {
							setDeleteTarget({
								path: contextMenu.node.path,
								isDir: contextMenu.node.type === "dir",
							});
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-[#FF8A80] hover:bg-[#FF5252]/10"
					>
						<Trash2 className="h-3.5 w-3.5" />
						Delete
					</button>
				</div>
			) : null}

			<Modal
				open={Boolean(pathDialog)}
				onClose={() => setPathDialog(null)}
				title={pathDialog?.title ?? "Path"}
				actions={
					<>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setPathDialog(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							loading={createMut.isPending || renameMut.isPending}
							disabled={!pathValue.trim()}
							onClick={() => {
								if (!pathDialog || !pathValue.trim()) return;
								if (pathDialog.mode === "rename") {
									renameMut.mutate({
										fromPath: pathDialog.value,
										toPath: pathValue.trim(),
									});
									return;
								}
								createMut.mutate({
									entity: pathDialog.entity,
									path: pathValue.trim(),
								});
							}}
						>
							{pathDialog?.mode === "rename" ? "Rename" : "Create"}
						</Button>
					</>
				}
			>
				<div className="space-y-4 text-sm text-[#9DA2A6]">
					<p>{pathDialog?.description}</p>
					<input
						autoFocus
						value={pathValue}
						onChange={(event) => setPathValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && pathDialog && pathValue.trim()) {
								if (pathDialog.mode === "rename")
									renameMut.mutate({
										fromPath: pathDialog.value,
										toPath: pathValue.trim(),
									});
								else
									createMut.mutate({
										entity: pathDialog.entity,
										path: pathValue.trim(),
									});
							}
						}}
						className="h-11 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
						placeholder={
							pathDialog?.entity === "folder"
								? "src/components"
								: "src/index.tsx"
						}
					/>
				</div>
			</Modal>

			<Modal
				open={Boolean(deleteTarget)}
				onClose={() => setDeleteTarget(null)}
				title={deleteTarget?.isDir ? "Delete folder" : "Delete file"}
				actions={
					<>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setDeleteTarget(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="danger"
							loading={deleteMut.isPending}
							onClick={() =>
								deleteTarget && deleteMut.mutate(deleteTarget.path)
							}
						>
							Delete
						</Button>
					</>
				}
			>
				<div className="space-y-3 text-sm text-[#9DA2A6]">
					<p>
						Delete{" "}
						<span className="font-semibold text-white">
							{deleteTarget?.path}
						</span>
						?
					</p>
					{deleteTarget?.isDir ? (
						<p className="text-xs text-[#FF8A80]">
							This also removes everything inside the folder.
						</p>
					) : null}
				</div>
			</Modal>
		</div>
	);
}
