import { Play, Square, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import { REPLIT, type TerminalEntry } from "./types";

interface ConsolePanelProps {
	entries: TerminalEntry[];
	input: string;
	onInputChange: (value: string) => void;
	onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
	onRun: () => void;
	onStop: () => void;
	isRunning: boolean;
	scripts: Array<[string, string]>;
	onRunScript: (script: string) => void;
	workspacePath?: string | null | undefined;
}

export function ConsolePanel({
	entries,
	input,
	onInputChange,
	onInputKeyDown,
	onRun,
	onStop,
	isRunning,
	scripts,
	onRunScript,
	workspacePath,
}: ConsolePanelProps) {
	const endRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [entries]);

	return (
		<div
			className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]"
			style={{ backgroundColor: REPLIT.panelAlt }}
		>
			<div
				className="flex flex-wrap items-center gap-2 border-b px-4 py-3"
				style={{ borderColor: REPLIT.border }}
			>
				<div className="flex items-center gap-2 text-sm text-white">
					<Terminal className="h-4 w-4 text-[#9DA2A6]" />
					<span>Console</span>
					<span
						className="rounded-full border px-2 py-0.5 text-[11px] text-[#9DA2A6]"
						style={{ borderColor: REPLIT.border }}
					>
						{workspacePath ?? "workspace"}
					</span>
				</div>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{scripts.slice(0, 6).map(([name]) => (
						<button
							key={name}
							type="button"
							onClick={() => onRunScript(name)}
							className="rounded-md border px-2.5 py-1 text-xs text-[#9DA2A6] hover:text-white"
							style={{
								borderColor: REPLIT.border,
								backgroundColor: REPLIT.panel,
							}}
						>
							npm run {name}
						</button>
					))}
				</div>
			</div>

			<div className="min-h-0 overflow-auto px-4 py-3 font-mono text-xs">
				{entries.length === 0 ? (
					<div className="text-[#5F6B7A]">
						Run a command to start a real project shell session.
					</div>
				) : null}
				{entries.map((entry) => (
					<div
						key={entry.id}
						className={
							entry.tone === "success"
								? "whitespace-pre-wrap leading-6 text-[#00E676]"
								: entry.tone === "error"
									? "whitespace-pre-wrap leading-6 text-[#FF8A80]"
									: entry.tone === "muted"
										? "whitespace-pre-wrap leading-6 text-[#5F6B7A]"
										: "whitespace-pre-wrap leading-6 text-[#F5F9FC]"
						}
					>
						{entry.text}
					</div>
				))}
				<div ref={endRef} />
			</div>

			<div
				className="border-t px-4 py-3"
				style={{ borderColor: REPLIT.border }}
			>
				<div
					className="flex items-center gap-2 rounded-md border px-3"
					style={{
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.background,
					}}
				>
					<span className="font-mono text-xs text-[#00E676]">$</span>
					<input
						value={input}
						onChange={(event) => onInputChange(event.target.value)}
						onKeyDown={onInputKeyDown}
						placeholder="Run a command…"
						className="h-11 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-[#5F6B7A]"
					/>
					<button
						type="button"
						onClick={isRunning ? onStop : onRun}
						className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold text-white"
						style={{
							backgroundColor: isRunning ? REPLIT.danger : REPLIT.accent,
						}}
					>
						{isRunning ? (
							<Square className="h-3.5 w-3.5" />
						) : (
							<Play className="h-3.5 w-3.5 fill-current" />
						)}
						{isRunning ? "Stop" : "Run"}
					</button>
				</div>
			</div>
		</div>
	);
}
