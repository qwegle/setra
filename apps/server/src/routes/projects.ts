import { zValidator } from "@hono/zod-validator";
import { ensureRepo, getRemoteUrl } from "@setra/git";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../lib/audit.js";
import { ensureProjectChannel, renameProjectChannel } from "../lib/channels.js";
import { getCompanyId } from "../lib/company-scope.js";
import { LIFECYCLE_STAGES, type LifecycleStage } from "../lib/lifecycle.js";
import {
	deleteProjectRule,
	loadProjectRules,
	writeProjectRule,
} from "../lib/project-rules.js";
import {
	getProjectSettings,
	normalizeProjectSettingsInput,
} from "../lib/project-settings.js";
import { rebuildSprintBoard } from "../lib/sprint-board.js";
import * as companiesRepo from "../repositories/companies.repo.js";
import * as projectsRepo from "../repositories/projects.repo.js";
import { emit } from "../sse/handler.js";
import {
	CreateProjectSchema,
	UpdateProjectSchema,
} from "../validators/projects.validators.js";

// Deterministic per-project color stripe. Same id always maps to the same
// hex value so UIs stay stable across reloads. Mirrors the 12-hue palette
// used by IssuesPage on the board.
const PROJECT_COLOR_PALETTE = [
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#f43f5e",
	"#f97316",
	"#eab308",
	"#84cc16",
	"#10b981",
	"#14b8a6",
	"#06b6d4",
	"#3b82f6",
	"#a855f7",
] as const;

function colorForProjectId(id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++)
		h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
	return (
		PROJECT_COLOR_PALETTE[Math.abs(h) % PROJECT_COLOR_PALETTE.length] ??
		"#6366f1"
	);
}

const ProjectRuleSchema = z.object({
	content: z.string().trim().min(1),
});

const ProjectRequirementsSchema = z.object({
	requirements: z.string(),
});

const DatabaseConnectSchema = z.object({
	name: z.string().trim().min(1),
	type: z.enum(["postgres", "mysql", "mssql", "mongodb", "sqlite"]),
	host: z.string().trim().min(1),
	port: z.number().int().positive(),
	database: z.string().trim().min(1),
	username: z.string().optional(),
	password: z.string().optional(),
});

const DatabaseQuerySchema = z.object({
	connectionId: z.string().trim().min(1),
	query: z.string().trim().min(1),
});

interface DatabaseConnection {
	id: string;
	name: string;
	type: "postgres" | "mysql" | "mssql" | "mongodb" | "sqlite";
	host: string;
	port: number;
	database: string;
	status: "connected" | "disconnected" | "error";
}

const projectDatabaseConnections = new Map<string, DatabaseConnection[]>();

function getScopedProject(projectId: string, companyId: string | null) {
	const project = projectsRepo.getProjectFull(projectId);
	if (!project) return null;
	if (project.companyId && project.companyId !== companyId) return null;
	return project;
}

export const projectsRoute = new Hono();

projectsRoute.get("/", async (c) => {
	const cid = getCompanyId(c);
	if (cid) {
		// company_id was added via idempotent ALTER, so it's not on the drizzle
		// type yet — drop into raw SQL to filter on it (incl. legacy NULLs).
		const rows = projectsRepo.listProjectsByCompany(cid);
		return c.json(rows);
	}

	const rows = await projectsRepo.listProjectsGlobal();
	return c.json(rows);
});

