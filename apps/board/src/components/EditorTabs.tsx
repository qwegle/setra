import { File, FileCode, X } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "../lib/utils";

export interface EditorTab {
	path: string;
	name: string;
	isDirty: boolean;
}

export interface EditorTabsProps {
	tabs: EditorTab[];
	activeTab: string | null;
	onSelect: (path: string) => void;
	onClose: (path: string) => void;
}

const CODE_EXTS = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"py",
	"rb",
	"go",
	"rs",
	"java",
	"c",
	"cpp",
	"h",
	"json",
	"yaml",
	"yml",
	"toml",
	"xml",
	"sh",
	"bash",
	"zsh",
	"fish",
	"css",
	"scss",
	"sass",
	"less",
	"html",
	"htm",
	"svelte",
	"vue",
	"md",
	"mdx",
	"sql",
]);

function fileExt(name: string): string {
	return name.split(".").pop()?.toLowerCase() ?? "";
}

function displayName(tab: EditorTab): string {
	return tab.name || tab.path.split("/").pop() || tab.path;
}

export function EditorTabs({
	tabs,
	activeTab,
	onSelect,
	onClose,
}: EditorTabsProps) {
	const handleMiddleClick = (
		event: MouseEvent<HTMLDivElement>,
		path: string,
	) => {
		if (event.button !== 1) return;
		event.preventDefault();
		event.stopPropagation();
		onClose(path);
	};

	return (
		<div className="border-b border-zinc-800 bg-zinc-950/90">
			<div className="flex items-center overflow-x-auto no-scrollbar">
				{tabs.map((tab) => {
					const name = displayName(tab);
					const isActive = activeTab === tab.path;
					const isCodeFile = CODE_EXTS.has(fileExt(name));

					return (
						<div
							key={tab.path}
							role="tab"
							tabIndex={0}
							aria-selected={isActive}
							title={tab.path}
							onClick={() => onSelect(tab.path)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onSelect(tab.path);
								}
							}}
							onMouseDown={(event) => handleMiddleClick(event, tab.path)}
							className={cn(
								"group flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 font-mono text-xs transition-colors select-none",
								isActive
									? "border-blue-500 bg-zinc-800 text-zinc-100"
									: "border-transparent bg-zinc-900 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200",
							)}
						>
							{isCodeFile ? (
								<FileCode className="h-3.5 w-3.5 shrink-0 text-blue-400/80" />
							) : (
								<File className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
							)}
							<span className="max-w-[160px] truncate">{name}</span>
							{tab.isDirty && (
								<span className="text-[10px] leading-none text-accent-yellow">
									●
								</span>
							)}
							<button
								type="button"
								tabIndex={-1}
								aria-label={`Close ${name}`}
								onClick={(event) => {
									event.stopPropagation();
									onClose(tab.path);
								}}
								className={cn(
									"rounded p-0.5 transition-all hover:bg-black/10 hover:text-foreground",
									tab.isDirty
										? "opacity-100"
										: "opacity-0 group-hover:opacity-100",
								)}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}
