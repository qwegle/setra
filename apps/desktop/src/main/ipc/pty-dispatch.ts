/**
 * pty-dispatch.ts — Desktop PTY bridge for dispatcher-created runs
 *
 * The server dispatcher creates runs with status='pending' for PTY-only agents
 * (claude, codex, amp, opencode, gemini). This module polls the local DB every
 * 10 seconds and spawns those runs via node-pty — giving CEO/CTO real coding
 * tools (file writes, bash, git) instead of text-only API responses.
 *
 * Architecture (inspired by Superset's pty-daemon):
 *   dispatcher (server) → pending run in DB → poller (desktop) → node-pty → claude/codex/amp
 *
 * On exit, the PTY bridge posts to the server's lifecycle endpoint so
 * run-lifecycle.ts can handle commit/push/PR/credibility updates.
 */

import crypto from "node:crypto";
import { getRawDb } from "@setra/db/client.js";
import { BrowserWindow } from "electron";
import log from "electron-log/main";
import { getAgentEnvOverrides } from "./settings.js";

const SERVER_BASE_URL =
	process.env["SETRA_SERVER_URL"] ?? "http://localhost:3141";

// ─── Agent preset table (Superset-style) ─────────────────────────────────────
// command + args + promptTransport covers every known coding CLI.
// transport "argv": task is passed as a CLI argument
// transport "stdin": task is written to stdin after process starts

interface AgentPreset {
	args: string[];
	promptFlag: string; // flag before the task string ("" if positional / stdin)
	transport: "argv" | "stdin";
}

const AGENT_PRESETS: Record<string, AgentPreset> = {
	claude: {
		args: ["--permission-mode", "acceptEdits"],
		promptFlag: "-p",
		transport: "argv",
	},
	codex: {
		args: [
			"--sandbox",
			"workspace-write",
			"--ask-for-approval",
			"never",
			"-c",
			'model_reasoning_effort="high"',
		],
		promptFlag: "--",
		transport: "argv",
	},
	amp: {
		args: [],
		promptFlag: "",
		transport: "stdin",
	},
	opencode: {
		args: [],
		promptFlag: "-p",
		transport: "argv",
	},
	gemini: {
		args: [],
		promptFlag: "",
		transport: "stdin",
	},
};

const PTY_ADAPTERS = new Set(Object.keys(AGENT_PRESETS));
const POLL_INTERVAL_MS = 10_000;

// Tracks run IDs currently being executed so we don't double-launch
const activeRuns = new Set<string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startPtyDispatchPoller(): void {
	if (pollTimer) return;
	log.info(
		"[pty-poller] started — polling every",
		POLL_INTERVAL_MS / 1000,
		"s",
	);
	// Immediate first poll
	void pollAndDispatch();
	pollTimer = setInterval(() => void pollAndDispatch(), POLL_INTERVAL_MS);
}

export function stopPtyDispatchPoller(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
		log.info("[pty-poller] stopped");
	}
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

let consecutivePollErrors = 0;

async function pollAndDispatch(): Promise<void> {
	try {
		const db = getRawDb();
		const pendingRuns = db
			.prepare(
				`SELECT r.id             AS run_id,
                r.plot_id,
                r.agent,
                ar.adapter_type,
                ar.system_prompt,
                p.worktree_path,
                p.branch,
                COALESCE(bi.description, bi.title, 'Complete the assigned task') AS task
         FROM   runs r
         JOIN   agent_roster ar ON ar.slug = r.agent
         LEFT   JOIN plots p    ON p.id = r.plot_id
         LEFT   JOIN board_issues bi ON bi.linked_plot_id = r.plot_id
         WHERE  r.status = 'pending'
           AND  ar.adapter_type IN (${[...PTY_ADAPTERS].map(() => "?").join(",")})
         ORDER  BY r.started_at ASC
         LIMIT  3`,
			)
			.all(...PTY_ADAPTERS) as PendingRun[];

		consecutivePollErrors = 0; // reset on success

		for (const run of pendingRuns) {
			if (!activeRuns.has(run.run_id)) {
				void spawnPtyRun(run);
			}
		}
	} catch (err) {
		consecutivePollErrors++;
		// Only log first error and every 60th after (10s * 60 = 10 min)
		if (consecutivePollErrors === 1 || consecutivePollErrors % 60 === 0) {
			log.error(
				`[pty-poller] poll error (count=${consecutivePollErrors}):`,
				err,
			);
		}
	}
}

// ─── PTY runner ───────────────────────────────────────────────────────────────

