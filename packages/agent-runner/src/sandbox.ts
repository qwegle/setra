import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface PendingChange {
	id: string;
	filePath: string;
	originalContent: string | null;
	proposedContent: string;
	operation: "create" | "modify" | "delete";
	agentId: string;
	runId: string;
	createdAt: string;
	status: "pending" | "applied" | "rejected";
}

export class Sandbox {
	private changes: Map<string, PendingChange> = new Map();
	private sandboxDir: string;

	constructor(
		private projectRoot: string,
		private runId: string,
	) {
		this.projectRoot = path.resolve(projectRoot);
		this.sandboxDir = path.join(this.projectRoot, ".setra", "sandbox", runId);
		fs.mkdirSync(this.sandboxDir, { recursive: true });
		this.loadExistingChanges();
	}

	addChange(filePath: string, content: string, agentId: string): PendingChange {
		const absPath = this.resolveProjectPath(filePath);
		const originalContent = fs.existsSync(absPath)
			? fs.readFileSync(absPath, "utf-8")
			: null;
		const operation = originalContent === null ? "create" : "modify";

		const change: PendingChange = {
			id: randomUUID(),
			filePath,
			originalContent,
			proposedContent: content,
			operation,
			agentId,
			runId: this.runId,
			createdAt: new Date().toISOString(),
			status: "pending",
		};

		this.persistChange(change);
		const proposedPath = path.join(this.sandboxDir, "proposed", filePath);
		fs.mkdirSync(path.dirname(proposedPath), { recursive: true });
		fs.writeFileSync(proposedPath, content);

		return change;
	}

	deleteFile(filePath: string, agentId: string): PendingChange {
		const absPath = this.resolveProjectPath(filePath);
		const originalContent = fs.existsSync(absPath)
			? fs.readFileSync(absPath, "utf-8")
			: null;

		const change: PendingChange = {
			id: randomUUID(),
			filePath,
			originalContent,
			proposedContent: "",
			operation: "delete",
			agentId,
			runId: this.runId,
			createdAt: new Date().toISOString(),
			status: "pending",
		};

		this.persistChange(change);
		return change;
	}

	getPendingChanges(): PendingChange[] {
		return Array.from(this.changes.values()).filter(
			(change) => change.status === "pending",
		);
	}

	getDiff(changeId: string): string {
		const change = this.findChange(changeId);
		if (!change) {
			return "";
		}

		return generateUnifiedDiff(
			change.filePath,
			change.originalContent ?? "",
			change.proposedContent,
		);
	}

	getAllDiffs(): string {
		return this.getPendingChanges()
			.map((change) =>
				generateUnifiedDiff(
					change.filePath,
					change.originalContent ?? "",
					change.proposedContent,
				),
			)
			.join("\n");
	}

	applyChange(changeId: string): void {
		const change = this.findChange(changeId);
		if (!change || change.status !== "pending") {
			return;
		}

		const absPath = this.resolveProjectPath(change.filePath);
		if (change.operation === "delete") {
			if (fs.existsSync(absPath)) {
				fs.unlinkSync(absPath);
			}
		} else {
			fs.mkdirSync(path.dirname(absPath), { recursive: true });
			fs.writeFileSync(absPath, change.proposedContent);
		}
		change.status = "applied";
		this.writeMetadata(change);
	}

	applyAll(): void {
		for (const change of this.getPendingChanges()) {
			this.applyChange(change.id);
		}
	}

	rejectChange(changeId: string): void {
		const change = this.findChange(changeId);
		if (!change || change.status !== "pending") {
			return;
		}
		change.status = "rejected";
		this.writeMetadata(change);
	}

	rejectAll(): void {
		for (const change of this.getPendingChanges()) {
			this.rejectChange(change.id);
		}
	}

	cleanup(): void {
		if (fs.existsSync(this.sandboxDir)) {
			fs.rmSync(this.sandboxDir, { recursive: true, force: true });
		}
		this.changes.clear();
	}

	private findChange(changeId: string): PendingChange | undefined {
		return Array.from(this.changes.values()).find(
			(change) => change.id === changeId,
		);
	}

	private loadExistingChanges(): void {
		const entries = fs
			.readdirSync(this.sandboxDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));

		for (const entry of entries) {
			const raw = fs.readFileSync(
				path.join(this.sandboxDir, entry.name),
				"utf-8",
			);
			const change = JSON.parse(raw) as PendingChange;
			this.changes.set(change.filePath, change);
		}
	}

	private persistChange(change: PendingChange): void {
		this.changes.set(change.filePath, change);
		this.writeMetadata(change);
	}

	private writeMetadata(change: PendingChange): void {
		const metaPath = path.join(this.sandboxDir, `${change.id}.json`);
		fs.writeFileSync(metaPath, JSON.stringify(change, null, 2));
	}

	private resolveProjectPath(filePath: string): string {
		const absPath = path.resolve(this.projectRoot, filePath);
		const relativePath = path.relative(this.projectRoot, absPath);
		if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
			throw new Error(`Sandbox path escapes project root: ${filePath}`);
		}
		return absPath;
	}
}

function generateUnifiedDiff(
	filePath: string,
	original: string,
	proposed: string,
): string {
	const origLines = original.split("\n");
	const propLines = proposed.split("\n");

	let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;
	const maxLen = Math.max(origLines.length, propLines.length);
	let hunkStart = -1;
	let hunkLines: string[] = [];

	for (let index = 0; index < maxLen; index++) {
		const orig = origLines[index];
		const prop = propLines[index];

		if (orig !== prop) {
			if (hunkStart === -1) {
				hunkStart = index;
			}
			if (orig !== undefined) {
				hunkLines.push(`-${orig}`);
			}
			if (prop !== undefined) {
				hunkLines.push(`+${prop}`);
			}
			continue;
		}

		if (hunkLines.length > 0) {
			diff += `@@ -${hunkStart + 1} +${hunkStart + 1} @@\n`;
			diff += `${hunkLines.join("\n")}\n`;
			hunkLines = [];
			hunkStart = -1;
		}
	}

	if (hunkLines.length > 0) {
		diff += `@@ -${hunkStart + 1} +${hunkStart + 1} @@\n`;
		diff += `${hunkLines.join("\n")}\n`;
	}

	return diff;
}
