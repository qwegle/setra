import { type ChildProcess, exec } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getCompanyId } from "../lib/company-scope.js";
import * as projectsRepo from "../repositories/projects.repo.js";

export const projectWorkspaceRoute = new Hono();

const IGNORED = new Set([
	".git",
	"node_modules",
	".next",
	".turbo",
	"dist",
	"build",
	"coverage",
	".DS_Store",
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	webp: "image/webp",
};

const blockedCommandPatterns = [
	/\bsudo\b/i,
	/\brm\s+-rf\s+\/$/i,
	/\brm\s+-rf\s+\/\s/i,
	/\brm\s+-rf\s+--no-preserve-root\b/i,
	/\bmkfs(?:\.[a-z0-9_+-]+)?\b/i,
	/\bdd\s+if=/i,
	/\bshutdown\b/i,
	/\breboot\b/i,
	/\bhalt\b/i,
	/:\s*\(\)\s*\{\s*:.*\|.*;\s*\}/,
];

const ExecSchema = z.object({
	command: z.string().trim().min(1, "Command is required"),
	cwd: z.string().trim().optional(),
});

const GitPathSchema = z.object({
	path: z.string().trim().min(1, "Path is required"),
});

const BranchSchema = z.object({
	branch: z.string().trim().min(1, "Branch is required"),
});

const StashSchema = z.object({
	message: z.string().trim().optional(),
});

const activeProcesses = new Map<string, ChildProcess>();

function getWorkspaceRoot(projectId: string, companyId: string): string {
	const project = projectsRepo.getProjectFull(projectId);
	if (!project || project.companyId !== companyId) {
		throw new Error("project not found");
	}
	const root = project.workspacePath?.trim();
	if (!root) throw new Error("workspace is not configured for this project");
	if (!path.isAbsolute(root))
		throw new Error("workspace path must be absolute");
	const stat = statSync(root, { throwIfNoEntry: false });
	if (!stat || !stat.isDirectory()) {
		throw new Error("workspace path does not exist");
	}
	return root;
}

function resolveInsideWorkspace(root: string, relativePath?: string): string {
	if (!relativePath) return path.resolve(root);
	const candidate = path.isAbsolute(relativePath)
		? path.resolve(relativePath)
		: path.resolve(root, relativePath.replace(/^\/+/, ""));
	const normalizedRoot = path.resolve(root);
	if (
		!(
			candidate === normalizedRoot ||
			candidate.startsWith(`${normalizedRoot}${path.sep}`)
		)
	) {
		throw new Error("path is outside workspace");
	}
	return candidate;
}

function commandKey(companyId: string, projectId: string): string {
	return `${companyId}:${projectId}`;
}

function sanitizeCommand(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) throw new Error("command is required");
	if (trimmed.length > 2000) throw new Error("command is too long");
	for (const pattern of blockedCommandPatterns) {
		if (pattern.test(trimmed)) {
			throw new Error("command is not allowed");
		}
	}
	return trimmed;
}

function fileExt(filePath: string): string {
	return path.extname(filePath).slice(1).toLowerCase();
}

function isProbablyBinary(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
	if (sample.includes(0)) return true;
	let suspicious = 0;
	for (const byte of sample) {
		if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
	}
	return sample.length > 0 && suspicious / sample.length > 0.2;
}

function searchDirectory(
	root: string,
	dir: string,
	query: string,
	results: Array<{
		path: string;
		matches: Array<{
			line: number;
			column: number;
			preview: string;
			before: string | null;
			after: string | null;
		}>;
	}>,
	limit: number,
): void {
	if (results.length >= limit) return;
	const entries = readdirSync(dir, { withFileTypes: true }).filter(
		(entry) => !IGNORED.has(entry.name),
	);
	for (const entry of entries) {
		if (results.length >= limit) return;
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			searchDirectory(root, abs, query, results, limit);
			continue;
		}
		const stats = statSync(abs, { throwIfNoEntry: false });
		if (!stats?.isFile() || stats.size > 1024 * 1024) continue;
		const buffer = readFileSync(abs);
		if (isProbablyBinary(buffer)) continue;
		const content = buffer.toString("utf8");
		const lines = content.split(/\r?\n/);
		const matches: Array<{
			line: number;
			column: number;
			preview: string;
			before: string | null;
			after: string | null;
		}> = [];
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index] ?? "";
			const lowered = line.toLowerCase();
			const column = lowered.indexOf(query);
			if (column === -1) continue;
			matches.push({
				line: index + 1,
				column: column + 1,
				preview: line.trim() || line,
				before: index > 0 ? (lines[index - 1] ?? null) : null,
				after: index < lines.length - 1 ? (lines[index + 1] ?? null) : null,
			});
			if (matches.length >= 8) break;
		}
		if (matches.length > 0) {
			results.push({
				path: path.relative(root, abs).replaceAll(path.sep, "/"),
				matches,
			});
		}
	}
}

