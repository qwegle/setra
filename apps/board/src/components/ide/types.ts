import {
	Database,
	Eye,
	File,
	FileCode2,
	FileJson2,
	GitBranch,
	Lock,
	type LucideIcon,
	Package2,
	PanelLeft,
	Rocket,
	Search,
	Settings2,
	Terminal,
	WandSparkles,
} from "lucide-react";
import type { FileContentResponse } from "../../lib/api";

export const REPLIT = {
	background: "#0E1525",
	panel: "#1C2333",
	panelAlt: "#111827",
	border: "#2B3245",
	active: "#2B3245",
	text: "#F5F9FC",
	secondary: "#9DA2A6",
	muted: "#5F6B7A",
	accent: "#0079F2",
	success: "#00C853",
	successHover: "#00E676",
	danger: "#FF5252",
	warning: "#FFD600",
	selection: "rgba(0, 121, 242, 0.3)",
} as const;

export type ToolTabType =
	| "git"
	| "console"
	| "search"
	| "vault"
	| "packages"
	| "tools"
	| "settings"
	| "preview"
	| "deploy"
	| "database";

export type RailAction = "files" | Exclude<ToolTabType, "console" | "preview">;

export type IDETab =
	| { type: "file"; path: string; name: string; isDirty: boolean }
	| { type: "git" }
	| { type: "console" }
	| { type: "search" }
	| { type: "vault" }
	| { type: "packages" }
	| { type: "tools" }
	| { type: "settings" }
	| { type: "preview"; url: string }
	| { type: "deploy" }
	| { type: "database" };

export type ToastState = { msg: string; type: "ok" | "err" } | null;
export type CursorPosition = { line: number; column: number };
export type JumpTarget = {
	line: number;
	column?: number;
	token: number;
} | null;
export type TerminalEntry = {
	id: string;
	text: string;
	tone?: "default" | "success" | "error" | "muted";
};
export type EditorSettings = {
	fontSize: number;
	tabSize: number;
	wordWrap: boolean;
};

export const TEXT_EXTENSIONS = new Set([
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"css",
	"scss",
	"sass",
	"less",
	"html",
	"md",
	"mdx",
	"txt",
	"yaml",
	"yml",
	"toml",
	"xml",
	"py",
	"go",
	"rs",
	"java",
	"sh",
	"env",
]);

export const RAIL_ITEMS: Array<{
	id: RailAction;
	label: string;
	icon: LucideIcon;
}> = [
	{ id: "files", label: "Files", icon: PanelLeft },
	{ id: "search", label: "Search", icon: Search },
	{ id: "git", label: "Git", icon: GitBranch },
	{ id: "tools", label: "Tools", icon: WandSparkles },
	{ id: "packages", label: "Packages", icon: Package2 },
	{ id: "vault", label: "Vault", icon: Lock },
	{ id: "database", label: "Database", icon: Database },
	{ id: "deploy", label: "Deploy", icon: Rocket },
	{ id: "settings", label: "Settings", icon: Settings2 },
];

const TAB_ICONS: Record<ToolTabType, LucideIcon> = {
	git: GitBranch,
	console: Terminal,
	search: Search,
	vault: Lock,
	packages: Package2,
	tools: WandSparkles,
	settings: Settings2,
	preview: Eye,
	deploy: Rocket,
	database: Database,
};

export function tabId(tab: IDETab): string {
	return tab.type === "file" ? `file:${tab.path}` : `tool:${tab.type}`;
}

export function isFileTab(
	tab: IDETab | null | undefined,
): tab is Extract<IDETab, { type: "file" }> {
	return tab?.type === "file";
}

export function tabTitle(tab: IDETab): string {
	if (tab.type === "file") return tab.name;
	const labels: Record<ToolTabType, string> = {
		git: "Git",
		console: "Console",
		search: "Search",
		vault: "Vault",
		packages: "Packages",
		tools: "Tools",
		settings: "Settings",
		preview: "Preview",
		deploy: "Deploy",
		database: "Database",
	};
	return labels[tab.type];
}

export function tabIcon(tab: IDETab): LucideIcon {
	if (tab.type === "file") {
		const ext = fileExt(tab.name);
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
		) {
			return FileCode2;
		}
		if (["json", "yaml", "yml", "toml"].includes(ext)) return FileJson2;
		return File;
	}
	return TAB_ICONS[tab.type];
}

export function fileExt(name: string): string {
	return name.split(".").pop()?.toLowerCase() ?? "";
}

export function fileName(path: string): string {
	return path.split("/").pop() || path;
}

export function replacePathPrefix(
	path: string,
	fromPath: string,
	toPath: string,
): string {
	if (path === fromPath) return toPath;
	return path.startsWith(`${fromPath}/`)
		? `${toPath}${path.slice(fromPath.length)}`
		: path;
}

export function extensionLabel(path: string | null): string {
	const ext = fileExt(path ?? "");
	if (!ext) return "Plain Text";
	const labels: Record<string, string> = {
		ts: "TypeScript",
		tsx: "TSX",
		js: "JavaScript",
		jsx: "JSX",
		json: "JSON",
		css: "CSS",
		html: "HTML",
		md: "Markdown",
		py: "Python",
		yml: "YAML",
		yaml: "YAML",
		svg: "SVG",
	};
	return labels[ext] ?? ext.toUpperCase();
}

export function isImagePath(filePath: string | null): boolean {
	const ext = fileExt(filePath ?? "");
	return ["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"].includes(ext);
}

export function isSvgPath(filePath: string | null): boolean {
	return fileExt(filePath ?? "") === "svg";
}

export function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildFileDataUrl(
	fileData: FileContentResponse | undefined,
): string | null {
	if (
		!fileData ||
		fileData.encoding !== "base64" ||
		!fileData.content ||
		!fileData.mimeType
	) {
		return null;
	}
	return `data:${fileData.mimeType};base64,${fileData.content}`;
}

export function parsePackageSummary(content: string | null) {
	if (!content) return null;
	try {
		const parsed = JSON.parse(content) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
			scripts?: Record<string, string>;
		};
		return {
			dependencies: Object.entries(parsed.dependencies ?? {}),
			devDependencies: Object.entries(parsed.devDependencies ?? {}),
			scripts: Object.entries(parsed.scripts ?? {}),
		};
	} catch {
		return null;
	}
}
