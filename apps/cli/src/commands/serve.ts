/**
 * setra serve — start the setra-core daemon
 *
 * The daemon:
 *   - Listens on a Unix domain socket: ~/.setra/instances/<name>.sock
 *     with a symlink at ~/.setra/daemon.sock for the default client path
 *   - Serves an HTTP server on a TCP port for health checks / discovery
 *   - Registers itself in ~/.setra/instances.json on startup
 *   - Unregisters on SIGTERM/SIGINT
 *
 * Socket protocol: newline-delimited JSON-RPC (NDJSON)
 *   Request:  { id, method, params }
 *   Response: { id, result } | { id, error: { code, message } }
 *   Push:     { type, ... } (no id field)
 */

import { exec, execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
// Side-effect import: registers all built-in adapters (claude, gemini, codex…)
import { getAdapter } from "@setra/agent-runner";
import type { AgentAdapter } from "@setra/agent-runner";
import { getDb, getRawDb, runMigrations } from "@setra/db";
import { getMemoryStore } from "@setra/memory";
import { getMonitorService } from "@setra/monitor";
import type { MonitorService } from "@setra/monitor";
import {
	readInstanceRegistry,
	registerInstance,
	setActiveInstance,
	unregisterInstance,
} from "@setra/shared";
import chalk from "chalk";
import { c, icon } from "../tui/theme.js";
import {
	buildChatResponse,
	deleteVaultEntryLocal,
	getActivityFeedLocal,
	getDeploymentStatusLocal,
	getDispatchStatusLocal,
	getVaultEntryLocal,
	listVaultEntriesLocal,
	resolveProjectId,
	setVaultEntryLocal,
	startDeploymentLocal,
	startDispatchLocal,
} from "./runtime-support.js";

const execAsync = promisify(exec);

const PKG_VERSION = "0.1.0";
const START_TIME = Date.now();

// Connected TUI socket clients for push events
const connectedClients = new Set<net.Socket>();

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServeOptions = {
	port?: string;
	socket?: string;
	name?: string;
	detach?: boolean;
};

type RpcRequest = {
	id: string;
	method: string;
	params: unknown;
};

// Raw better-sqlite3 row shapes (column names are snake_case in SQLite)
interface PlotRow {
	id: string;
	name: string;
	project_id: string;
	branch: string;
	ground_id: string | null;
	status: string;
	agent_template: string | null;
	created_at: string;
	updated_at: string;
	worktree_path: string | null;
}
interface RunRow {
	id: string;
	plot_id: string;
	agent: string;
	status: string;
	tmux_session: string | null;
	ground_id: string | null;
	prompt_tokens: number;
	completion_tokens: number;
	cost_usd: number;
	started_at: string;
	ended_at: string | null;
}
interface GroundRow {
	id: string;
	name: string;
	host: string;
	username: string;
	port: number;
	status: string;
	key_path: string | null;
	auth_type: string;
}
interface ChunkRow {
	id: number;
	run_id: string;
	sequence: number;
	content: string;
}
interface MarkRow {
	id: string;
	plot_id: string;
	commit_hash: string;
	branch: string;
	message: string | null;
	created_at: string;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runServe(opts: ServeOptions): Promise<void> {
	const port = Number.parseInt(opts.port ?? "7820", 10);
	const name = opts.name ?? path.basename(process.cwd());
	const setraHome = path.join(os.homedir(), ".setra");
	const instanceId = crypto.randomUUID();
	const socketPath = resolveSocketPath(opts.socket, setraHome, name);
	const defaultSock = path.join(setraHome, "daemon.sock");

	fs.mkdirSync(setraHome, { recursive: true });
	fs.mkdirSync(path.join(setraHome, "instances"), { recursive: true });

	if (opts.detach) {
		await startDetached(socketPath, port, name);
		return;
	}

	console.log(`\n  ${c.accent("setra serve")}  ${chalk.dim("setra daemon")}\n`);
	console.log(`  ${icon.pending} Name:   ${chalk.dim(name)}`);
	console.log(`  ${icon.pending} Socket: ${chalk.dim(socketPath)}`);
	console.log(
		`  ${icon.pending} HTTP:   ${chalk.dim(`http://localhost:${port}`)}`,
	);
	console.log(`\n  ${chalk.dim("Press Ctrl+C to stop\n")}`);

	// Initialise DB (run migrations, seed builtins)
	try {
		await runMigrations();
	} catch (e) {
		// Already migrated — not fatal
		const msg = e instanceof Error ? e.message : String(e);
		console.log(`  ${chalk.dim(`[db] ${msg}`)}`);
	}
	// Ensure singleton is initialised before we need it
	getDb();
	const raw = getRawDb();

	// Start system/token monitor
	const monitor = getMonitorService();
	monitor.start();

	// Register this daemon instance
	registerInstance({
		id: instanceId,
		name,
		socketPath,
		port,
		projectDir: process.cwd(),
		isLocal: true,
		pid: process.pid,
		version: PKG_VERSION,
	});
	setActiveInstance(instanceId);

	// Create symlink at ~/.setra/daemon.sock → named socket (default client path)
	try {
		fs.unlinkSync(defaultSock);
	} catch {
		/* doesn't exist yet */
	}
	try {
		fs.symlinkSync(socketPath, defaultSock);
	} catch {
		/* non-fatal */
	}

	// Remove stale named socket if present
	if (fs.existsSync(socketPath)) {
		try {
			fs.unlinkSync(socketPath);
		} catch {
			/* ignore */
		}
	}

	// Cleanup handler
	const cleanup = () => {
		monitor.stop();
		unregisterInstance(instanceId);
		for (const p of [socketPath, defaultSock]) {
			try {
				fs.unlinkSync(p);
			} catch {
				/* ignore */
			}
		}
		process.exit(0);
	};
	process.on("SIGTERM", cleanup);
	process.on("SIGINT", cleanup);

	// ─── JSON-RPC Unix socket server ──────────────────────────────────────────

	const rpcServer = net.createServer((clientSock) => {
		connectedClients.add(clientSock);
		let buf = "";

		clientSock.on("data", (chunk: Buffer) => {
			buf += chunk.toString("utf8");
			let idx: number;
			while ((idx = buf.indexOf("\n")) !== -1) {
				const line = buf.slice(0, idx).trim();
				buf = buf.slice(idx + 1);
				if (line) handleRpc(line, clientSock, raw, monitor);
			}
		});

		clientSock.on("close", () => {
			connectedClients.delete(clientSock);
		});
		clientSock.on("error", () => {
			connectedClients.delete(clientSock);
		});
	});

	await new Promise<void>((resolve, reject) => {
		rpcServer.listen(socketPath, resolve);
		rpcServer.on("error", reject);
	});
	console.log(`  ${icon.done} JSON-RPC on ${chalk.dim(socketPath)}`);

	// ─── HTTP server (health + discovery) ─────────────────────────────────────

	const httpServer = buildHttpServer(name, port);
	await new Promise<void>((resolve) => httpServer.listen(port, resolve));
	console.log(
		`  ${icon.done} HTTP on    ${chalk.dim(`http://localhost:${port}`)}`,
	);

	// Keep the process alive
	await new Promise<never>(() => {
		/* intentional */
	});
}

// ─── Push event helpers ───────────────────────────────────────────────────────

function pushToClients(event: Record<string, unknown>): void {
	const line = JSON.stringify(event) + "\n";
	for (const s of connectedClients) {
		try {
			s.write(line);
		} catch {
			/* client gone */
		}
	}
}

// ─── JSON-RPC dispatcher ─────────────────────────────────────────────────────

function handleRpc(
	line: string,
	sock: net.Socket,
	raw: ReturnType<typeof getRawDb>,
	monitor: MonitorService,
): void {
	let req: RpcRequest;
	try {
		req = JSON.parse(line) as RpcRequest;
	} catch {
		return;
	}

	const { id, method, params } = req;
	const p = (params ?? {}) as Record<string, unknown>;

	const reply = (result: unknown) => {
		sock.write(JSON.stringify({ id, result }) + "\n");
	};
	const replyErr = (code: number, message: string) => {
		sock.write(JSON.stringify({ id, error: { code, message } }) + "\n");
	};

	try {
		switch (method) {
			// ─────────────────────────── plots ──────────────────────────────────────

			case "plots:list": {
				const rows = raw
					.prepare("SELECT * FROM plots ORDER BY updated_at DESC LIMIT 100")
					.all() as PlotRow[];
				reply(rows.map(plotToApi));
				break;
			}

			case "plots:get": {
				const row = raw
					.prepare("SELECT * FROM plots WHERE id = ?")
					.get(p["id"]) as PlotRow | undefined;
				reply(row ? plotToApi(row) : null);
				break;
			}

			case "plots:create": {
				const inp = p as {
					name: string;
					projectId: string;
					agentAdapter?: string;
					groundId?: string;
					branch?: string;
				};
				const branch = inp.branch ?? `setra/plot-${Date.now()}`;
				const agentTemplate = JSON.stringify({
					name: inp.agentAdapter ?? "claude",
				});
				raw
					.prepare(
						"INSERT INTO plots (name, project_id, branch, ground_id, agent_template) VALUES (?, ?, ?, ?, ?)",
					)
					.run(
						inp.name,
						inp.projectId,
						branch,
						inp.groundId ?? null,
						agentTemplate,
					);
				const created = raw
					.prepare("SELECT * FROM plots WHERE branch = ?")
					.get(branch) as PlotRow | undefined;
				reply(created ? plotToApi(created) : null);
				break;
			}

			case "plots:delete": {
				raw.prepare("DELETE FROM plots WHERE id = ?").run(p["id"]);
				reply(null);
				break;
			}

			// ─────────────────────────── runs ───────────────────────────────────────

			case "runs:list": {
				const plotId = p["plotId"] as string | undefined;
				const rows = (
					plotId
						? raw
								.prepare(
									"SELECT * FROM runs WHERE plot_id = ? ORDER BY started_at DESC LIMIT 100",
								)
								.all(plotId)
						: raw
								.prepare(
									"SELECT * FROM runs ORDER BY started_at DESC LIMIT 100",
								)
								.all()
				) as RunRow[];
				reply(rows.map(runToApi));
				break;
			}

			case "runs:get": {
				const row = raw
					.prepare("SELECT * FROM runs WHERE id = ?")
					.get(p["runId"]) as RunRow | undefined;
				reply(row ? runToApi(row) : null);
				break;
			}

			case "runs:start": {
				void handleRunStart(p, raw, reply, replyErr);
				break;
			}

			case "runs:stop": {
				const runId = p["runId"] as string;
				const row = raw.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as
					| RunRow
					| undefined;
				if (!row) {
					replyErr(404, "run not found");
					break;
				}
				if (row.tmux_session) {
					try {
						execSync(`tmux kill-session -t ${row.tmux_session} 2>/dev/null`);
					} catch {
						/* gone */
					}
				}
				raw
					.prepare("UPDATE runs SET status = ?, ended_at = ? WHERE id = ?")
					.run("cancelled", nowIso(), runId);
				pushToClients({
					type: "run:status",
					plotId: row.plot_id,
					runId,
					status: "error",
				});
				reply(null);
				break;
			}

			case "runs:pause":
			case "runs:resume": {
				reply(null);
				break;
			}

			case "runs:output": {
				const runId = p["runId"] as string;
				const last = typeof p["last"] === "number" ? p["last"] : 500;
				const rows = raw
					.prepare(
						"SELECT * FROM chunks WHERE run_id = ? ORDER BY sequence DESC LIMIT ?",
					)
					.all(runId, last) as ChunkRow[];
				reply(
					rows
						.reverse()
						.map((ch) => ch.content)
						.join(""),
				);
				break;
			}

			// ─────────────────────────── grounds ────────────────────────────────────

			case "grounds:list": {
				reply(
					(raw.prepare("SELECT * FROM grounds").all() as GroundRow[]).map(
						groundToApi,
					),
				);
				break;
			}

			case "grounds:get": {
				const row = raw
					.prepare("SELECT * FROM grounds WHERE id = ?")
					.get(p["id"]) as GroundRow | undefined;
				reply(row ? groundToApi(row) : null);
				break;
			}

			case "grounds:create": {
				const inp = p as {
					name: string;
					host: string;
					user: string;
					port?: number;
					identityPath?: string;
				};
				raw
					.prepare(
						"INSERT INTO grounds (name, host, username, port, auth_type, key_path) VALUES (?, ?, ?, ?, ?, ?)",
					)
					.run(
						inp.name,
						inp.host,
						inp.user,
						inp.port ?? 22,
						inp.identityPath ? "key" : "agent",
						inp.identityPath ?? null,
					);
				const created = raw
					.prepare("SELECT * FROM grounds WHERE name = ?")
					.get(inp.name) as GroundRow | undefined;
				reply(created ? groundToApi(created) : null);
				break;
			}

			case "grounds:test": {
				const row = raw
					.prepare("SELECT * FROM grounds WHERE id = ?")
					.get(p["id"]) as GroundRow | undefined;
				if (!row) {
					replyErr(404, "ground not found");
					break;
				}
				const t0 = Date.now();
				try {
					execSync(
						`ssh -o ConnectTimeout=5 -o BatchMode=yes -p ${row.port} ${row.username}@${row.host} exit`,
						{ stdio: "pipe", timeout: 6000 },
					);
					const ms = Date.now() - t0;
					raw
						.prepare(
							"UPDATE grounds SET status = 'connected', last_ping_at = ? WHERE id = ?",
						)
						.run(nowIso(), row.id);
					reply({ ok: true, latencyMs: ms });
				} catch (err) {
					raw
						.prepare("UPDATE grounds SET status = 'error' WHERE id = ?")
						.run(row.id);
					reply({ ok: false, latencyMs: Date.now() - t0, error: String(err) });
				}
				break;
			}

			// ─────────────────────────── traces ─────────────────────────────────────

			case "traces:search": {
				void handleTracesSearch(p, reply);
				break;
			}

			case "traces:list": {
				reply([]);
				break;
			}

			// ─────────────────────────── ledger ─────────────────────────────────────

			case "ledger:summary": {
				const rows = raw
					.prepare(
						"SELECT cost_usd, prompt_tokens, completion_tokens FROM runs",
					)
					.all() as Array<{
					cost_usd: number;
					prompt_tokens: number;
					completion_tokens: number;
				}>;
				const totalUsd = rows.reduce((s, r) => s + r.cost_usd, 0);
				const totalTokens = rows.reduce(
					(s, r) => s + r.prompt_tokens + r.completion_tokens,
					0,
				);
				reply({ totalUsd, totalTokens, runCount: rows.length });
				break;
			}

			case "ledger:by-plot": {
				const runRows = raw
					.prepare("SELECT plot_id, cost_usd FROM runs")
					.all() as Array<{ plot_id: string; cost_usd: number }>;
				const plotRows = raw
					.prepare("SELECT id, name FROM plots")
					.all() as Array<{ id: string; name: string }>;
				const byPlot = new Map<
					string,
					{ totalUsd: number; runCount: number }
				>();
				for (const r of runRows) {
					const e = byPlot.get(r.plot_id) ?? { totalUsd: 0, runCount: 0 };
					byPlot.set(r.plot_id, {
						totalUsd: e.totalUsd + r.cost_usd,
						runCount: e.runCount + 1,
					});
				}
				reply(
					[...byPlot.entries()].map(([plotId, data]) => ({
						plotId,
						plotName: plotRows.find((pl) => pl.id === plotId)?.name ?? plotId,
						...data,
					})),
				);
				break;
			}

			case "ledger:by-day": {
				const runRows = raw
					.prepare("SELECT started_at, cost_usd FROM runs")
					.all() as Array<{ started_at: string; cost_usd: number }>;
				const byDay = new Map<string, { totalUsd: number; runCount: number }>();
				for (const r of runRows) {
					const date = r.started_at.slice(0, 10);
					const e = byDay.get(date) ?? { totalUsd: 0, runCount: 0 };
					byDay.set(date, {
						totalUsd: e.totalUsd + r.cost_usd,
						runCount: e.runCount + 1,
					});
				}
				reply(
					[...byDay.entries()]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([date, data]) => ({ date, ...data })),
				);
				break;
			}

			// ─────────────────────────── marks ──────────────────────────────────────

			case "marks:create": {
				const { plotId, message } = p as { plotId: string; message?: string };
				try {
					const hash = execSync("git rev-parse HEAD", {
						cwd: process.cwd(),
						stdio: "pipe",
					})
						.toString()
						.trim();
					const branch = execSync("git branch --show-current", {
						cwd: process.cwd(),
						stdio: "pipe",
					})
						.toString()
						.trim();
					raw
						.prepare(
							"INSERT INTO marks (plot_id, commit_hash, branch, message, mark_type) VALUES (?, ?, ?, ?, 'manual')",
						)
						.run(plotId, hash, branch, message ?? null);
					const created = raw
						.prepare(
							"SELECT * FROM marks WHERE plot_id = ? ORDER BY created_at DESC LIMIT 1",
						)
						.get(plotId) as MarkRow | undefined;
					reply(created ? markToApi(created) : null);
				} catch (err) {
					replyErr(500, err instanceof Error ? err.message : String(err));
				}
				break;
			}

			case "marks:list": {
				const rows = raw
					.prepare("SELECT * FROM marks WHERE plot_id = ?")
					.all(p["plotId"]) as MarkRow[];
				reply(rows.map(markToApi));
				break;
			}

			// ─────────────────────────── daemon ─────────────────────────────────────

			case "daemon:status": {
				const activeRuns = (
					raw
						.prepare("SELECT COUNT(*) as n FROM runs WHERE status = 'running'")
						.get() as { n: number }
				).n;
				reply({
					pid: process.pid,
					version: PKG_VERSION,
					uptime: Math.floor((Date.now() - START_TIME) / 1000),
					activeRuns,
					socketPath: "",
				});
				break;
			}

			case "daemon:version": {
				reply(PKG_VERSION);
				break;
			}

			// ─────────────────────────── monitor ────────────────────────────────────

			case "monitor:stats": {
				reply(monitor.getSnapshot());
				break;
			}

			default:
				replyErr(-32601, `Method not found: ${method}`);
		}
	} catch (err: unknown) {
		replyErr(-32603, err instanceof Error ? err.message : String(err));
	}
}

// ─── runs:start (async) ───────────────────────────────────────────────────────

async function handleRunStart(
	p: Record<string, unknown>,
	raw: ReturnType<typeof getRawDb>,
	reply: (result: unknown) => void,
	replyErr: (code: number, message: string) => void,
): Promise<void> {
	try {
		const plotId = p["plotId"] as string;
		const task = (p["task"] as string | undefined) ?? "";
		const modelHint = (p["model"] as string | undefined) ?? "auto";

		const plotRow = raw
			.prepare("SELECT * FROM plots WHERE id = ?")
			.get(plotId) as PlotRow | undefined;
		if (!plotRow) {
			replyErr(404, `plot not found: ${plotId}`);
			return;
		}

		// Resolve adapter name from the plot's agentTemplate JSON
		let agentName = "claude";
		if (plotRow.agent_template) {
			try {
				const tmpl = JSON.parse(plotRow.agent_template) as {
					name?: string;
					model?: string;
				};
				agentName = tmpl.name ?? tmpl.model ?? "claude";
			} catch {
				/* ignore */
			}
		}

		const adapter: AgentAdapter | undefined = getAdapter(agentName);
		if (!adapter) {
			replyErr(400, `no adapter registered for agent: ${agentName}`);
			return;
		}

		const runId = crypto.randomUUID();
		const tmuxSession = `setra-${runId.slice(0, 8)}`;
		const workDir = plotRow.worktree_path ?? process.cwd();

		// Insert run record (status = running)
		raw
			.prepare(
				"INSERT INTO runs (id, plot_id, agent, status, tmux_session) VALUES (?, ?, ?, 'running', ?)",
			)
			.run(runId, plotId, agentName, tmuxSession);

		const runRow = raw.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as
			| RunRow
			| undefined;
		if (!runRow) {
			replyErr(500, "failed to insert run");
			return;
		}

		// Reply immediately so the TUI can display the new run
		reply(runToApi(runRow));

		// Build spawn options from the adapter
		const plotArg = {
			id: plotRow.id,
			name: plotRow.name,
			worktreePath: workDir,
			branch: plotRow.branch,
		};
		const runArg = {
			id: runId,
			plotId,
			agent: agentName,
			model: modelHint,
			task,
		};
		const spawnOpts = adapter.buildCommand(plotArg, runArg, "");

		// Build env for the child (merge adapter overrides on top of current env)
		const childEnv: Record<string, string> = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (v !== undefined) childEnv[k] = v;
		}
		for (const [k, v] of Object.entries(spawnOpts.env)) {
			if (v !== undefined) childEnv[k] = v;
		}

		// Spawn inside a new detached tmux session
		const tmuxResult = spawnSync(
			"tmux",
			[
				"new-session",
				"-d",
				"-s",
				tmuxSession,
				"-c",
				spawnOpts.cwd,
				spawnOpts.cmd,
				...spawnOpts.args,
			],
			{ env: childEnv, stdio: "pipe" },
		);

		if (tmuxResult.status !== 0) {
			const errMsg = (tmuxResult.stderr?.toString() ?? "tmux failed").trim();
			raw
				.prepare(
					"UPDATE runs SET status = 'failed', ended_at = ?, error_message = ? WHERE id = ?",
				)
				.run(nowIso(), errMsg, runId);
			pushToClients({ type: "run:status", plotId, runId, status: "error" });
			return;
		}

		pushToClients({ type: "run:status", plotId, runId, status: "running" });
		watchTmuxSession(tmuxSession, runId, plotId, raw);
	} catch (err: unknown) {
		replyErr(-32603, err instanceof Error ? err.message : String(err));
	}
}

