import {
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { getRawDb } from "@setra/db";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as projectsRepo from "../repositories/projects.repo.js";
import {
	CreateFileSchema,
	CreateFolderSchema,
	RenamePathSchema,
	SaveFileSchema,
} from "../validators/files.validators.js";

export const filesRoute = new Hono();

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

function getWorkspaceRoot(projectId: string, companyId: string): string {
	const project = projectsRepo.getProjectFull(projectId);
	if (!project || project.companyId !== companyId) {
		throw new Error("project not found");
	}
	const root = project.workspacePath?.trim();
	if (!root) throw new Error("workspace is not configured for this project");
	if (!path.isAbsolute(root))
		throw new Error("workspace path must be absolute");
	const st = statSync(root, { throwIfNoEntry: false });
	if (!st || !st.isDirectory())
		throw new Error("workspace path does not exist");
	return root;
}

function resolveInsideWorkspace(root: string, relativePath: string): string {
	const rel = relativePath.replace(/^\/+/, "");
	const abs = path.resolve(root, rel);
	const normalizedRoot = path.resolve(root);
	if (
		!(abs === normalizedRoot || abs.startsWith(`${normalizedRoot}${path.sep}`))
	) {
		throw new Error("path is outside workspace");
	}
	return abs;
}

function walkTree(
	root: string,
	dir: string,
	depth: number,
	maxDepth: number,
): Array<Record<string, unknown>> {
	if (depth > maxDepth) return [];
	const entries = readdirSync(dir, { withFileTypes: true })
		.filter((d) => !IGNORED.has(d.name))
		.sort((a, b) => {
			if (a.isDirectory() && !b.isDirectory()) return -1;
			if (!a.isDirectory() && b.isDirectory()) return 1;
			return a.name.localeCompare(b.name);
		});

	return entries.map((entry) => {
		const abs = path.join(dir, entry.name);
		const rel = path.relative(root, abs).replaceAll(path.sep, "/");
		if (entry.isDirectory()) {
			return {
				type: "dir",
				name: entry.name,
				path: rel,
				children: walkTree(root, abs, depth + 1, maxDepth),
			};
		}
		return {
			type: "file",
			name: entry.name,
			path: rel,
		};
	});
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

filesRoute.get("/tree", (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.query("projectId");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);
	try {
		const root = getWorkspaceRoot(projectId, cid);
		const tree = walkTree(root, root, 0, 4);
		return c.json({ root, tree });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "failed to read tree" },
			422,
		);
	}
});

filesRoute.get("/content", (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.query("projectId");
	const relPath = c.req.query("path");
	if (!projectId || !relPath)
		return c.json({ error: "projectId and path are required" }, 400);

	try {
		const root = getWorkspaceRoot(projectId, cid);
		const abs = resolveInsideWorkspace(root, relPath);
		const st = statSync(abs, { throwIfNoEntry: false });
		if (!st || !st.isFile()) return c.json({ error: "file not found" }, 404);
		const buffer = readFileSync(abs);
		const ext = fileExt(relPath);
		const mimeType = IMAGE_MIME_TYPES[ext] ?? null;
		const isBinary = ext === "svg" ? false : isProbablyBinary(buffer);
		if (mimeType && ext !== "svg") {
			return c.json({
				path: relPath,
				content: buffer.toString("base64"),
				isBinary: true,
				size: st.size,
				mimeType,
				encoding: "base64",
			});
		}
		if (isBinary) {
			return c.json({
				path: relPath,
				content: null,
				isBinary: true,
				size: st.size,
				mimeType,
				encoding: null,
			});
		}
		return c.json({
			path: relPath,
			content: buffer.toString("utf8"),
			isBinary: false,
			size: st.size,
			mimeType,
			encoding: "utf8",
		});
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "failed to read file" },
			422,
		);
	}
});

filesRoute.put("/content", zValidator("json", SaveFileSchema), (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	try {
		const root = getWorkspaceRoot(body.projectId, cid);
		const abs = resolveInsideWorkspace(root, body.path);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, body.content, "utf-8");
		return c.json({ ok: true });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "failed to write file" },
			422,
		);
	}
});

