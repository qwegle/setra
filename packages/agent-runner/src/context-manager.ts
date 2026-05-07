import * as fs from "node:fs";
import * as path from "node:path";

export interface ContextItem {
	type: "file" | "directory" | "url" | "note" | "image";
	path: string;
	content?: string;
	tokenEstimate: number;
	addedAt: string;
}

export class ContextManager {
	private items: Map<string, ContextItem> = new Map();

	constructor(private projectRoot: string) {
		this.projectRoot = path.resolve(projectRoot);
	}

	addFile(filePath: string): ContextItem | null {
		const absPath = this.resolveProjectPath(filePath);
		if (!fs.existsSync(absPath)) {
			return null;
		}

		const stat = fs.statSync(absPath);
		if (stat.isDirectory()) {
			return this.addDirectory(filePath);
		}

		const content = fs.readFileSync(absPath, "utf-8");
		const item: ContextItem = {
			type: "file",
			path: filePath,
			content,
			tokenEstimate: Math.ceil(content.length / 4),
			addedAt: new Date().toISOString(),
		};
		this.items.set(filePath, item);
		return item;
	}

	addDirectory(dirPath: string, maxDepth = 3): ContextItem | null {
		const absPath = this.resolveProjectPath(dirPath);
		if (!fs.existsSync(absPath)) {
			return null;
		}

		const listing = this.listDir(absPath, maxDepth);
		const item: ContextItem = {
			type: "directory",
			path: dirPath,
			content: listing,
			tokenEstimate: Math.ceil(listing.length / 4),
			addedAt: new Date().toISOString(),
		};
		this.items.set(dirPath, item);
		return item;
	}

	addNote(key: string, content: string): ContextItem {
		const item: ContextItem = {
			type: "note",
			path: key,
			content,
			tokenEstimate: Math.ceil(content.length / 4),
			addedAt: new Date().toISOString(),
		};
		this.items.set(`note:${key}`, item);
		return item;
	}

	addUrl(url: string, content: string): ContextItem {
		const item: ContextItem = {
			type: "url",
			path: url,
			content,
			tokenEstimate: Math.ceil(content.length / 4),
			addedAt: new Date().toISOString(),
		};
		this.items.set(url, item);
		return item;
	}

	remove(key: string): boolean {
		return this.items.delete(key) || this.items.delete(`note:${key}`);
	}

	getAll(): ContextItem[] {
		return Array.from(this.items.values());
	}

	getTotalTokens(): number {
		return Array.from(this.items.values()).reduce(
			(sum, item) => sum + item.tokenEstimate,
			0,
		);
	}

	buildContextPrompt(): string {
		const parts: string[] = [];

		for (const item of this.items.values()) {
			switch (item.type) {
				case "file":
					parts.push(
						`<file path="${item.path}">\n${item.content ?? ""}\n</file>`,
					);
					break;
				case "directory":
					parts.push(
						`<directory path="${item.path}">\n${item.content ?? ""}\n</directory>`,
					);
					break;
				case "url":
					parts.push(
						`<url href="${item.path}">\n${item.content ?? ""}\n</url>`,
					);
					break;
				case "note":
					parts.push(
						`<note key="${item.path}">\n${item.content ?? ""}\n</note>`,
					);
					break;
				case "image":
					parts.push(`<image path="${item.path}" />`);
					break;
			}
		}

		return parts.join("\n\n");
	}

	static parseAtReferences(input: string): string[] {
		const matches = input.matchAll(/@([^\s,;]+)/g);
		return Array.from(matches, (match) => match[1]).filter(
			(value): value is string => Boolean(value),
		);
	}

	private listDir(absPath: string, maxDepth: number, depth = 0): string {
		if (depth >= maxDepth) {
			return "";
		}

		const entries = fs.readdirSync(absPath, { withFileTypes: true });
		const indent = "  ".repeat(depth);
		let result = "";

		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") {
				continue;
			}
			result += `${indent}${entry.isDirectory() ? "📁" : "📄"} ${entry.name}\n`;
			if (entry.isDirectory()) {
				result += this.listDir(
					path.join(absPath, entry.name),
					maxDepth,
					depth + 1,
				);
			}
		}

		return result;
	}

	private resolveProjectPath(targetPath: string): string {
		const absPath = path.resolve(this.projectRoot, targetPath);
		const relativePath = path.relative(this.projectRoot, absPath);
		if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
			throw new Error(`Context path escapes project root: ${targetPath}`);
		}
		return absPath;
	}
}
