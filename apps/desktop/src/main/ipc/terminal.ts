import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getDb, schema } from "@setra/db";
import {
	TerminalResizeInputSchema,
	TerminalSpawnInputSchema,
	TerminalWriteInputSchema,
} from "@setra/types";
import { eq } from "drizzle-orm";
import { BrowserWindow, ipcMain } from "electron";
import type { IPty } from "node-pty";
import { z } from "zod";
import { getAgentEnvOverrides } from "./settings.js";
// Map<runId, { pty, chunkSequence }>
interface PtySession {
	pty: IPty;
	chunkSequence: number;
	runId: string;
	plotId: string;
}

const activeSessions = new Map<string, PtySession>();

// Cost parser — extract token/cost info from PTY output
// Claude Code prints lines like: "Cost: $0.0123 (1234 tokens)"
// Each agent prints differently — this covers Claude; extend per-agent.
const COST_PATTERNS = [
	// Claude Code: "API Cost: $0.0234"
	/api\s+cost:?\s*\$?([\d.]+)/i,
	// Claude Code verbose: "Total cost: $X.XX"
	/total\s+cost:?\s*\$?([\d.]+)/i,
	// Generic fallback
	/cost:?\s*\$?([\d.]+)/i,
];

const TOKEN_PATTERNS = {
	// "Input tokens: 1234"
	input: /input\s+tokens?:?\s*([\d,]+)/i,
	// "Output tokens: 567"
	output: /output\s+tokens?:?\s*([\d,]+)/i,
	// "Cache read tokens: 890"
	cacheRead: /cache\s+read\s+tokens?:?\s*([\d,]+)/i,
	// "Cache creation tokens: 123"
	cacheWrite: /cache\s+(?:creation|write)\s+tokens?:?\s*([\d,]+)/i,
};

interface ParsedCost {
	costUsd: number;
	promptTokens?: number;
	completionTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	confidence: "high" | "low";
}

function parseCostFromOutput(text: string): ParsedCost | null {
	let costUsd: number | null = null;
	for (const pattern of COST_PATTERNS) {
		const match = pattern.exec(text);
		if (match?.[1]) {
			costUsd = Number.parseFloat(match[1]);
			break;
		}
	}

	if (costUsd === null) return null;

	const parseTokenCount = (pattern: RegExp): number | undefined => {
		const match = pattern.exec(text);
		if (match?.[1]) return Number.parseInt(match[1].replace(/,/g, ""), 10);
		return undefined;
	};

	const promptTokens = parseTokenCount(TOKEN_PATTERNS.input);
	const completionTokens = parseTokenCount(TOKEN_PATTERNS.output);
	const cacheReadTokens = parseTokenCount(TOKEN_PATTERNS.cacheRead);
	const cacheWriteTokens = parseTokenCount(TOKEN_PATTERNS.cacheWrite);

	// "high" confidence = we got both cost and at least input token count
	const confidence: "high" | "low" =
		promptTokens !== undefined ? "high" : "low";

	return {
		costUsd,
		...(promptTokens !== undefined ? { promptTokens } : {}),
		...(completionTokens !== undefined ? { completionTokens } : {}),
		...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
		...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
		confidence,
	};
}

// Rate limit detector
const RATE_LIMIT_PATTERNS = [
	/rate.?limit/i,
	/429/,
	/quota exceeded/i,
	/too many requests/i,
	/overloaded/i,
];

function isRateLimitMessage(text: string): boolean {
	return RATE_LIMIT_PATTERNS.some((p) => p.test(text));
}