projectWorkspaceRoute.get("/:projectId/files/search", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const rawQuery = c.req.query("q")?.trim() ?? "";
		if (!rawQuery) return c.json({ error: "q is required" }, 400);
		const root = getWorkspaceRoot(projectId, companyId);
		const results: Array<{
			path: string;
			matches: Array<{
				line: number;
				column: number;
				preview: string;
				before: string | null;
				after: string | null;
			}>;
		}> = [];
		searchDirectory(root, root, rawQuery.toLowerCase(), results, 40);
		return c.json({ query: rawQuery, results });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to search workspace";
		const status =
			message === "project not found"
				? 404
				: message.includes("workspace") || message.includes("path")
					? 422
					: 500;
		return c.json({ error: message }, status);
	}
});

projectWorkspaceRoute.post(
	"/:projectId/exec",
	zValidator("json", ExecSchema),
	async (c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const { command, cwd } = c.req.valid("json");
			const root = getWorkspaceRoot(projectId, companyId);
			const execCwd = resolveInsideWorkspace(root, cwd);
			const safeCommand = sanitizeCommand(command);
			const key = commandKey(companyId, projectId);
			const existing = activeProcesses.get(key);
			if (existing && existing.exitCode === null && !existing.killed) {
				existing.kill("SIGTERM");
			}

			const result = await new Promise<{
				stdout: string;
				stderr: string;
				exitCode: number;
				timedOut: boolean;
				pid: number | null;
			}>((resolve, reject) => {
				const child = exec(
					safeCommand,
					{
						cwd: execCwd,
						timeout: 30_000,
						maxBuffer: 4 * 1024 * 1024,
						shell: "/bin/bash",
						windowsHide: true,
					},
					(error, stdout, stderr) => {
						if (activeProcesses.get(key) === child) activeProcesses.delete(key);
						if (
							error &&
							typeof error === "object" &&
							"code" in error &&
							String(error.code) === "ENOENT"
						) {
							reject(new Error("shell is not available"));
							return;
						}
						resolve({
							stdout,
							stderr,
							exitCode:
								typeof error === "object" &&
								error &&
								"code" in error &&
								typeof error.code === "number"
									? error.code
									: 0,
							timedOut: Boolean(
								error &&
									typeof error === "object" &&
									"killed" in error &&
									error.killed,
							),
							pid: child.pid ?? null,
						});
					},
				);
				activeProcesses.set(key, child);
			});

			return c.json(result);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "failed to execute command";
			const status =
				message === "project not found"
					? 404
					: message.includes("workspace") ||
							message.includes("path") ||
							message.includes("command")
						? 422
						: 500;
			return c.json({ error: message }, status);
		}
	},
);

projectWorkspaceRoute.post("/:projectId/exec/stop", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		getWorkspaceRoot(projectId, companyId);
		const key = commandKey(companyId, projectId);
		const active = activeProcesses.get(key);
		if (!active || active.exitCode !== null || active.killed) {
			activeProcesses.delete(key);
			return c.json({ ok: false, message: "No active process" });
		}
		active.kill("SIGTERM");
		return c.json({ ok: true, pid: active.pid ?? null });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to stop process";
		const status =
			message === "project not found"
				? 404
				: message.includes("workspace")
					? 422
					: 500;
		return c.json({ error: message }, status);
	}
});
