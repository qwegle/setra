/**
 * codex-runner.ts — server-side `codex exec` wrapper.
 *
 * Codex CLI v0.128+ supports non-interactive `codex exec` which authenticates
 * via `codex login` (OAuth, ChatGPT subscription) — no API key needed.
 * That makes it usable from the control-plane server (no Electron PTY required)
 * as long as `~/.codex/auth.json` exists for the user the server runs as.
 *
 * This module owns:
 *   - login pre-flight detection (~/.codex/auth.json schema-flexible)
 *   - spawning `codex exec` using the registered `codexAdapter.buildCommand()`
 *     so adapter behaviour (flags, env, parsers) stays the single source of truth
 *   - governance gating: `--dangerously-bypass-approvals-and-sandbox` is only
 *     applied when policy.requireApprovalForToolUse is false
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexAdapter, loadGovernancePolicy } from "@setra/agent-runner";
import type { LlmCallResult } from "../types.js";

const STRIP_ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJsu]/g;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface CodexExecInput {
	model: string;
	systemPrompt: string | null;
	task: string;
	cwd?: string;
	runId?: string;
	timeoutMs?: number;
}

/**
 * Returns true when codex has a usable OAuth/API session.
 * Tolerates several auth.json schemas seen across codex CLI versions.
 */
export function isCodexLoggedIn(): boolean {
	try {
		const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
		const authFile = join(home, ".codex", "auth.json");
		if (!existsSync(authFile)) return false;
		const data = JSON.parse(readFileSync(authFile, "utf-8")) as Record<
			string,
			unknown
		>;
		const tokens = (data.tokens ?? {}) as Record<string, unknown>;
		return Boolean(
			tokens.access_token ||
				tokens.id_token ||
				tokens.refresh_token ||
				data.access_token ||
				data.id_token ||
				data.token ||
				data.OPENAI_API_KEY,
		);
	} catch {
		return false;
	}
}

export class CodexLoginRequiredError extends Error {
	readonly code = "CODEX_LOGIN_REQUIRED" as const;
	constructor() {
		super(
			'Codex CLI is not authenticated. Run `codex login` on the host (or call POST /api/runtime/cli-login with {"tool":"codex"} from a desktop session).',
		);
	}
}

export class CodexNotInstalledError extends Error {
	readonly code = "CODEX_NOT_INSTALLED" as const;
	constructor() {
		super(
			'Codex CLI not found on PATH. Install via POST /api/runtime/install-cli {"tool":"codex"} or `npm i -g @openai/codex`.',
		);
	}
}

export async function ensureCodexReady(): Promise<void> {
	if (!(await codexAdapter.isAvailable())) {
		throw new CodexNotInstalledError();
	}
	if (!isCodexLoggedIn()) {
		throw new CodexLoginRequiredError();
	}
}

interface BuiltCodexCommand {
	cmd: string;
	args: string[];
	env: Record<string, string | undefined>;
	cwd?: string | undefined;
}

/**
 * Build the `codex exec` invocation via the registered adapter so flags stay
 * in one place. Governance policy can strip the dangerous bypass flag when
 * approvals are required.
 */
function buildCodexCommand(input: CodexExecInput): BuiltCodexCommand {
	const fakePlot = {
		id: "server-run",
		name: "server-run",
		worktreePath: input.cwd ?? process.cwd(),
		branch: "main",
	};
	const fakeRun = {
		id: input.runId ?? "server-run",
		plotId: fakePlot.id,
		agent: codexAdapter.name,
		model: input.model,
		task: input.task,
		...(input.systemPrompt ? { systemPromptAppend: input.systemPrompt } : {}),
	};
	const built = codexAdapter.buildCommand(fakePlot, fakeRun, "");

	let args = [...built.args];
	const policy = loadGovernancePolicy();
	if (policy.requireApprovalForToolUse) {
		args = args.filter(
			(a) => a !== "--dangerously-bypass-approvals-and-sandbox",
		);
	}

	return {
		cmd: built.cmd,
		args,
		env: built.env,
		cwd: input.cwd ?? built.cwd,
	};
}

interface ParsedCodexOutput {
	content: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		cacheReadTokens: number;
	};
	costUsd: number;
}

function parseCodexOutput(raw: string): ParsedCodexOutput {
	const clean = raw.replace(STRIP_ANSI_RE, "");
	const usage = codexAdapter.parseTokenUsage(clean) ?? {
		promptTokens: 0,
		completionTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	const costUsd = codexAdapter.parseCostUSD(clean) ?? 0;

	const lines = clean.split("\n");
	const replyLines: string[] = [];
	let inReply = false;
	let skipUntilBlank = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (/^codex$/i.test(trimmed)) {
			inReply = true;
			continue;
		}
		if (/^user$/i.test(trimmed) && inReply) break;
		if (/^Usage$/i.test(trimmed)) break;
		if (/^tokens used$/i.test(trimmed)) break;
		if (!inReply) continue;
		if (/^exec$/.test(trimmed)) {
			skipUntilBlank = true;
			continue;
		}
		if (skipUntilBlank) {
			if (trimmed === "") skipUntilBlank = false;
			continue;
		}
		if (/^\{/.test(trimmed) && /\}$/.test(trimmed)) continue;
		if (/^(succeeded|failed) in \d+ms:?$/.test(trimmed)) continue;
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
 * Run `codex exec` once, returning the parsed result.
 * Throws CodexLoginRequiredError / CodexNotInstalledError on pre-flight failure.
 */
export async function callCodexExecOnce(
	input: CodexExecInput,
): Promise<LlmCallResult> {
	await ensureCodexReady();

	const built = buildCodexCommand(input);
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
			reject(new Error(`codex exec failed to spawn: ${err.message}`));
		});
		proc.on("close", (exitCode) => {
			clearTimeout(timer);
			const raw = Buffer.concat(chunks).toString("utf8");
			if (timedOut) {
				reject(
					new Error(
						`codex exec timed out after ${Math.round(timeoutMs / 1000)}s`,
					),
				);
				return;
			}
			if (exitCode !== 0 && !raw.trim()) {
				reject(new Error(`codex exec exited with ${exitCode} (no output)`));
				return;
			}
			const parsed = parseCodexOutput(raw);
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
