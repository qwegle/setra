import { ExternalLink, Globe } from "lucide-react";
import { REPLIT } from "./types";

interface PreviewPanelProps {
	url: string;
	onUrlChange: (value: string) => void;
	filePath: string | null;
	currentContent: string;
}

export function PreviewPanel({ url, onUrlChange }: PreviewPanelProps) {
	return (
		<div
			className="flex h-full min-h-0 flex-col items-center justify-center gap-6 p-8"
			style={{ backgroundColor: REPLIT.panelAlt }}
		>
			<Globe className="h-16 w-16" style={{ color: REPLIT.muted }} />
			<div className="text-center">
				<h3 className="text-lg font-semibold" style={{ color: REPLIT.text }}>
					Preview in Browser
				</h3>
				<p className="mt-2 text-sm" style={{ color: REPLIT.secondary }}>
					Your app runs locally — open it in your browser for the best
					experience.
				</p>
			</div>
			<div className="flex items-center gap-3">
				<input
					value={url}
					onChange={(event) => onUrlChange(event.target.value)}
					className="h-10 w-72 rounded-md border px-3 font-mono text-sm text-white outline-none transition focus:border-[#0079F2]"
					style={{
						borderColor: REPLIT.border,
						backgroundColor: REPLIT.background,
					}}
					placeholder="http://localhost:3000"
				/>
				<button
					type="button"
					onClick={() => window.open(url, "_blank")}
					className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition hover:opacity-90"
					style={{ backgroundColor: REPLIT.accent }}
				>
					<ExternalLink className="h-4 w-4" /> Open in Browser
				</button>
			</div>
			<p className="text-xs" style={{ color: REPLIT.muted }}>
				Tip: Start your dev server from the Console tab, then click "Open in
				Browser"
			</p>
		</div>
	);
}