// ─── Watch tmux session, push output chunks ───────────────────────────────────

function watchTmuxSession(
	session: string,
	runId: string,
	plotId: string,
	raw: ReturnType<typeof getRawDb>,
): void {
	let seq = 0;
	let done = false;
	let lastContent = "";

	const poll = async (): Promise<void> => {
		if (done) return;

		// Check if the session is still alive
		try {
			await execAsync(`tmux has-session -t ${session}`);
		} catch {
			done = true;
			raw
				.prepare(
					"UPDATE runs SET status = 'completed', ended_at = ? WHERE id = ?",
				)
				.run(nowIso(), runId);
			pushToClients({ type: "run:status", plotId, runId, status: "done" });
			return;
		}

		// Capture visible pane content and send only new bytes
		try {
			const { stdout } = await execAsync(`tmux capture-pane -t ${session} -p`);
			if (stdout !== lastContent) {
				const newContent =
					stdout.length > lastContent.length
						? stdout.slice(lastContent.length)
						: stdout;
				if (newContent.trim()) {
					seq++;
					try {
						raw
							.prepare(
								"INSERT INTO chunks (run_id, sequence, content) VALUES (?, ?, ?)",
							)
							.run(runId, seq, newContent);
					} catch {
						/* ignore duplicate sequence */
					}
					pushToClients({
						type: "run:output",
						plotId,
						runId,
						chunk: newContent,
					});
				}
				lastContent = stdout;
			}
		} catch {
			/* ignore capture errors */
		}

		setTimeout(() => {
			void poll();
		}, 1000);
	};

	setTimeout(() => {
		void poll();
	}, 500);
}