interface PendingRun {
	run_id: string;
	plot_id: string;
	agent: string;
	adapter_type: string;
	system_prompt: string | null;
	worktree_path: string | null;
	branch: string | null;
	task: string;
}

async function spawnPtyRun(run: PendingRun): Promise<void> {
	activeRuns.add(run.run_id);
	const db = getRawDb();
	const now = new Date().toISOString();

	const preset = AGENT_PRESETS[run.adapter_type] ?? AGENT_PRESETS["claude"]!;
	const cwd = run.worktree_path ?? process.env["HOME"] ?? "/";

	log.info(
		`[pty-poller] launching run=${run.run_id} agent=${run.agent} adapter=${run.adapter_type} cwd=${cwd}`,
	);

	// Mark run + agent as running
	db.prepare(`UPDATE runs SET status='running', updated_at=? WHERE id=?`).run(
		now,
		run.run_id,
	);
	db.prepare(
		`UPDATE agent_roster SET status='running', updated_at=? WHERE slug=?`,
	).run(now, run.agent);
	broadcastToWindows("runs:status-changed", run.run_id, "running");
	broadcastToWindows("plots:status-changed", run.plot_id, "running");

	try {
		const nodePty = await import("node-pty");

		// Build spawn arguments based on prompt transport
		const spawnArgs: string[] =
			preset.transport === "argv"
				? [
						...preset.args,
						...(preset.promptFlag ? [preset.promptFlag] : []),
						run.task,
					]
				: [...preset.args];

		const ptyProcess = nodePty.spawn(run.agent, spawnArgs, {
			name: "xterm-256color",
			cols: 220,
			rows: 50,
			cwd,
			env: {
				...process.env,
				// Inject API keys from setra settings
				...getAgentEnvOverrides(),
				// Required: makes Claude Code / TUI agents parse key sequences correctly
				TERM_PROGRAM: "kitty",
				COLORTERM: "truecolor",
				// Anthropic prompt cache (9x cost reduction)
				ANTHROPIC_PROMPT_CACHING: "1",
				// Context for the agent
				SETRA_PLOT_ID: run.plot_id,
				SETRA_RUN_ID: run.run_id,
				SETRA_AGENT: run.agent,
				// macOS SSL fix for Go binaries (gh, etc.)
				...(process.platform === "darwin"
					? { SSL_CERT_FILE: "/etc/ssl/cert.pem" }
					: {}),
			},
		});

		// For stdin transport (amp, gemini), write the task after shell is ready
		if (preset.transport === "stdin") {
			setTimeout(() => {
				ptyProcess.write(`${run.task}\n`);
			}, 1500);
		}

		// Store PTY PID
		db.prepare(`UPDATE runs SET pty_pid=?, updated_at=? WHERE id=?`).run(
			ptyProcess.pid ?? null,
			now,
			run.run_id,
		);

		let chunkSeq = 0;
		let pendingOutput = "";
		let flushTimer: ReturnType<typeof setTimeout> | null = null;

		const flushChunks = () => {
			if (!pendingOutput) return;
			const content = pendingOutput;
			pendingOutput = "";
			try {
				db.prepare(
					`INSERT OR IGNORE INTO chunks (id, run_id, sequence, content, chunk_type)
           VALUES (?, ?, ?, ?, 'output')`,
				).run(crypto.randomUUID(), run.run_id, chunkSeq++, content);
			} catch {
				/* non-fatal */
			}
			parseCostFromOutput(content, run.run_id, db);
		};

		// Stream output: broadcast to renderer immediately, batch DB writes
		ptyProcess.onData((data: string) => {
			broadcastToWindows(`terminal:data:${run.run_id}`, data);
			pendingOutput += data;
			// Flush to DB every 2 seconds instead of every data event
			if (!flushTimer) {
				flushTimer = setTimeout(() => {
					flushTimer = null;
					flushChunks();
				}, 2000);
			}
		});

		// Handle exit
		ptyProcess.onExit(({ exitCode }) => {
			// Flush any remaining buffered output
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = null;
			}
			flushChunks();

			const endNow = new Date().toISOString();
			const status = exitCode === 0 ? "completed" : "failed";
			const outcome = exitCode === 0 ? "success" : "failed";

			db.prepare(
				`UPDATE runs
         SET status=?, outcome=?, exit_code=?, ended_at=?, updated_at=?
         WHERE id=?`,
			).run(status, outcome, exitCode, endNow, endNow, run.run_id);

			db.prepare(`UPDATE plots SET status='idle', updated_at=? WHERE id=?`).run(
				endNow,
				run.plot_id,
			);

			db.prepare(
				`UPDATE agent_roster SET status='idle', updated_at=? WHERE slug=?`,
			).run(endNow, run.agent);

			activeRuns.delete(run.run_id);

			broadcastToWindows("runs:status-changed", run.run_id, status);
			broadcastToWindows("plots:status-changed", run.plot_id, "idle");

			// Notify the server lifecycle endpoint so commit/push/PR/credibility
			// logic runs even when the run was executed desktop-side.
			void notifyRunCompleted(run.run_id, exitCode ?? 1).catch((err) => {
				log.warn(
					`[pty-poller] lifecycle notify failed for run ${run.run_id}:`,
					err,
				);
			});

			log.info(
				`[pty-poller] run ${run.run_id} finished: status=${status} exitCode=${exitCode}`,
			);
		});
	} catch (err) {
		log.error(`[pty-poller] failed to spawn run ${run.run_id}:`, err);
		const errMsg = err instanceof Error ? err.message : String(err);

		db.prepare(
			`UPDATE runs SET status='failed', error_message=?, ended_at=?, updated_at=? WHERE id=?`,
		).run(errMsg, now, now, run.run_id);

		db.prepare(
			`UPDATE agent_roster SET status='idle', updated_at=? WHERE slug=?`,
		).run(now, run.agent);

		activeRuns.delete(run.run_id);
		broadcastToWindows("runs:status-changed", run.run_id, "failed");
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COST_PATTERNS = [
	/total\s+cost:?\s*\$?([\d.]+)/i,
	/api\s+cost:?\s*\$?([\d.]+)/i,
	/cost:?\s*\$?([\d.]+)/i,
];

const TOKEN_PATTERNS = {
	input: /input\s+tokens?:?\s*([\d,]+)/i,
	output: /output\s+tokens?:?\s*([\d,]+)/i,
	cacheRead: /cache\s+read\s+tokens?:?\s*([\d,]+)/i,
	cacheWrite: /cache\s+(?:creation|write)\s+tokens?:?\s*([\d,]+)/i,
};

function parseCostFromOutput(text: string, runId: string, db: any): void {
	let costUsd: number | null = null;
	for (const p of COST_PATTERNS) {
		const m = p.exec(text);
		if (m?.[1]) {
			costUsd = Number.parseFloat(m[1]);
			break;
		}
	}
	if (costUsd === null) return;

	const parseTokens = (p: RegExp): number | null => {
		const m = p.exec(text);
		return m?.[1] ? Number.parseInt(m[1].replace(/,/g, ""), 10) : null;
	};

	const now = new Date().toISOString();
	const promptTokens = parseTokens(TOKEN_PATTERNS.input);
	const completionTokens = parseTokens(TOKEN_PATTERNS.output);
	const cacheReadTokens = parseTokens(TOKEN_PATTERNS.cacheRead);
	const cacheWriteTokens = parseTokens(TOKEN_PATTERNS.cacheWrite);

	try {
		db.prepare(
			`UPDATE runs
       SET cost_usd=?,
           prompt_tokens=COALESCE(?,prompt_tokens),
           completion_tokens=COALESCE(?,completion_tokens),
           cache_read_tokens=COALESCE(?,cache_read_tokens),
           cache_write_tokens=COALESCE(?,cache_write_tokens),
           cost_confidence='high',
           updated_at=?
       WHERE id=?`,
		).run(
			costUsd,
			promptTokens,
			completionTokens,
			cacheReadTokens,
			cacheWriteTokens,
			now,
			runId,
		);
		broadcastToWindows("runs:cost-update", runId, costUsd);
	} catch {
		/* non-fatal */
	}
}

function broadcastToWindows(channel: string, ...args: unknown[]): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(channel, ...args);
	}
}

/**
 * POST to the server lifecycle endpoint so run-lifecycle.ts can handle
 * commit/push/PR creation and credibility scoring for PTY-executed runs.
 * Best-effort — a network failure must not block the UI.
 */
async function notifyRunCompleted(
	runId: string,
	exitCode: number,
): Promise<void> {
	const url = `${SERVER_BASE_URL}/api/runs/${encodeURIComponent(runId)}/completed`;
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ exitCode }),
		signal: AbortSignal.timeout(10_000),
	});
	if (!resp.ok) {
		log.warn(
			`[pty-poller] lifecycle endpoint returned ${resp.status} for run ${runId}`,
		);
	}
}