projectsRoute.post("/", zValidator("json", CreateProjectSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	const slug = body.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	const id = crypto.randomUUID();

	// Drizzle insert (without the new ALTER columns), then patch them in.
	const row = await projectsRepo.insertProject({
		id,
		name: body.name,
		slug,
		description: body.description ?? null,
	});

	const targetCid = cid;
	const color = body.color ?? colorForProjectId(id);
	let repoUrl: string | null = null;
	let defaultBranch = "main";
	let gitInitialized = 0;

	if (body.workspacePath) {
		try {
			const result = await ensureRepo(body.workspacePath);
			gitInitialized = 1;
			defaultBranch = result.defaultBranch;
			repoUrl = await getRemoteUrl(body.workspacePath).catch(() => null);
		} catch (err) {
			console.warn(
				`[projects] ensureRepo failed for ${body.workspacePath}:`,
				err,
			);
		}
	}

	projectsRepo.updateProjectMeta({
		id,
		companyId: targetCid,
		workspacePath: body.workspacePath ?? null,
		repoUrl,
		defaultBranch,
		gitInitialized,
		color,
	});
	projectsRepo.updateProjectFields(id, {
		requirements: body.requirements?.trim() ?? "",
		planStatus: body.planStatus ?? "none",
	});

	if (targetCid) {
		const company = await companiesRepo.getCompanyById(targetCid);
		if (company) {
			companiesRepo.ensureCeoForCompany({
				companyId: targetCid,
				companyName: company.name,
				companyGoal: company.goal,
				projectName: body.name,
				projectDescription: body.description ?? null,
				workspacePath: body.workspacePath ?? null,
			});
		}
	}

	// Per-project collaboration channel + initial sprint board pinned message.
	if (targetCid) {
		try {
			ensureProjectChannel(targetCid, id, body.name);
			rebuildSprintBoard(id);
		} catch (err) {
			console.warn(`[projects] channel/sprint init failed for ${id}:`, err);
		}
	}

	emit("project:updated", { id, companyId: targetCid });
	await logActivity(c, "project.created", "project", id, {
		name: body.name,
		slug,
	});
	return c.json(
		{
			...row,
			companyId: targetCid,
			workspacePath: body.workspacePath ?? null,
			repoUrl,
			repoPath: body.workspacePath ?? null,
			defaultBranch,
			gitInitialized: Boolean(gitInitialized),
			color,
			requirements: body.requirements?.trim() ?? "",
			planStatus: body.planStatus ?? "none",
			settingsJson: "{}",
		},
		201,
	);
});

// PATCH /api/projects/:id — rename / recolor. Renames the project channel to
// match.
projectsRoute.patch(
	"/:id",
	zValidator("json", UpdateProjectSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const id = c.req.param("id");
		const body = c.req.valid("json");

		const existing = projectsRepo.getProjectFull(id);
		if (!existing || (existing.companyId && existing.companyId !== cid)) {
			return c.json({ error: "not found" }, 404);
		}

		if (
			body.name === undefined &&
			body.description === undefined &&
			body.color === undefined &&
			body.workspacePath === undefined &&
			body.defaultBranch === undefined &&
			body.requirements === undefined &&
			body.planStatus === undefined
		) {
			return c.json({ ok: true, noop: true });
		}

		const updates: Record<string, unknown> = {};
		if (body.name !== undefined) updates.name = body.name;
		if (body.description !== undefined) updates.description = body.description;
		if (body.color !== undefined) updates.color = body.color;
		if (body.requirements !== undefined) {
			updates.requirements = body.requirements?.trim() ?? "";
		}
		if (body.planStatus !== undefined) updates.planStatus = body.planStatus;
		if (body.defaultBranch !== undefined) {
			updates.defaultBranch = body.defaultBranch?.trim() || null;
		}

		if (body.workspacePath !== undefined) {
			const nextWorkspace =
				typeof body.workspacePath === "string"
					? body.workspacePath.trim()
					: null;
			const workspacePath =
				nextWorkspace && nextWorkspace.length > 0 ? nextWorkspace : null;

			let repoUrl: string | null = null;
			let defaultBranch = "main";
			let gitInitialized = 0;

			if (workspacePath) {
				try {
					const result = await ensureRepo(workspacePath);
					gitInitialized = 1;
					defaultBranch = result.defaultBranch;
					repoUrl = await getRemoteUrl(workspacePath).catch(() => null);
				} catch (err) {
					console.warn(
						`[projects] ensureRepo failed for ${workspacePath}:`,
						err,
					);
				}
			}

			updates.workspacePath = workspacePath;
			updates.repoPath = workspacePath;
			updates.repoUrl = repoUrl;
			updates.defaultBranch = defaultBranch;
			updates.gitInitialized = gitInitialized;
		}

		projectsRepo.updateProjectFields(id, updates);

		if (body.name && body.name !== existing.name) {
			try {
				renameProjectChannel(id, body.name);
			} catch {
				/* best effort */
			}
		}

		emit("project:updated", { id, companyId: cid });
		await logActivity(c, "project.updated", "project", id, body);
		return c.json({ ok: true });
	},
);