filesRoute.post("/file", zValidator("json", CreateFileSchema), (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	try {
		const root = getWorkspaceRoot(body.projectId, cid);
		const abs = resolveInsideWorkspace(root, body.path);
		const st = statSync(abs, { throwIfNoEntry: false });
		if (st?.isDirectory()) {
			return c.json({ error: "path points to a directory" }, 422);
		}
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, body.content ?? "", "utf-8");
		return c.json({ ok: true });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "failed to create file" },
			422,
		);
	}
});

filesRoute.post("/folder", zValidator("json", CreateFolderSchema), (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	try {
		const root = getWorkspaceRoot(body.projectId, cid);
		const abs = resolveInsideWorkspace(root, body.path);
		mkdirSync(abs, { recursive: true });
		return c.json({ ok: true });
	} catch (err) {
		return c.json(
			{
				error: err instanceof Error ? err.message : "failed to create folder",
			},
			422,
		);
	}
});

filesRoute.delete("/node", (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.query("projectId");
	const relPath = c.req.query("path");
	if (!projectId || !relPath) {
		return c.json({ error: "projectId and path are required" }, 400);
	}
	try {
		const root = getWorkspaceRoot(projectId, cid);
		const abs = resolveInsideWorkspace(root, relPath);
		if (abs === path.resolve(root)) {
			return c.json({ error: "cannot delete workspace root" }, 422);
		}
		const st = statSync(abs, { throwIfNoEntry: false });
		if (!st) return c.json({ error: "path not found" }, 404);
		rmSync(abs, { recursive: true, force: false });
		return c.json({ ok: true });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "failed to delete path" },
			422,
		);
	}
});

filesRoute.post("/rename", zValidator("json", RenamePathSchema), (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	try {
		const root = getWorkspaceRoot(body.projectId, cid);
		const fromAbs = resolveInsideWorkspace(root, body.fromPath);
		const toAbs = resolveInsideWorkspace(root, body.toPath);
		if (fromAbs === path.resolve(root)) {
			return c.json({ error: "cannot rename workspace root" }, 422);
		}
		const source = statSync(fromAbs, { throwIfNoEntry: false });
		if (!source) return c.json({ error: "path not found" }, 404);
		const target = statSync(toAbs, { throwIfNoEntry: false });
		if (target) return c.json({ error: "target path already exists" }, 422);
		mkdirSync(path.dirname(toAbs), { recursive: true });
		renameSync(fromAbs, toAbs);
		return c.json({ ok: true, fromPath: body.fromPath, toPath: body.toPath });
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : "failed to rename path" },
			422,
		);
	}
});

filesRoute.get("/activity", (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.query("projectId");
	if (!projectId) return c.json({ error: "projectId is required" }, 400);

	const db = getRawDb();
	const rows = db
		.prepare(
			`SELECT
       r.id AS runId,
       r.agent AS agentSlug,
       r.status AS status,
       r.updated_at AS updatedAt,
       i.id AS issueId,
       i.title AS issueTitle
      FROM runs r
      JOIN board_issues i ON i.linked_plot_id = r.plot_id
      WHERE i.project_id = ?
        AND i.company_id = ?
      ORDER BY r.updated_at DESC
      LIMIT 15`,
		)
		.all(projectId, cid) as Array<{
		runId: string;
		agentSlug: string;
		status: string;
		updatedAt: string;
		issueId: string | null;
		issueTitle: string | null;
	}>;

	const withPreview = rows.map((row) => {
		const chunk = db
			.prepare(
				`SELECT content
          FROM chunks
         WHERE run_id = ?
         ORDER BY sequence DESC
         LIMIT 1`,
			)
			.get(row.runId) as { content: string } | undefined;
		return {
			...row,
			preview: chunk?.content?.slice(0, 180) ?? "",
		};
	});

	return c.json(withPreview);
});