// Terminal IPC handlers
export function registerTerminalHandlers(): void {
	ipcMain.handle("terminal:spawn", async (_event, rawInput: unknown) => {
		const input = TerminalSpawnInputSchema.parse(rawInput);

		// Lazy-load node-pty — it's a native addon, should be asar-unpacked
		const pty = await import("node-pty");

		const tmuxSession = `setra-${input.plotId}`;
		const db = getDb();

		// Ensure the tmux session exists — if not, create it first
		// tmux new-session creates the session but doesn't attach; exits immediately
		const execFileAsync = promisify(execFile);
		try {
			await execFileAsync("tmux", ["has-session", "-t", tmuxSession]);
		} catch {
			// Session doesn't exist — create it in detached mode
			await execFileAsync("tmux", [
				"new-session",
				"-d",
				"-s",
				tmuxSession,
				"-x",
				String(input.cols),
				"-y",
				String(input.rows),
			]);
		}

		// Spawn node-pty that attaches to the tmux session
		// This means if Electron crashes, tmux keeps running and we can re-attach.
		const ptyProcess = pty.spawn(
			"tmux",
			["attach-session", "-t", tmuxSession],
			{
				name: "xterm-256color",
				cols: input.cols,
				rows: input.rows,
				cwd: process.env["HOME"] ?? "/",
				env: {
					...process.env,
					// Inject API keys from settings (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
					...getAgentEnvOverrides(),
					// Terminal capability env vars
					TERM_PROGRAM: "kitty",
					COLORTERM: "truecolor",
					// Inject setra context into the terminal environment
					SETRA_PLOT_ID: input.plotId,
					SETRA_RUN_ID: input.runId,
					// Prompt caching env var (setra pattern — must be set in agent env)
					ANTHROPIC_PROMPT_CACHING: "1",
					// SSL fix for Go binaries like gh on macOS
					...(process.platform === "darwin"
						? { SSL_CERT_FILE: "/etc/ssl/cert.pem" }
						: {}),
				},
			},
		);

		const session: PtySession = {
			pty: ptyProcess,
			chunkSequence: 0,
			runId: input.runId,
			plotId: input.plotId,
		};

		activeSessions.set(input.runId, session);

		// Update the run record with the PTY PID
		db.update(schema.runs)
			.set({ ptyPid: ptyProcess.pid, tmuxSession, status: "running" })
			.where(eq(schema.runs.id, input.runId))
			.run();

		ptyProcess.onData((rawData: string) => {
			// Broadcast to all renderer windows on the run-specific channel
			broadcastToWindows(`terminal:data:${input.runId}`, rawData);

			// Persist the chunk to SQLite (async via queueMicrotask to avoid blocking)
			queueMicrotask(() => {
				const seq = session.chunkSequence++;
				try {
					db.insert(schema.chunks)
						.values({
							runId: input.runId,
							sequence: seq,
							content: rawData,
							chunkType: "output",
						})
						.onConflictDoNothing()
						.run();
				} catch {
					// chunk persistence is non-critical — never crash the PTY over a failed write
				}

				// Try to parse cost information from the output
				const costInfo = parseCostFromOutput(rawData);
				if (costInfo) {
					db.update(schema.runs)
						.set({
							costUsd: costInfo.costUsd,
							costConfidence: costInfo.confidence,
							...(costInfo.promptTokens !== undefined
								? { promptTokens: costInfo.promptTokens }
								: {}),
							...(costInfo.completionTokens !== undefined
								? { completionTokens: costInfo.completionTokens }
								: {}),
							...(costInfo.cacheReadTokens !== undefined
								? { cacheReadTokens: costInfo.cacheReadTokens }
								: {}),
							...(costInfo.cacheWriteTokens !== undefined
								? { cacheWriteTokens: costInfo.cacheWriteTokens }
								: {}),
							updatedAt: new Date().toISOString(),
						})
						.where(eq(schema.runs.id, input.runId))
						.run();

					broadcastToWindows("runs:cost-update", input.runId, costInfo.costUsd);
				}

				// Detect rate limiting and signal the renderer
				if (isRateLimitMessage(rawData)) {
					broadcastToWindows("runs:rate-limited", input.runId);
				}
			});
		});

		ptyProcess.onExit(({ exitCode, signal }) => {
			const code = exitCode ?? (signal ? 1 : 0);
			broadcastToWindows(`terminal:exit:${input.runId}`, code);

			const now = new Date().toISOString();
			db.update(schema.runs)
				.set({
					status: code === 0 ? "completed" : "failed",
					outcome: code === 0 ? "success" : "failed",
					exitCode: code,
					endedAt: now,
					updatedAt: now,
				})
				.where(eq(schema.runs.id, input.runId))
				.run();

			db.update(schema.plots)
				.set({ status: "idle", updatedAt: now })
				.where(eq(schema.plots.id, input.plotId))
				.run();

			broadcastToWindows("plots:status-changed", input.plotId, "idle");
			activeSessions.delete(input.runId);
		});

		return { pid: ptyProcess.pid };
	});

	ipcMain.handle("terminal:write", async (_event, rawInput: unknown) => {
		const input = TerminalWriteInputSchema.parse(rawInput);
		const session = activeSessions.get(input.runId);

		if (!session) {
			throw new Error(`No active terminal session for run: ${input.runId}`);
		}

		session.pty.write(input.data);

		// Also persist user input as a chunk (type 'input')
		const seq = session.chunkSequence++;
		const db = getDb();
		db.insert(schema.chunks)
			.values({
				runId: input.runId,
				sequence: seq,
				content: input.data,
				chunkType: "input",
			})
			.onConflictDoNothing()
			.run();
	});

	ipcMain.handle("terminal:resize", async (_event, rawInput: unknown) => {
		const input = TerminalResizeInputSchema.parse(rawInput);
		const session = activeSessions.get(input.runId);

		if (!session) return; // Not an error — window may have resized before spawn

		// ssh2 closes the channel on resize before the pty is ready — 50ms delay
		// prevents the race condition on reconnect (this will definitely happen).
		await new Promise((resolve) => setTimeout(resolve, 50));
		session.pty.resize(input.cols, input.rows);
	});

	ipcMain.handle("terminal:kill", async (_event, runId: string) => {
		const session = activeSessions.get(runId);

		if (!session) return;

		// Send SIGTERM to the PTY process group
		try {
			session.pty.kill("SIGTERM");
		} catch {
			// Process may have already exited
		}

		activeSessions.delete(runId);

		const now = new Date().toISOString();
		const db = getDb();
		db.update(schema.runs)
			.set({ status: "cancelled", endedAt: now, updatedAt: now })
			.where(eq(schema.runs.id, runId))
			.run();

		db.update(schema.plots)
			.set({ status: "idle", updatedAt: now })
			.where(eq(schema.plots.id, session.plotId))
			.run();

		broadcastToWindows("plots:status-changed", session.plotId, "idle");
	});

	ipcMain.handle("terminal:list-sessions", async () => {
		return Array.from(activeSessions.keys());
	});
}

// Utility: broadcast to all renderer windows
function broadcastToWindows(channel: string, ...args: unknown[]): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, ...args);
		}
	}
}

// Cleanup on process exit — kill all active PTY sessions
process.on("exit", () => {
	for (const session of activeSessions.values()) {
		try {
			session.pty.kill("SIGTERM");
		} catch {
			// best effort
		}
	}
});