// ─── traces:search (async) ────────────────────────────────────────────────────

async function handleTracesSearch(
	p: Record<string, unknown>,
	reply: (result: unknown) => void,
): Promise<void> {
	try {
		const store = getMemoryStore();
		await store.init();
		const results = await store.search(p["query"] as string, {
			limit: typeof p["limit"] === "number" ? p["limit"] : 10,
			plotId: typeof p["plotId"] === "string" ? p["plotId"] : undefined,
		});
		reply(
			results.map((r) => ({
				id: r.entry.id,
				plotId: r.entry.plotId ?? "",
				runId: r.entry.sessionId ?? "",
				summary: r.entry.content.slice(0, 120),
				content: r.entry.content,
				score: r.score,
				createdAt: new Date(r.entry.createdAt).toISOString(),
			})),
		);
	} catch {
		reply([]);
	}
}

// ─── DB row → API type mappers ────────────────────────────────────────────────

function plotToApi(row: PlotRow) {
	let agentAdapter = "claude";
	if (row.agent_template) {
		try {
			const tmpl = JSON.parse(row.agent_template) as {
				name?: string;
				model?: string;
			};
			agentAdapter = tmpl.name ?? tmpl.model ?? "claude";
		} catch {
			/* ignore */
		}
	}
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		branch: row.branch,
		groundId: row.ground_id ?? undefined,
		projectId: row.project_id,
		agentAdapter,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function runToApi(row: RunRow) {
	const statusMap: Record<string, string> = {
		pending: "pending",
		running: "running",
		completed: "done",
		failed: "error",
		cancelled: "error",
	};
	return {
		id: row.id,
		plotId: row.plot_id,
		status: statusMap[row.status] ?? row.status,
		startedAt: row.started_at,
		finishedAt: row.ended_at ?? undefined,
		costUsd: row.cost_usd,
		totalTokens: row.prompt_tokens + row.completion_tokens,
		tmuxSession: row.tmux_session ?? undefined,
		groundId: row.ground_id ?? undefined,
	};
}

function groundToApi(row: GroundRow) {
	const statusMap: Record<string, "connected" | "disconnected" | "unknown"> = {
		connected: "connected",
		disconnected: "disconnected",
		unknown: "unknown",
		error: "unknown",
	};
	return {
		id: row.id,
		name: row.name,
		host: row.host,
		user: row.username,
		port: row.port,
		status: statusMap[row.status] ?? "unknown",
	};
}

function markToApi(row: MarkRow) {
	return {
		id: row.id,
		plotId: row.plot_id,
		sha: row.commit_hash,
		message: row.message ?? "",
		createdAt: row.created_at,
	};
}

// ─── HTTP server (health + discovery) ─────────────────────────────────────────

function buildHttpServer(name: string, _port: number): http.Server {
	return http.createServer((req, res) => {
		void handleHttpRequest(req, res, name);
	});
}

async function handleHttpRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	name: string,
): Promise<void> {
	const url = new URL(
		req.url ?? "/",
		`http://${req.headers.host ?? "localhost"}`,
	);
	res.setHeader("Content-Type", "application/json");

	if (req.method === "GET" && url.pathname === "/health") {
		sendJson(res, 200, { ok: true });
		return;
	}

	if (req.method === "GET" && url.pathname === "/status") {
		sendJson(res, 200, {
			version: PKG_VERSION,
			pid: process.pid,
			name,
			projectDir: process.cwd(),
			uptime: Math.floor((Date.now() - START_TIME) / 1000),
			agentCount: connectedClients.size,
		});
		return;
	}

	if (req.method === "GET" && url.pathname === "/instances") {
		sendJson(res, 200, readInstanceRegistry());
		return;
	}

	const projectChat = url.pathname.match(/^\/api\/projects\/([^/]+)\/chat$/);
	if (req.method === "POST" && projectChat) {
		const body = (await readJsonBody(req)) as {
			message?: string;
			agentSlug?: string;
		};
		const response = buildChatResponse({
			projectId: projectChat[1],
			agentSlug: body.agentSlug ?? "ceo",
			message: body.message ?? "",
		});
		res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
		for (const line of response.split("\n")) {
			res.write(line + "\n");
			await sleep(80);
		}
		res.end();
		return;
	}

	const projectVault = url.pathname.match(
		/^\/api\/projects\/([^/]+)\/vault(?:\/([^/]+))?$/,
	);
	const globalVault = url.pathname.match(/^\/api\/vault(?:\/([^/]+))?$/);
	const vaultProjectId = projectVault?.[1] ?? null;
	const vaultKey = decodeURIComponent(
		projectVault?.[2] ?? globalVault?.[1] ?? "",
	);
	if (projectVault || globalVault) {
		if (req.method === "GET" && vaultKey) {
			const entry = await getVaultEntryLocal(
				vaultKey,
				vaultProjectId ?? undefined,
			);
			sendJson(res, 200, entry);
			return;
		}
		if (req.method === "GET") {
			const entries = await listVaultEntriesLocal(vaultProjectId ?? undefined);
			sendJson(res, 200, entries);
			return;
		}
		if (req.method === "POST") {
			const body = (await readJsonBody(req)) as {
				key?: string;
				value?: string;
			};
			if (!body.key || body.value == null) {
				sendJson(res, 400, { error: "key and value are required" });
				return;
			}
			await setVaultEntryLocal(
				body.key,
				body.value,
				vaultProjectId ?? undefined,
			);
			sendJson(res, 200, { ok: true });
			return;
		}
		if (req.method === "DELETE" && vaultKey) {
			const deleted = await deleteVaultEntryLocal(
				vaultKey,
				vaultProjectId ?? undefined,
			);
			sendJson(res, 200, { deleted });
			return;
		}
	}

	if (req.method === "POST" && url.pathname === "/api/dispatch") {
		const body = (await readJsonBody(req)) as {
			task?: string;
			agents?: string[];
			budget?: number;
		};
		if (!body.task) {
			sendJson(res, 400, { error: "task is required" });
			return;
		}
		sendJson(
			res,
			200,
			await startDispatchLocal({
				task: body.task,
				agents: body.agents,
				budget: body.budget,
			}),
		);
		return;
	}

	const dispatchRoute = url.pathname.match(/^\/api\/dispatch\/([^/]+)$/);
	if (req.method === "GET" && dispatchRoute) {
		sendJson(res, 200, await getDispatchStatusLocal(dispatchRoute[1]!));
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/activity") {
		sendJson(
			res,
			200,
			await getActivityFeedLocal({
				limit: Number.parseInt(url.searchParams.get("limit") ?? "20", 10),
				since: url.searchParams.get("since") ?? undefined,
			}),
		);
		return;
	}

	const deployRoute = url.pathname.match(/^\/api\/projects\/([^/]+)\/deploy$/);
	if (req.method === "POST" && deployRoute) {
		const body = (await readJsonBody(req)) as { env?: string };
		sendJson(
			res,
			200,
			await startDeploymentLocal({
				projectId: deployRoute[1] ?? (await resolveProjectId()) ?? "",
				environment: body.env ?? "production",
			}),
		);
		return;
	}

	const deployStatusRoute = url.pathname.match(/^\/api\/deploy\/([^/]+)$/);
	if (req.method === "GET" && deployStatusRoute) {
		sendJson(res, 200, await getDeploymentStatusLocal(deployStatusRoute[1]!));
		return;
	}

	sendJson(res, 404, { error: "not found" });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(
	res: http.ServerResponse,
	status: number,
	body: unknown,
): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowIso(): string {
	return new Date().toISOString();
}

// ─── Detach helper ────────────────────────────────────────────────────────────

async function startDetached(
	socketPath: string,
	port: number,
	name: string,
): Promise<void> {
	const { execa } = await import("execa");
	const child = execa(
		process.execPath,
		[
			process.argv[1]!,
			"serve",
			"--socket",
			socketPath,
			"--port",
			String(port),
			"--name",
			name,
		],
		{
			detached: true,
			stdio: "ignore",
			env: { ...process.env, SETRA_DAEMON: "1" },
		},
	);
	child.unref();
	console.log(`  ${icon.done} setra daemon started (pid ${child.pid ?? "?"})`);
}

function resolveSocketPath(
	p: string | undefined,
	setraHome: string,
	name: string,
): string {
	if (!p) return path.join(setraHome, "instances", `${name}.sock`);
	return p.replace(/^~/, os.homedir());
}