projectsRoute.get("/:id/requirements", async (c) => {
	const cid = getCompanyId(c);
	const project = getScopedProject(c.req.param("id"), cid);
	if (!project) return c.json({ error: "not found" }, 404);
	return c.json({ requirements: project.requirements ?? "" });
});

projectsRoute.put(
	"/:id/requirements",
	zValidator("json", ProjectRequirementsSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const projectId = c.req.param("id");
		const project = getScopedProject(projectId, cid);
		if (!project) return c.json({ error: "not found" }, 404);
		const requirements = c.req.valid("json").requirements.trim();
		projectsRepo.updateProjectFields(projectId, { requirements });
		emit("project:updated", { id: projectId, companyId: cid });
		await logActivity(c, "project.requirements.updated", "project", projectId, {
			requirementsLength: requirements.length,
		});
		return c.json({ ok: true, requirements });
	},
);

projectsRoute.get("/:id/settings", async (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.param("id");
	const project = getScopedProject(projectId, cid);
	if (!project) return c.json({ error: "not found" }, 404);
	return c.json(getProjectSettings(projectId));
});

projectsRoute.put("/:id/settings", async (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.param("id");
	const project = getScopedProject(projectId, cid);
	if (!project) return c.json({ error: "not found" }, 404);
	const body = await c.req.json();
	const settings = normalizeProjectSettingsInput(body);
	projectsRepo.updateProjectFields(projectId, {
		settingsJson: JSON.stringify(settings),
	});
	emit("project:updated", { id: projectId, companyId: cid });
	await logActivity(
		c,
		"project.settings.updated",
		"project",
		projectId,
		settings,
	);
	return c.json({ ok: true });
});

projectsRoute.get("/:id/rules", async (c) => {
	const cid = getCompanyId(c);
	const project = getScopedProject(c.req.param("id"), cid);
	if (!project) return c.json({ error: "not found" }, 404);
	if (!project.workspacePath) {
		return c.json({ error: "workspace_path_required" }, 400);
	}
	return c.json(await loadProjectRules(project.workspacePath));
});

projectsRoute.put(
	"/:id/rules/:name",
	zValidator("json", ProjectRuleSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const projectId = c.req.param("id");
		const project = getScopedProject(projectId, cid);
		if (!project) return c.json({ error: "not found" }, 404);
		if (!project.workspacePath) {
			return c.json({ error: "workspace_path_required" }, 400);
		}
		try {
			const rule = await writeProjectRule(
				project.workspacePath,
				c.req.param("name"),
				c.req.valid("json").content,
			);
			emit("project:updated", { id: projectId, companyId: cid });
			await logActivity(c, "project.rule.upserted", "project", projectId, {
				name: rule.name,
			});
			return c.json(rule);
		} catch (error) {
			return c.json(
				{ error: error instanceof Error ? error.message : "invalid_rule" },
				400,
			);
		}
	},
);

projectsRoute.delete("/:id/rules/:name", async (c) => {
	const cid = getCompanyId(c);
	const projectId = c.req.param("id");
	const project = getScopedProject(projectId, cid);
	if (!project) return c.json({ error: "not found" }, 404);
	if (!project.workspacePath) {
		return c.json({ error: "workspace_path_required" }, 400);
	}
	const deleted = await deleteProjectRule(
		project.workspacePath,
		c.req.param("name"),
	);
	if (!deleted) return c.json({ error: "not found" }, 404);
	emit("project:updated", { id: projectId, companyId: cid });
	await logActivity(c, "project.rule.deleted", "project", projectId, {
		name: c.req.param("name"),
	});
	return c.json({ deleted: true });
});

