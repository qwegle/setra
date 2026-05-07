/**
 * setra security tools — Sentinel Tool Installer CLI
 *
 * Usage:
 *   setra security-tools list
 *   setra security-tools install <tool>
 *   setra security-tools install-all
 *   setra security-tools check <tool>
 */

import {
	type InstallEvent,
	OfflineError,
	SECURITY_TOOLS,
	checkAllTools,
	checkInternet,
	checkToolStatus,
	detectPackageManager,
	installTool,
} from "@setra/security";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function colorize(text: string, code: string): string {
	return `\x1b[${code}m${text}\x1b[0m`;
}
const green = (s: string) => colorize(s, "32");
const red = (s: string) => colorize(s, "31");
const yellow = (s: string) => colorize(s, "33");
const cyan = (s: string) => colorize(s, "36");
const dim = (s: string) => colorize(s, "2");

function padEnd(s: string, n: number): string {
	return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

export async function runSecurityToolsList(): Promise<void> {
	console.log("\n  Security Tools\n");
	const statuses = await checkAllTools();
	const pm = detectPackageManager();

	const nameW = 14;
	const verW = 14;
	const descW = 42;

	console.log(
		`  ${dim(padEnd("Tool", nameW))}  ${dim(padEnd("Version", verW))}  ${dim(padEnd("Description", descW))}`,
	);
	console.log(
		`  ${dim("─".repeat(nameW))}  ${dim("─".repeat(verW))}  ${dim("─".repeat(descW))}`,
	);

	for (const tool of SECURITY_TOOLS) {
		const status = statuses[tool.id];
		const mark = status?.installed ? green("✅") : red("❌");
		const ver = status?.installed
			? dim(padEnd((status.version ?? "").slice(0, verW - 1), verW))
			: dim(padEnd("not found", verW));
		const desc = dim(tool.description.slice(0, descW));
		console.log(
			`  ${mark} ${cyan(padEnd(tool.name, nameW - 2))}  ${ver}  ${desc}`,
		);
	}

	console.log(
		`\n  Package manager: ${pm === "none" ? yellow("not detected") : cyan(pm)}\n`,
	);
}

export async function runSecurityToolsInstall(toolId: string): Promise<void> {
	const tool = SECURITY_TOOLS.find((t) => t.id === toolId.toLowerCase());
	if (!tool) {
		console.error(`  ${red("❌")} Unknown tool: ${toolId}`);
		console.error(
			`  Run ${cyan("setra security-tools list")} to see available tools.`,
		);
		process.exit(1);
	}

	console.log(`\n  Installing ${cyan(tool.name)} (${tool.installSize})\n`);

	const emit = (evt: InstallEvent): void => {
		switch (evt.type) {
			case "check-internet":
				process.stdout.write(`  🔍 Checking internet… `);
				break;
			case "offline-error":
				process.stdout.write("\n");
				console.error(`  ${red("🚫")} ${evt.message}`);
				console.error(`     Switch to online mode or install tools manually.`);
				break;
			case "detecting-pm":
				console.log(`  📦 Package manager: ${cyan(evt.pm)}`);
				break;
			case "install-start":
				console.log(`  ⬇️  Installing ${cyan(evt.toolName)}…\n`);
				break;
			case "install-progress":
				if (evt.line.trim()) {
					console.log(`     ${dim(evt.line.slice(0, 100))}`);
				}
				break;
			case "install-success":
				console.log(
					`\n  ${green("✅")} ${tool.name} installed: ${evt.version}`,
				);
				break;
			case "install-failed":
				console.error(`  ${red("❌")} ${evt.error}`);
				break;
			case "already-installed":
				process.stdout.write(green("✅") + "\n");
				console.log(`  ${green("✅")} Already installed: ${evt.version}`);
				break;
			case "unavailable":
				console.log(`  ⚠️  ${yellow(evt.reason)}`);
				break;
		}
	};

	try {
		await installTool(tool, emit, (_toolId, cmd) => {
			console.log(`  ${cyan("▶")} Will run: ${cmd}`);
			return Promise.resolve(true); // auto-confirm in CLI
		});
	} catch (err) {
		if (!(err instanceof OfflineError)) {
			console.error(`\n  ${red("❌")} ${(err as Error).message}`);
		}
		process.exit(1);
	}

	console.log();
}

export async function runSecurityToolsInstallAll(): Promise<void> {
	console.log("\n  🛡️  Installing all missing security tools\n");

	const online = await checkInternet();
	if (!online) {
		console.error(`  ${red("🚫")} Cannot install — no internet connection.`);
		console.error(`     Switch to online mode or install tools manually.\n`);
		process.exit(1);
	}

	const statuses = await checkAllTools();
	const pm = detectPackageManager();
	console.log(`  📦 Package manager: ${cyan(pm)}\n`);

	const missing = SECURITY_TOOLS.filter(
		(t) => !statuses[t.id]?.installed && t.license !== "freemium",
	);

	if (missing.length === 0) {
		console.log(`  ${green("✅")} All tools already installed!\n`);
		return;
	}

	console.log(`  Installing ${missing.length} tool(s)…\n`);

	for (const tool of missing) {
		console.log(`  ─── ${cyan(tool.name)} ───`);
		const emit = (evt: InstallEvent): void => {
			if (evt.type === "install-progress" && evt.line.trim()) {
				console.log(`     ${dim(evt.line.slice(0, 100))}`);
			} else if (evt.type === "install-success") {
				console.log(`  ${green("✅")} ${tool.name}: ${evt.version}\n`);
			} else if (evt.type === "install-failed") {
				console.error(`  ${red("❌")} ${tool.name}: ${evt.error}\n`);
			} else if (evt.type === "already-installed") {
				console.log(`  ${green("✅")} ${tool.name}: already installed\n`);
			} else if (evt.type === "unavailable") {
				console.log(`  ⚠️  ${tool.name}: ${yellow(evt.reason)}\n`);
			}
		};
		await installTool(tool, emit, (_toolId, cmd) => {
			console.log(`  ${cyan("▶")} Will run: ${cmd}`);
			return Promise.resolve(true); // auto-confirm in CLI
		}).catch((err: unknown) => {
			if (!(err instanceof OfflineError)) {
				console.error(`  ${red("❌")} ${tool.name}: ${(err as Error).message}`);
			}
		});
	}

	console.log(`  ${green("✅")} Done!\n`);
}

export async function runSecurityToolsCheck(toolId: string): Promise<void> {
	const tool = SECURITY_TOOLS.find((t) => t.id === toolId.toLowerCase());
	if (!tool) {
		console.error(`  ${red("❌")} Unknown tool: ${toolId}`);
		process.exit(1);
	}
	const status = await checkToolStatus(tool);
	if (status.installed) {
		console.log(
			`  ${green("✅")} ${tool.name}: ${status.version ?? "installed"}`,
		);
	} else {
		console.log(`  ${red("❌")} ${tool.name}: not installed`);
	}
}
