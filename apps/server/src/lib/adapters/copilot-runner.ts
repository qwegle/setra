/**
 * copilot-runner.ts — server-side `copilot` (GitHub Copilot CLI) wrapper.
 *
 * The Copilot CLI authenticates via `copilot auth login` (device-code OAuth
 * tied to a GitHub Copilot subscription). Once authenticated the binary can
 * be driven non-interactively from the control-plane server, mirroring the
 * shape of codex-runner.ts.
 *
 * This module owns:
 *   - login pre-flight detection via `copilot auth status`
 *   - spawning the binary using the registered `copilotAdapter.buildCommand()`
 *     so flag/parser ownership stays with the adapter
 *   - governance-aware stripping of --allow-all-tools when policy requires
 *     per-tool approval
 */

import { spawn, spawnSync } from "node:child_process";
import { copilotAdapter, loadGovernancePolicy } from "@setra/agent-runner";
import type { LlmCallResult } from "../types.js";

const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface CopilotExecInput {
	model: string;
	systemPrompt: string | null;
	task: string;
	cwd?: string;
	runId?: string;
	timeoutMs?: number;
}

export class CopilotLoginRequiredError extends Error {
	readonly code = "COPILOT_LOGIN_REQUIRED" as const;
	constructor() {
		super(
			'GitHub Copilot CLI is not authenticated. Run `copilot auth login` on the host (or call POST /api/runtime/cli-login with {"tool":"copilot"} from a desktop session).',
		);
	}
}

export class CopilotNotInstalledError extends Error {
	readonly code = "COPILOT_NOT_INSTALLED" as const;
	constructor() {
		super(
			'GitHub Copilot CLI not found on PATH. Install via POST /api/runtime/install-cli {"tool":"copilot"} or follow https://github.com/github/copilot-cli.',
		);
	}
}

/**
 * Returns true when `copilot auth status` exits 0 — the CLI's own contract
 * for "subscription valid and tokens fresh".
 */
export function isCopilotLoggedIn(): boolean {
	try {
		const result = spawnSync("copilot", ["auth", "status"], {
			stdio: "pipe",
			timeout: 5000,
		});
		return result.status === 0;
	} catch {
		return false;
	}
}

export async function ensureCopilotReady(): Promise<void> {
	const which = spawnSync("which", ["copilot"], { stdio: "pipe" });
	if (which.status !== 0) throw new CopilotNotInstalledError();
	if (!isCopilotLoggedIn()) throw new CopilotLoginRequiredError();
}

interface BuiltCopilotCommand {
	cmd: string;
	args: string[];
	env: Record<string, string | undefined>;
	cwd?: string | undefined;
}

function buildCopilotCommand(input: CopilotExecInput): BuiltCopilotCommand {
	const fakePlot = {
		id: "server-run",
		name: "server-run",
		worktreePath: input.cwd ?? process.cwd(),
		branch: "main",
	};
	const fakeRun = {
		id: input.runId ?? "server-run",
		plotId: fakePlot.id,
		agent: copilotAdapter.name,
		model: input.model,
		task: input.task,
		...(input.systemPrompt ? { systemPromptAppend: input.systemPrompt } : {}),
	};
	const built = copilotAdapter.buildCommand(fakePlot, fakeRun, "");
	let args = [...built.args];
	const policy = loadGovernancePolicy();
	if (policy.requireApprovalForToolUse) {
		args = args.filter((a) => a !== "--allow-all-tools");
	}
	return {
		cmd: built.cmd,
		args,
		env: built.env,
		cwd: input.cwd ?? built.cwd,
	};
}

interface ParsedCopilotOutput {
	content: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		cacheReadTokens: number;
	};
	costUsd: number;
}

function parseCopilotOutput(raw: string): ParsedCopilotOutput {
	const clean = raw.replace(STRIP_ANSI_RE, "");
	const usage = copilotAdapter.parseTokenUsage(clean) ?? {
		promptTokens: 0,
		completionTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	const costUsd = copilotAdapter.parseCostUSD(clean) ?? 0;
	const lines = clean.split("\n");
	const replyLines: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^total tokens/i.test(trimmed)) break;
		if (/^session ended/i.test(trimmed)) break;
		if (/^prompt tokens?:/i.test(trimmed)) continue;
		if (/^completion tokens?:/i.test(trimmed)) continue;
		replyLines.push(line);
	}
	const content =
		replyLines.length > 0 ? replyLines.join("\n").trim() : clean.trim();
	return {
		content,
		usage: {
			promptTokens: usage.promptTokens,
			completionTokens: usage.completionTokens,
			cacheReadTokens: usage.cacheReadTokens,
		},
		costUsd,
	};
}

/**
 * Run the Copilot CLI once, returning the parsed result.
 * Throws CopilotLoginRequiredError / CopilotNotInstalledError on pre-flight failure.
 */
export async function callCopilotExecOnce(
	input: CopilotExecInput,
): Promise<LlmCallResult> {
	await ensureCopilotReady();
	const built = buildCopilotCommand(input);
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return new Promise<LlmCallResult>((resolve, reject) => {
		const env: NodeJS.ProcessEnv = { ...process.env };
		for (const [k, v] of Object.entries(built.env)) {
			if (v === undefined) delete env[k];
			else env[k] = v;
		}
		const proc = spawn(built.cmd, built.args, {
			...(built.cwd ? { cwd: built.cwd } : {}),
			stdio: ["ignore", "pipe", "pipe"],
			env,
		});
		const chunks: Buffer[] = [];
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGTERM");
			setTimeout(() => proc.kill("SIGKILL"), 5_000).unref();
		}, timeoutMs);
		timer.unref();
		proc.stdout?.on("data", (d: Buffer) => chunks.push(d));
		proc.stderr?.on("data", (d: Buffer) => chunks.push(d));
		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(new Error(`copilot failed to spawn: ${err.message}`));
		});
		proc.on("close", (exitCode) => {
			clearTimeout(timer);
			const raw = Buffer.concat(chunks).toString("utf8");
			if (timedOut) {
				reject(
					new Error(`copilot timed out after ${Math.round(timeoutMs / 1000)}s`),
				);
				return;
			}
			if (exitCode !== 0 && !raw.trim()) {
				reject(new Error(`copilot exited with ${exitCode} (no output)`));
				return;
			}
			const parsed = parseCopilotOutput(raw);
			resolve({
				content: parsed.content,
				usage: {
					promptTokens: parsed.usage.promptTokens,
					completionTokens: parsed.usage.completionTokens,
					cacheReadTokens: parsed.usage.cacheReadTokens,
					cacheWriteTokens: 0,
				},
				costUsd: parsed.costUsd,
			});
		});
	});
}