projectsRoute.get("/:id", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const row = getScopedProject(id, cid);
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

projectsRoute.post(
	"/:id/database/connect",
	zValidator("json", DatabaseConnectSchema),
	async (c) => {
		const cid = getCompanyId(c);
		const projectId = c.req.param("id");
		const project = getScopedProject(projectId, cid);
		if (!project) return c.json({ error: "not found" }, 404);
		const body = c.req.valid("json");
		const connection: DatabaseConnection = {
			id: crypto.randomUUID(),
			name: body.name,
			type: body.type,
			host: body.host,
			port: body.port,
			database: body.database,
			status: "connected",
		};
		projectDatabaseConnections.set(projectId, [
			...(projectDatabaseConnections.get(projectId) ?? []),
			connection,
		]);
		return c.json(connection, 201);
	},
);

projectsRoute.post(
	"/:id/database/query",
	zValidator("json", DatabaseQuerySchema),
	async (c) => {
		const cid = getCompanyId(c);
		const projectId = c.req.param("id");
		const project = getScopedProject(projectId, cid);
		if (!project) return c.json({ error: "not found" }, 404);
		const body = c.req.valid("json");
		const connection = (projectDatabaseConnections.get(projectId) ?? []).find(
			(entry) => entry.id === body.connectionId,
		);
		if (!connection) {
			return c.json({ error: "Database connection not found" }, 404);
		}
		return c.json({
			columns: ["status", "message", "query"],
			rows: [
				{
					status: connection.status,
					message: `Live ${connection.type} querying is not configured on the server yet.`,
					query: body.query,
				},
			],
		});
	},
);

projectsRoute.get("/:id/issues", (c) => {
	const rows = projectsRepo.getProjectIssues(
		c.req.param("id"),
		getCompanyId(c),
	);
	return c.json(rows);
});

// GET /api/projects/:id/sdlc-stats — counts per lifecycle stage, median
// cycle time across recently-merged issues, and a 24h activity count.
projectsRoute.get("/:id/sdlc-stats", async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");

	const project = projectsRepo.getProjectBasic(id);
	if (!project) return c.json({ error: "not found" }, 404);
	if (project.companyId && project.companyId !== cid)
		return c.json({ error: "not found" }, 404);

	const counts: Record<LifecycleStage, number> = {
		backlog: 0,
		branched: 0,
		committed: 0,
		pr_open: 0,
		in_review: 0,
		merged: 0,
		deployed: 0,
		verified: 0,
		cancelled: 0,
	};
	const stageRows = projectsRepo.getLifecycleStageCounts(id);
	for (const r of stageRows) {
		if ((LIFECYCLE_STAGES as readonly string[]).includes(r.stage)) {
			counts[r.stage as LifecycleStage] = r.c;
		}
	}

	// Cycle time: hours between the earliest backlog→branched event and the
	// matching merged event for each issue. Median across the last 25.
	const cycleRows = projectsRepo.getCycleTimeData(id);
	const hours = cycleRows
		.filter((r) => r.started && r.finished)
		.map((r) => (Date.parse(r.finished!) - Date.parse(r.started!)) / 3_600_000)
		.filter((h) => h > 0)
		.sort((a, b) => a - b);
	const cycleTimeMedianHours =
		hours.length === 0
			? null
			: hours.length % 2 === 1
				? hours[(hours.length - 1) / 2]!
				: (hours[hours.length / 2 - 1]! + hours[hours.length / 2]!) / 2;

	return c.json({
		counts,
		cycle_time_median_hours: cycleTimeMedianHours,
		activity_last_24h: projectsRepo.getActivityLast24h(id),
		activity_sparkline: projectsRepo.getActivitySparkline(id),
	});
});
