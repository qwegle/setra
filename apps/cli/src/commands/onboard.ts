/**
 * setra onboard — first-run interactive onboarding from the terminal.
 *
 * Replaces the legacy multi-step wizard with the same two-step flow as the
 * web onboarding (PR-B): pick a CLI adapter, point Setra at it, done.
 *
 * No API keys, no model dropdowns. Setra uses whichever CLI you already
 * have authenticated on this machine (claude / codex / gemini / opencode /
 * cursor). API keys are explicitly _not_ collected.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { probeCLIs } from "@setra/agent-runner";
import chalk from "chalk";

interface OnboardOptions {
	yes?: boolean;
	open?: boolean;
	port?: number;
}

const SETRA_DIR = join(homedir(), ".setra");
const SETTINGS_PATH = join(SETRA_DIR, "settings.json");

const CLI_OPTIONS = [
	{ id: "claude", label: "Claude Code", install: "npm i -g @anthropic-ai/claude-code" },
	{ id: "codex", label: "Codex CLI", install: "npm i -g @openai/codex" },
	{ id: "gemini", label: "Gemini CLI", install: "npm i -g @google/gemini-cli" },
	{ id: "opencode", label: "OpenCode", install: "curl -fsSL https://opencode.ai/install | bash" },
	{ id: "cursor", label: "Cursor Agent", install: "Install the Cursor app from cursor.com" },
] as const;

type CliId = (typeof CLI_OPTIONS)[number]["id"];

function loadSettings(): Record<string, unknown> {
	if (!existsSync(SETTINGS_PATH)) return {};
	try {
		return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
	} catch {
		return {};
	}
}

function saveSettings(s: Record<string, unknown>): void {
	if (!existsSync(SETRA_DIR)) mkdirSync(SETRA_DIR, { recursive: true });
	writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

function openBrowser(url: string): void {
	const cmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";
	try {
		spawnSync(cmd, [url], { stdio: "ignore", detached: true });
	} catch {
		// fall through; user already saw the URL printed
	}
}

export async function onboardCommand(opts: OnboardOptions = {}): Promise<void> {
	console.log();
	console.log(chalk.bold("Setra onboarding"));
	console.log(chalk.dim("No API keys. No model dropdowns. Just pick a CLI."));
	console.log();

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	try {
		const probed = await probeCLIs({ force: true });
		const byId = new Map(probed.map((p) => [p.id, p]));
		const installed = CLI_OPTIONS.filter((c) => byId.get(c.id)?.installed);
		const missing = CLI_OPTIONS.filter((c) => !byId.get(c.id)?.installed);

		console.log(chalk.bold("Detected on this machine:"));
		for (const c of CLI_OPTIONS) {
			const entry = byId.get(c.id);
			const ok = entry?.installed === true;
			const dot = ok ? chalk.green("●") : chalk.gray("○");
			const ver = entry?.version ? chalk.dim(` v${entry.version}`) : "";
			console.log(`  ${dot} ${c.label}${ver}`);
		}
		console.log();

		if (installed.length === 0) {
			console.log(chalk.yellow("No coding CLIs detected. Install one of:"));
			for (const c of missing) {
				console.log(`  ${chalk.bold(c.label)}: ${chalk.cyan(c.install)}`);
			}
			console.log();
			console.log("Then run `setra onboard` again.");
			return;
		}

		let chosen: CliId;
		if (opts.yes || installed.length === 1) {
			chosen = installed[0]!.id;
			console.log(chalk.green(`✓ Using ${installed[0]!.label}`));
		} else {
			console.log("Which CLI should Setra use?");
			installed.forEach((c, i) => {
				console.log(`  ${i + 1}. ${c.label}`);
			});
			const answer = (await rl.question(`  [1-${installed.length}] (default 1): `)).trim();
			const idx = answer === "" ? 0 : Number.parseInt(answer, 10) - 1;
			if (Number.isNaN(idx) || idx < 0 || idx >= installed.length) {
				console.log(chalk.red("Invalid choice. Aborting."));
				return;
			}
			chosen = installed[idx]!.id;
			console.log(chalk.green(`✓ Using ${installed[idx]!.label}`));
		}

		const settings = loadSettings();
		settings.preferredCli = chosen;
		settings.legacyApiKeysEnabled = false;
		settings.onboardedAt = new Date().toISOString();
		saveSettings(settings);
		console.log(chalk.dim(`Wrote ${SETTINGS_PATH}`));
		console.log();

		const port = opts.port ?? 3141;
		console.log(chalk.bold("Next steps"));
		console.log(`  ${chalk.cyan(`setra serve --port ${port}`)}   start the local daemon`);
		console.log(`  ${chalk.cyan(`open http://localhost:${port}`)}   open the board`);

		if (opts.open) {
			openBrowser(`http://localhost:${port}`);
		}
	} finally {
		rl.close();
	}
}
