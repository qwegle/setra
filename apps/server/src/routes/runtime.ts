/**
 * Runtime route — small surface for the board to discover what models the
 * current company can actually use right now.
 *
 *   GET /api/runtime/available-models
 *     → [{ id, label, provider, available }]
 *
 * Filtering rules:
 *   1. If the resolved company has `is_offline_only = 1`, drop every model
 *      whose provider is in CLOUD_PROVIDERS — they shouldn't even appear in
 *      pickers in offline mode (per user spec).
 *   2. For each remaining model, compute `available` from the company's
 *      configured keys (or always-on for local providers).
 *
 * The board's AgentsPage / OnboardingWizard / ModelPicker all consume this
 * single endpoint, so the offline-mode filter only needs to live here.
 */

import { exec, execFile, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { tryGetCompanyId } from "../lib/company-scope.js";
import { getCompanySettings } from "../lib/company-settings.js";
import * as runtimeRepo from "../repositories/runtime.repo.js";
import { MODEL_CATALOG } from "./llm.js";

export const runtimeRoute = new Hono();

const CLOUD_PROVIDERS = new Set([
	"anthropic",
	"openai",
	"openrouter",
	"groq",
	"gemini",
	"together",
	"vertex",
	"azure-openai",
]);

const LOCAL_PROVIDERS = new Set([
	"ollama",
	"lmstudio",
	"llama-cpp",
	"mlx-lm",
	"exo",
]);

/** Map provider id → company-settings field name holding its API key. */
const PROVIDER_KEY_FIELD: Record<string, string> = {
	anthropic: "anthropic_api_key",
	openai: "openai_api_key",
	openrouter: "openrouter_api_key",
	groq: "groq_api_key",
	gemini: "gemini_api_key",
	together: "together_api_key",
};

runtimeRoute.get("/available-models", (c) => {
	// This route is publicly mounted (not behind requireCompany), so read the
	// company id opportunistically from middleware context/header/query.
	const cid =
		tryGetCompanyId(c) ??
		c.req.header("x-company-id") ??
		c.req.query("companyId") ??
		null;
	const offline = runtimeRepo.isOfflineForCompany(cid);
	const keys = (getCompanySettings(cid) ?? {}) as Record<string, unknown>;

	const out: Array<{
		id: string;
		label: string;
		provider: string;
		available: boolean;
	}> = [];

	for (const m of MODEL_CATALOG) {
		if (offline && CLOUD_PROVIDERS.has(m.provider)) continue;

		let available = false;
		if (LOCAL_PROVIDERS.has(m.provider)) {
			available = true;
		} else {
			const field = PROVIDER_KEY_FIELD[m.provider];
			if (field) {
				const v = keys[field];
				available = typeof v === "string" && v.length > 0;
			}
		}

		out.push({
			id: m.id,
			label: m.displayName,
			provider: m.provider,
			available,
		});
	}

	return c.json(out);
});

// ─── CLI tool detection ──────────────────────────────────────────────────────
// Checks if codex / claude CLIs are installed and have an active OAuth session.

interface CliToolStatus {
	installed: boolean;
	loggedIn: boolean;
	version: string | null;
}

async function detectCli(
	bin: string,
	authCheck: () => boolean,
): Promise<CliToolStatus> {
	try {
		const path = execSync(
			`which ${bin} 2>/dev/null || command -v ${bin} 2>/dev/null`,
			{
				stdio: "pipe",
				timeout: 5000,
				shell: "/bin/sh",
			},
		)
			.toString()
			.trim();
		if (!path) return { installed: false, loggedIn: false, version: null };

		let version: string | null = null;
		try {
			version = execSync(`${bin} --version 2>/dev/null`, {
				stdio: "pipe",
				timeout: 5000,
				shell: "/bin/sh",
			})
				.toString()
				.trim()
				.slice(0, 80);
		} catch {
			/* version check is best-effort */
		}

		return { installed: true, loggedIn: authCheck(), version };
	} catch {
		return { installed: false, loggedIn: false, version: null };
	}
}

function isCodexLoggedIn(): boolean {
	try {
		const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
		const authFile = path.join(home, ".codex", "auth.json");
		if (!fs.existsSync(authFile)) return false;
		const data = JSON.parse(fs.readFileSync(authFile, "utf-8"));
		return Boolean(
			data?.tokens?.access_token ||
				data?.tokens?.id_token ||
				data?.access_token ||
				data?.token,
		);
	} catch {
		return false;
	}
}

function isClaudeLoggedIn(): boolean {
	try {
		const output = execSync("claude auth status 2>/dev/null", {
			stdio: "pipe",
			timeout: 5000,
			shell: "/bin/sh",
		})
			.toString()
			.trim();
		const data = JSON.parse(output);
		if (data?.loggedIn) return true;
	} catch {
		// Fall through to file check
	}

	try {
		const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
		const paths = [
			path.join(home, ".claude", ".credentials.json"),
			path.join(home, ".claude", "credentials.json"),
		];
		for (const p of paths) {
			if (!fs.existsSync(p)) continue;
			try {
				const data = JSON.parse(fs.readFileSync(p, "utf-8"));
				return Boolean(
					data?.accessToken || data?.token || data?.claudeAiOauth?.accessToken,
				);
			} catch {
				/* skip */
			}
		}
	} catch {
		/* ignore */
	}
	return false;
}

runtimeRoute.get("/cli-status", async (c) => {
	const [codex, claude] = await Promise.all([
		detectCli("codex", isCodexLoggedIn),
		detectCli("claude", isClaudeLoggedIn),
	]);
	return c.json({ codex, claude });
});

runtimeRoute.post("/install-cli", async (c) => {
	const execFileAsync = promisify(execFile);

	const body = await c.req.json<{ tool: string }>().catch(() => ({ tool: "" }));
	const tool = body.tool?.toLowerCase();

	const packages: Record<string, string> = {
		codex: "@openai/codex",
		claude: "@anthropic-ai/claude-code",
	};

	const pkg = packages[tool];
	if (!pkg) {
		return c.json(
			{ ok: false, error: `Unknown tool: ${tool}. Use "codex" or "claude".` },
			400,
		);
	}

	try {
		const { stdout, stderr } = await execFileAsync(
			"npm",
			["install", "-g", pkg],
			{ timeout: 120_000, env: { ...process.env, NODE_ENV: undefined } },
		);
		return c.json({
			ok: true,
			tool,
			package: pkg,
			output: (stdout + stderr).slice(0, 500),
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ ok: false, error: msg.slice(0, 500) }, 500);
	}
});

runtimeRoute.post("/cli-login", async (c) => {
	const body = await c.req.json<{ tool: string }>().catch(() => ({ tool: "" }));
	const tool = body.tool?.toLowerCase();

	const commands: Record<string, string> = {
		codex: "codex login",
		claude: "claude login",
	};

	const cmd = commands[tool];
	if (!cmd) {
		return c.json(
			{ ok: false, error: `Unknown tool: ${tool}. Use "codex" or "claude".` },
			400,
		);
	}

	const platform = process.platform;
	try {
		if (platform === "darwin") {
			// Open Terminal.app with the login command
			exec(
				`osascript -e 'tell application "Terminal" to do script "${cmd}"' -e 'tell application "Terminal" to activate'`,
			);
		} else if (platform === "linux") {
			// Try common terminal emulators
			exec(
				`x-terminal-emulator -e "${cmd}" 2>/dev/null || gnome-terminal -- bash -c "${cmd}; read" 2>/dev/null || xterm -e "${cmd}" 2>/dev/null`,
			);
		} else {
			// Windows
			exec(`start cmd /k "${cmd}"`);
		}
		return c.json({
			ok: true,
			tool,
			message: "Terminal opened — complete login there",
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ ok: false, error: msg.slice(0, 500) }, 500);
	}
});

runtimeRoute.get("/pick-folder", async (c) => {
	const platform = process.platform;

	try {
		let folderPath = "";
		if (platform === "darwin") {
			// Use osascript to open native folder picker on macOS
			folderPath = execSync(
				`osascript -e 'set theFolder to POSIX path of (choose folder with prompt "Select workspace folder")' 2>/dev/null`,
				{ stdio: "pipe", timeout: 60_000 },
			)
				.toString()
				.trim();
			// Remove trailing slash if present
			if (folderPath.endsWith("/") && folderPath.length > 1) {
				folderPath = folderPath.slice(0, -1);
			}
		} else if (platform === "linux") {
			// Try zenity or kdialog
			try {
				folderPath = execSync(
					'zenity --file-selection --directory --title="Select workspace folder" 2>/dev/null',
					{ stdio: "pipe", timeout: 60_000 },
				)
					.toString()
					.trim();
			} catch {
				folderPath = execSync(
					'kdialog --getexistingdirectory "$HOME" 2>/dev/null',
					{ stdio: "pipe", timeout: 60_000 },
				)
					.toString()
					.trim();
			}
		} else {
			return c.json({ ok: false, error: "Unsupported platform" }, 400);
		}

		if (!folderPath) {
			return c.json({ ok: false, error: "No folder selected" }, 400);
		}
		return c.json({ ok: true, path: folderPath });
	} catch {
		// User cancelled the dialog
		return c.json({ ok: false, error: "cancelled" }, 400);
	}
});

runtimeRoute.post("/install-ollama", async (c) => {
	const platform = process.platform;

	try {
		if (platform === "darwin") {
			try {
				execSync("which brew", { stdio: "pipe" });
				execSync("brew install ollama", {
					stdio: "pipe",
					timeout: 300_000,
					shell: "/bin/sh",
				});
			} catch {
				execSync("curl -fsSL https://ollama.com/install.sh | sh", {
					stdio: "pipe",
					timeout: 300_000,
					shell: "/bin/sh",
				});
			}
		} else if (platform === "linux") {
			execSync("curl -fsSL https://ollama.com/install.sh | sh", {
				stdio: "pipe",
				timeout: 300_000,
				shell: "/bin/sh",
			});
		} else {
			return c.json(
				{
					ok: false,
					error:
						"Auto-install not supported on Windows. Download from https://ollama.com/download",
				},
				400,
			);
		}

		// Start ollama serve in the background
		try {
			execSync(
				"nohup ollama serve > /dev/null 2>&1 & sleep 2 && curl -s http://localhost:11434/api/tags > /dev/null",
				{ stdio: "pipe", timeout: 10_000, shell: "/bin/sh" },
			);
		} catch {
			// May need manual start
		}

		return c.json({ ok: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return c.json({ ok: false, error: msg.slice(0, 500) }, 500);
	}
});
