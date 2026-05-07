import * as fs from "node:fs";
import * as path from "node:path";

export interface PlanEntry {
	id: string;
	timestamp: string;
	action:
		| "task_start"
		| "file_change"
		| "command_exec"
		| "review"
		| "apply"
		| "reject"
		| "checkpoint"
		| "complete"
		| "error";
	agent: string;
	description: string;
	metadata?: Record<string, unknown>;
}

export class PlanHistory {
	private entries: PlanEntry[] = [];
	private logPath: string;

	constructor(projectRoot: string, runId: string) {
		const historyDir = path.join(projectRoot, ".setra", "history");
		fs.mkdirSync(historyDir, { recursive: true });
		this.logPath = path.join(historyDir, `${runId}.jsonl`);

		if (fs.existsSync(this.logPath)) {
			const lines = fs
				.readFileSync(this.logPath, "utf-8")
				.split("\n")
				.filter(Boolean);
			this.entries = lines.map((line) => JSON.parse(line) as PlanEntry);
		}
	}

	log(
		action: PlanEntry["action"],
		agent: string,
		description: string,
		metadata?: Record<string, unknown>,
	): void {
		const entry: PlanEntry = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			timestamp: new Date().toISOString(),
			action,
			agent,
			description,
			...(metadata ? { metadata } : {}),
		};
		this.entries.push(entry);
		fs.appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
	}

	getEntries(filter?: {
		action?: PlanEntry["action"];
		agent?: string;
		since?: string;
	}): PlanEntry[] {
		let result = this.entries;
		if (filter?.action) {
			result = result.filter((entry) => entry.action === filter.action);
		}
		if (filter?.agent) {
			result = result.filter((entry) => entry.agent === filter.agent);
		}
		if (filter?.since) {
			const { since } = filter;
			result = result.filter((entry) => entry.timestamp >= since);
		}
		return result;
	}

	getSummary(): {
		totalActions: number;
		fileChanges: number;
		commands: number;
		errors: number;
		duration: string;
	} {
		const fileChanges = this.entries.filter(
			(entry) => entry.action === "file_change",
		).length;
		const commands = this.entries.filter(
			(entry) => entry.action === "command_exec",
		).length;
		const errors = this.entries.filter(
			(entry) => entry.action === "error",
		).length;

		let duration = "0s";
		if (this.entries.length >= 2) {
			const start = new Date(this.entries[0]!.timestamp).getTime();
			const end = new Date(
				this.entries[this.entries.length - 1]!.timestamp,
			).getTime();
			const seconds = Math.round((end - start) / 1000);
			duration =
				seconds > 60
					? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
					: `${seconds}s`;
		}

		return {
			totalActions: this.entries.length,
			fileChanges,
			commands,
			errors,
			duration,
		};
	}

	formatLog(limit = 50): string {
		const entries = this.entries.slice(-limit);
		return entries
			.map((entry) => {
				const time = entry.timestamp.split("T")[1]?.split(".")[0] ?? "";
				const icon = ACTION_ICONS[entry.action] ?? "•";
				return `${time} ${icon} [${entry.agent}] ${entry.description}`;
			})
			.join("\n");
	}
}

const ACTION_ICONS: Record<string, string> = {
	task_start: "🎯",
	file_change: "📄",
	command_exec: "⚡",
	review: "👁️",
	apply: "✅",
	reject: "❌",
	checkpoint: "📌",
	complete: "🎉",
	error: "💥",
};
