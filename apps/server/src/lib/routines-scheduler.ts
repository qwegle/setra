import crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { emit } from "../sse/handler.js";
import { normalizeAdapterId } from "./adapter-policy.js";
import { nextCronOccurrence } from "./cron.js";
import { createLogger } from "./logger.js";
import { recordRunChunk } from "./run-chunks.js";
import { spawnServerRun } from "./server-runner.js";

const log = createLogger("routine-scheduler");
const PTY_ONLY_ADAPTERS = new Set([
	"claude",
	"codex",
	"gemini",
	"amp",
	"opencode",
]);
const BOARD_PROJECT_ID = "00000000000000000000000000000001";

interface RunnableRoutineRow {
	id: string;
	company_id: string | null;
	name: string;
	description: string | null;
	schedule: string | null;
	prompt: string | null;
	agent_id: string | null;
	is_active: number;
	agent_slug: string | null;
	agent_name: string | null;
	agent_status: string | null;
	agent_adapter_type: string | null;
}

function ensureBoardSentinel(): string {
	const raw = getRawDb();
	const now = new Date().toISOString();
	raw
		.prepare(
			`INSERT OR IGNORE INTO board_projects (id, name, repo_path, created_at, updated_at)
		     VALUES (?, 'Board Dispatch', '__board__', ?, ?)`,
		)
		.run(BOARD_PROJECT_ID, now, now);
	return BOARD_PROJECT_ID;
}

function getRoutineProjectScope(companyId: string): {
	projectId: string;
	workspacePath: string | null;
} {
	const row = getRawDb()
		.prepare(
			`SELECT id,
			        COALESCE(NULLIF(trim(workspace_path), ''), NULLIF(trim(repo_path), '')) AS workspace_path
			   FROM board_projects
			  WHERE company_id = ?
			    AND COALESCE(NULLIF(trim(workspace_path), ''), NULLIF(trim(repo_path), '')) IS NOT NULL
			  ORDER BY updated_at DESC, created_at ASC
			  LIMIT 1`,
		)
		.get(companyId) as
		| { id: string; workspace_path: string | null }
		| undefined;

	return {
		projectId: row?.id ?? ensureBoardSentinel(),
		workspacePath: row?.workspace_path ?? null,
	};
}

function loadRunnableRoutine(
	routineId: string,
	companyId: string,
): RunnableRoutineRow | null {
	const row = getRawDb()
		.prepare(
			`SELECT r.id,
			        r.company_id,
			        r.name,
			        r.description,
			        r.schedule,
			        r.prompt,
			        r.agent_id,
			        r.is_active,
			        ar.slug AS agent_slug,
			        ar.display_name AS agent_name,
			        ar.status AS agent_status,
			        ar.adapter_type AS agent_adapter_type
			   FROM routines r
			   LEFT JOIN agent_roster ar ON ar.id = r.agent_id
			  WHERE r.id = ? AND r.company_id = ?`,
		)
		.get(routineId, companyId) as RunnableRoutineRow | undefined;
	return row ?? null;
}

export async function triggerRoutineRun(
	routineId: string,
	companyId: string,
): Promise<{ runId: string } | null> {
	const raw = getRawDb();
	const routine = loadRunnableRoutine(routineId, companyId);
	if (!routine?.agent_id || !routine.agent_slug) return null;
	if (routine.agent_status !== "idle") return null;

	const prompt =
		routine.prompt?.trim() ||
		routine.description?.trim() ||
		routine.name.trim();
	const now = new Date().toISOString();
	const plotId = `rt${routine.id.replace(/-/g, "").slice(0, 30)}`;
	const branchName =
		`routine/${routine.agent_slug}/${routine.id.slice(0, 8)}`.slice(0, 255);
	const scope = getRoutineProjectScope(companyId);
	const nextRunAt =
		routine.is_active && routine.schedule
			? (nextCronOccurrence(routine.schedule, new Date(now))?.toISOString() ??
				null)
			: null;

	const claim = raw
		.prepare(
			`UPDATE agent_roster
			    SET status = 'running', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
			  WHERE id = ? AND status = 'idle'`,
		)
		.run(routine.agent_id);
	if (claim.changes === 0) return null;

	const runId = crypto.randomUUID();
	try {
		raw
			.prepare(
				`INSERT OR IGNORE INTO plots
				 (id, project_id, name, branch, base_branch, worktree_path, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 'main', ?, ?, ?)`,
			)
			.run(
				plotId,
				scope.projectId,
				`Routine — ${routine.name}`,
				branchName,
				scope.workspacePath,
				now,
				now,
			);

		raw
			.prepare(
				`UPDATE plots
				    SET updated_at = ?, worktree_path = COALESCE(?, worktree_path)
				  WHERE id = ?`,
			)
			.run(now, scope.workspacePath, plotId);

		raw
			.prepare(
				`INSERT INTO runs
				 (id, plot_id, agent, branch_name, agent_args, source_type, source_id, status, started_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, 'routine', ?, 'pending', ?, ?)`,
			)
			.run(
				runId,
				plotId,
				routine.agent_slug,
				branchName,
				JSON.stringify({
					kind: "scheduled_routine",
					routineId: routine.id,
					routineName: routine.name,
				}),
				routine.id,
				now,
				now,
			);

		recordRunChunk({ runId, type: "input", content: prompt, now });

		raw
			.prepare(
				`INSERT INTO routine_runs (id, routine_id, status, started_at, created_at)
				 VALUES (?, ?, 'pending', ?, ?)`,
			)
			.run(runId, routine.id, now, now);

		raw
			.prepare(
				`UPDATE routines
				    SET last_triggered_at = ?, next_run_at = ?, updated_at = ?
				  WHERE id = ?`,
			)
			.run(now, nextRunAt, now, routine.id);
	} catch (error) {
		raw
			.prepare(
				`UPDATE agent_roster
				    SET status = 'idle', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
				  WHERE id = ?`,
			)
			.run(routine.agent_id);
		throw error;
	}

	emit("run:updated", {
		runId,
		agentId: routine.agent_slug,
		status: "pending",
		issueId: null,
	});
	log.info("routine triggered", {
		routineId: routine.id,
		runId,
		agent: routine.agent_slug,
	});

	if (!PTY_ONLY_ADAPTERS.has(normalizeAdapterId(routine.agent_adapter_type))) {
		void spawnServerRun({
			runId,
			agentSlug: routine.agent_slug,
			issueId: null,
			companyId,
			task: prompt,
		}).catch((error) => {
			log.warn("spawnServerRun failed", {
				runId,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	return { runId };
}
