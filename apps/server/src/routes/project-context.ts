import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { z } from "zod";
import { getCompanyId } from "../lib/company-scope.js";

export const DEFAULT_PROJECT_CONTEXT_TEMPLATE = `# Project Context

## Overview
<!-- Describe what this project does -->

## Architecture  
<!-- Key architectural decisions -->

## Conventions
<!-- Coding standards, naming conventions -->

## Current Sprint
<!-- What's being worked on now -->

## Important Notes
<!-- Anything agents should know before starting work -->
`;

export const projectContextRoute = new Hono();

const UpdateProjectContextSchema = z.object({
	content: z.string(),
});

export function getContextPath(workspacePath: string): string {
	return join(workspacePath, ".setra", "CONTEXT.md");
}

export function readProjectContext(workspacePath: string): {
	content: string;
	updatedAt: string;
} {
	const contextPath = getContextPath(workspacePath);
	if (!existsSync(contextPath)) {
		return {
			content: DEFAULT_PROJECT_CONTEXT_TEMPLATE,
			updatedAt: "",
		};
	}
	const stats = statSync(contextPath);
	return {
		content: readFileSync(contextPath, "utf8"),
		updatedAt: stats.mtime.toISOString(),
	};
}

function getProjectWorkspacePath(projectId: string, companyId: string): string {
	const row = getRawDb()
		.prepare(
			`SELECT COALESCE(NULLIF(trim(workspace_path), ''), NULLIF(trim(repo_path), '')) AS workspacePath
			 FROM board_projects
			 WHERE id = ? AND company_id = ?`,
		)
		.get(projectId, companyId) as { workspacePath: string | null } | undefined;
	if (!row) throw new Error("project not found");
	const workspacePath = row.workspacePath?.trim();
	if (!workspacePath) {
		throw new Error("workspace is not configured for this project");
	}
	if (!isAbsolute(workspacePath)) {
		throw new Error("workspace path must be absolute");
	}
	const stats = statSync(workspacePath, { throwIfNoEntry: false });
	if (!stats || !stats.isDirectory()) {
		throw new Error("workspace path does not exist");
	}
	return workspacePath;
}

function errorStatus(message: string): 404 | 422 | 500 {
	if (message === "project not found") return 404;
	if (message.includes("workspace")) return 422;
	return 500;
}

projectContextRoute.get("/projects/:projectId/context", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const workspacePath = getProjectWorkspacePath(projectId, companyId);
		return c.json(readProjectContext(workspacePath));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to load project context";
		return c.json({ error: message }, errorStatus(message));
	}
});

projectContextRoute.put(
	"/projects/:projectId/context",
	zValidator("json", UpdateProjectContextSchema),
	async (c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const workspacePath = getProjectWorkspacePath(projectId, companyId);
			const { content } = c.req.valid("json");
			mkdirSync(join(workspacePath, ".setra"), { recursive: true });
			writeFileSync(getContextPath(workspacePath), content, "utf8");
			return c.json({ ok: true });
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "failed to save project context";
			return c.json({ error: message }, errorStatus(message));
		}
	},
);
