import { ChevronDown, Rocket, Search } from "lucide-react";
import type { Project } from "../../lib/api";
import { REPLIT } from "./types";

interface TopBarProps {
	projects: Project[];
	selectedProjectId: string;
	onSelectProject: (projectId: string) => void;
	isRunning: boolean;
	onOpenSearch: () => void;
	onOpenDeploy: () => void;
	onOpenConsole: () => void;
}

export function TopBar({
	projects,
	selectedProjectId,
	onSelectProject,
	isRunning,
	onOpenSearch,
	onOpenDeploy,
	onOpenConsole,
}: TopBarProps) {
	return (
		<header
			className="flex h-12 items-center justify-between gap-3 border-b px-3"
			style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.background }}
		>
			<div className="flex min-w-0 items-center gap-3">
				<div className="relative min-w-[220px] max-w-[320px]">
					<select
						value={selectedProjectId}
						onChange={(event) => onSelectProject(event.target.value)}
						className="h-9 w-full appearance-none rounded-md border px-3 pr-8 text-sm outline-none"
						style={{
							borderColor: REPLIT.border,
							backgroundColor: REPLIT.panel,
							color: REPLIT.text,
						}}
					>
						{projects.length === 0 ? (
							<option value="">No projects</option>
						) : null}
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.name}
							</option>
						))}
					</select>
					<ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5F6B7A]" />
				</div>
				<button
					type="button"
					onClick={onOpenConsole}
					className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-[#3B82F6]"
					style={{
						borderColor: isRunning ? "rgba(0, 200, 83, 0.28)" : REPLIT.border,
						backgroundColor: isRunning
							? "rgba(0, 200, 83, 0.08)"
							: REPLIT.panel,
						color: isRunning ? "#B9F6CA" : REPLIT.secondary,
					}}
				>
					<span
						className="h-2 w-2 rounded-full"
						style={{
							backgroundColor: isRunning ? REPLIT.success : REPLIT.muted,
						}}
					/>
					{isRunning ? "Running" : "Stopped"}
				</button>
			</div>

			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onOpenSearch}
					className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-[#9DA2A6] transition-colors hover:text-[#2b2418]"
					style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
					aria-label="Open search"
					title="Search"
				>
					<Search className="h-4 w-4" />
				</button>
				<button
					type="button"
					onClick={onOpenDeploy}
					className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#2b2418] transition-colors hover:bg-[#0A84FF]"
					style={{ backgroundColor: REPLIT.accent }}
				>
					<Rocket className="h-4 w-4" />
					Deploy
				</button>
			</div>
		</header>
	);
}
