/**
 * tool-installer.ts
 * Detects the host OS + package manager, checks internet connectivity,
 * then installs security tools one by one with streaming progress events.
 *
 * Supported package managers (auto-detected):
 *   macOS  → Homebrew (brew)
 *   Debian/Ubuntu → apt-get
 *   RHEL/Fedora/CentOS → dnf / yum
 *   Alpine → apk
 *   Arch → pacman
 *   Windows → winget (fallback: direct binary download)
 *
 * If SETRA_MODE=offline OR internet check fails → throw OfflineError immediately.
 * Never attempt install in offline/governance mode.
 */

import { execSync, spawn } from "node:child_process";
import { platform } from "node:os";

export type ToolStatus =
	| "not-installed"
	| "installed"
	| "installing"
	| "failed"
	| "unavailable";

export interface SecurityTool {
	id: string;
	name: string;
	description: string;
	category:
		| "network"
		| "web"
		| "code"
		| "forensics"
		| "exploitation"
		| "osint"
		| "container";
	installSize: string; // e.g. "~25 MB"
	website: string;
	license: "free" | "commercial" | "freemium";
	installNote?: string; // shown if commercial or special case
	// How to install per package manager:
	brewPackage?: string;
	aptPackage?: string;
	dnfPackage?: string;
	apkPackage?: string;
	pacmanPackage?: string;
	wingetPackage?: string;
	// Override: direct binary download URL (for Go binaries like nuclei, ffuf)
	directDownload?: {
		linuxAmd64?: string;
		macosAmd64?: string;
		macosArm64?: string;
		windowsAmd64?: string;
	};
	// Command to verify installation
	verifyCommand: string; // e.g. "nmap --version"
}

export const SECURITY_TOOLS: SecurityTool[] = [
	{
		id: "nmap",
		name: "Nmap",
		description:
			"Network mapper — port scanning, service detection, OS fingerprinting",
		category: "network",
		installSize: "~5 MB",
		website: "https://nmap.org",
		license: "free",
		brewPackage: "nmap",
		aptPackage: "nmap",
		dnfPackage: "nmap",
		apkPackage: "nmap",
		pacmanPackage: "nmap",
		wingetPackage: "Insecure.Nmap",
		verifyCommand: "nmap --version",
	},
	{
		id: "nuclei",
		name: "Nuclei",
		description:
			"Fast vulnerability scanner using community-powered templates (5000+ CVEs)",
		category: "web",
		installSize: "~35 MB",
		website: "https://nuclei.projectdiscovery.io",
		license: "free",
		brewPackage: "nuclei",
		aptPackage: "nuclei",
		dnfPackage: "nuclei",
		directDownload: {
			linuxAmd64:
				"https://github.com/projectdiscovery/nuclei/releases/latest/download/nuclei_linux_amd64.zip",
			macosAmd64:
				"https://github.com/projectdiscovery/nuclei/releases/latest/download/nuclei_macos_amd64.zip",
			macosArm64:
				"https://github.com/projectdiscovery/nuclei/releases/latest/download/nuclei_macos_arm64.zip",
		},
		verifyCommand: "nuclei --version",
	},
	{
		id: "ffuf",
		name: "ffuf",
		description:
			"Fast web fuzzer — directory discovery, parameter fuzzing, vhost enumeration",
		category: "web",
		installSize: "~8 MB",
		website: "https://github.com/ffuf/ffuf",
		license: "free",
		brewPackage: "ffuf",
		aptPackage: "ffuf",
		dnfPackage: "ffuf",
		verifyCommand: "ffuf -V",
	},
	{
		id: "nikto",
		name: "Nikto",
		description:
			"Web server scanner — finds dangerous files, misconfigurations, outdated software",
		category: "web",
		installSize: "~2 MB",
		website: "https://cirt.net/Nikto2",
		license: "free",
		brewPackage: "nikto",
		aptPackage: "nikto",
		dnfPackage: "nikto",
		verifyCommand: "nikto -Version",
	},
	{
		id: "sqlmap",
		name: "SQLMap",
		description: "Automatic SQL injection detection and exploitation tool",
		category: "exploitation",
		installSize: "~10 MB",
		website: "https://sqlmap.org",
		license: "free",
		brewPackage: "sqlmap",
		aptPackage: "sqlmap",
		dnfPackage: "sqlmap",
		verifyCommand: "sqlmap --version",
	},
	{
		id: "gobuster",
		name: "Gobuster",
		description: "Directory/file & DNS busting tool written in Go",
		category: "web",
		installSize: "~7 MB",
		website: "https://github.com/OJ/gobuster",
		license: "free",
		brewPackage: "gobuster",
		aptPackage: "gobuster",
		dnfPackage: "gobuster",
		verifyCommand: "gobuster version",
	},
	{
		id: "hydra",
		name: "Hydra",
		description:
			"Network login cracker — supports 50+ protocols (SSH, FTP, HTTP, SMB, ...)",
		category: "exploitation",
		installSize: "~3 MB",
		website: "https://github.com/vanhauser-thc/thc-hydra",
		license: "free",
		brewPackage: "hydra",
		aptPackage: "hydra",
		dnfPackage: "hydra",
		verifyCommand: "hydra -h",
	},
	{
		id: "trivy",
		name: "Trivy",
		description:
			"Container & filesystem vulnerability scanner — finds CVEs in images, IaC, SBOM",
		category: "container",
		installSize: "~50 MB",
		website: "https://aquasecurity.github.io/trivy",
		license: "free",
		brewPackage: "aquasecurity/trivy/trivy",
		aptPackage: "trivy",
		dnfPackage: "trivy",
		verifyCommand: "trivy --version",
	},
	{
		id: "semgrep",
		name: "Semgrep",
		description:
			"Static analysis engine — finds security bugs in source code across 30+ languages",
		category: "code",
		installSize: "~80 MB",
		website: "https://semgrep.dev",
		license: "free",
		brewPackage: "semgrep",
		aptPackage: "python3-semgrep",
		verifyCommand: "semgrep --version",
	},
	{
		id: "tshark",
		name: "TShark",
		description:
			"Command-line packet analyzer — capture and analyze network traffic",
		category: "forensics",
		installSize: "~30 MB",
		website: "https://www.wireshark.org/docs/man-pages/tshark.html",
		license: "free",
		brewPackage: "wireshark",
		aptPackage: "tshark",
		dnfPackage: "wireshark-cli",
		verifyCommand: "tshark --version",
	},
	{
		id: "whatweb",
		name: "WhatWeb",
		description:
			"Web technology fingerprinting — identifies CMS, frameworks, libraries, servers",
		category: "osint",
		installSize: "~5 MB",
		website: "https://github.com/urbanadventurer/WhatWeb",
		license: "free",
		brewPackage: "whatweb",
		aptPackage: "whatweb",
		verifyCommand: "whatweb --version",
	},
	{
		id: "burpsuite",
		name: "Burp Suite CE",
		description:
			"Industry-standard web proxy — Community Edition for manual testing only. Pro required for automated scanning API (port 1337).",
		category: "web",
		installSize: "~150 MB",
		website: "https://portswigger.net/burp/communitydownload",
		license: "freemium",
		installNote:
			"Burp Suite CE requires manual download. Sentinel uses the REST API (port 1337) which is Pro/Enterprise only. For free automated web scanning, install OWASP ZAP instead.",
		verifyCommand: "burpsuite --version",
	},
	{
		id: "zaproxy",
		name: "OWASP ZAP",
		description:
			"Free Burp Suite alternative — full web app scanner with REST API. Spider, active/passive scan, fuzzer. Recommended for automated scanning.",
		category: "web",
		installSize: "~200 MB",
		website: "https://www.zaproxy.org",
		license: "free",
		brewPackage: "owasp-zap",
		aptPackage: "zaproxy",
		dnfPackage: "zaproxy",
		installNote:
			"OWASP ZAP: run in daemon mode with `zap.sh -daemon -port 8090`. Sentinel connects via REST API automatically.",
		verifyCommand: "zap.sh -version",
	},
	{
		id: "masscan",
		name: "Masscan",
		description:
			"Fastest Internet port scanner — scans entire IPv4 ranges in minutes",
		category: "network",
		installSize: "~1 MB",
		website: "https://github.com/robertdavidgraham/masscan",
		license: "free",
		brewPackage: "masscan",
		aptPackage: "masscan",
		dnfPackage: "masscan",
		verifyCommand: "masscan --version",
	},
	{
		id: "subfinder",
		name: "Subfinder",
		description: "Passive subdomain discovery tool using 40+ data sources",
		category: "osint",
		installSize: "~12 MB",
		website: "https://github.com/projectdiscovery/subfinder",
		license: "free",
		brewPackage: "subfinder",
		aptPackage: "subfinder",
		verifyCommand: "subfinder -version",
	},
	{
		id: "httpx",
		name: "httpx",
		description:
			"HTTP probing tool — probes multiple URLs for alive hosts, status, tech stack",
		category: "network",
		installSize: "~10 MB",
		website: "https://github.com/projectdiscovery/httpx",
		license: "free",
		brewPackage: "httpx",
		aptPackage: "httpx-toolkit",
		verifyCommand: "httpx -version",
	},
];

// Detect OS and package manager
export type PackageManager =
	| "brew"
	| "apt"
	| "dnf"
	| "yum"
	| "apk"
	| "pacman"
	| "winget"
	| "none";

export function detectPackageManager(): PackageManager {
	const p = platform();
	if (p === "darwin") return commandExists("brew") ? "brew" : "none";
	if (p === "win32") return commandExists("winget") ? "winget" : "none";
	// Linux variants
	if (commandExists("apt-get")) return "apt";
	if (commandExists("dnf")) return "dnf";
	if (commandExists("yum")) return "yum";
	if (commandExists("apk")) return "apk";
	if (commandExists("pacman")) return "pacman";
	return "none";
}

function commandExists(cmd: string): boolean {
	try {
		execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>/dev/null`, {
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

// Check internet by pinging Cloudflare DNS
export async function checkInternet(): Promise<boolean> {
	if (process.env["SETRA_MODE"] === "offline") return false;
	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 3000);
		const res = await fetch("https://1.1.1.1", {
			signal: ctrl.signal,
			method: "HEAD",
		});
		clearTimeout(timer);
		return res.ok || res.status < 500;
	} catch {
		return false;
	}
}

export class OfflineError extends Error {
	constructor() {
		super(
			"Cannot install — no internet connection. Switch to online mode or install tools manually.",
		);
		this.name = "OfflineError";
	}
}

export type InstallEvent =
	| { type: "check-internet" }
	| { type: "offline-error"; message: string }
	| {
			type: "confirm-required";
			toolId: string;
			toolName: string;
			installCmd: string;
			sizeHint: string;
	  }
	| { type: "detecting-pm"; pm: PackageManager }
	| { type: "install-start"; toolId: string; toolName: string }
	| { type: "install-progress"; toolId: string; line: string }
	| { type: "install-success"; toolId: string; version: string }
	| { type: "install-failed"; toolId: string; error: string }
	| { type: "already-installed"; toolId: string; version: string }
	| { type: "unavailable"; toolId: string; reason: string };

export class UserCancelledError extends Error {
	constructor() {
		super("Installation cancelled by user.");
		this.name = "UserCancelledError";
	}
}

/**
 * installTool — installs a security tool after user confirmation.
 *
 * Flow:
 *   1. Check internet (fail fast if offline / SETRA_MODE=offline)
 *   2. Check if already installed → emit already-installed and return
 *   3. Emit `confirm-required` → caller MUST call confirmInstall() to proceed
 *      The UI shows: "nmap is not installed. Install via brew? (~5 MB) [Install] [Skip]"
 *   4. On confirm → detect PM, build command, spawn with streaming progress
 *   5. Verify installation → emit success or failed
 */
export async function installTool(
	tool: SecurityTool,
	emit: (event: InstallEvent) => void,
	/** Called by the UI after showing the confirmation prompt. Must resolve true=install, false=cancel. */
	requestConfirm: (toolId: string, installCmd: string) => Promise<boolean>,
): Promise<void> {
	// 1. Offline guard
	emit({ type: "check-internet" });
	const online = await checkInternet();
	if (!online) {
		emit({ type: "offline-error", message: new OfflineError().message });
		throw new OfflineError();
	}

	// 2. Already installed?
	try {
		const ver =
			execSync(tool.verifyCommand, { encoding: "utf8", timeout: 5000 })
				.trim()
				.split("\n")[0] ?? "";
		emit({ type: "already-installed", toolId: tool.id, version: ver });
		return;
	} catch {
		/* not installed, continue */
	}

	// 3. Commercial / manual-only tools
	if (tool.license === "freemium" && tool.installNote) {
		emit({ type: "unavailable", toolId: tool.id, reason: tool.installNote });
		return;
	}

	// 4. Detect package manager
	const pm = detectPackageManager();
	emit({ type: "detecting-pm", pm });

	// 5. Build install command
	const cmd = buildInstallCommand(tool, pm);
	if (!cmd) {
		emit({
			type: "unavailable",
			toolId: tool.id,
			reason: `No install method for package manager: ${pm}`,
		});
		return;
	}

	// 6. Ask user for confirmation — NEVER auto-install without consent
	emit({
		type: "confirm-required",
		toolId: tool.id,
		toolName: tool.name,
		installCmd: cmd,
		sizeHint: tool.installSize,
	});
	const confirmed = await requestConfirm(tool.id, cmd);
	if (!confirmed) {
		throw new UserCancelledError();
	}

	// 7. Run install with streaming progress
	emit({ type: "install-start", toolId: tool.id, toolName: tool.name });
	await runInstallCommand(cmd, tool.id, emit);

	// 8. Verify
	try {
		const ver =
			execSync(tool.verifyCommand, { encoding: "utf8", timeout: 5000 })
				.trim()
				.split("\n")[0] ?? "";
		emit({ type: "install-success", toolId: tool.id, version: ver });
	} catch {
		emit({
			type: "install-failed",
			toolId: tool.id,
			error: "Installation completed but tool not found in PATH",
		});
	}
}

function buildInstallCommand(
	tool: SecurityTool,
	pm: PackageManager,
): string | null {
	switch (pm) {
		case "brew":
			return tool.brewPackage ? `brew install ${tool.brewPackage}` : null;
		case "apt":
			return tool.aptPackage
				? `sudo apt-get install -y ${tool.aptPackage}`
				: null;
		case "dnf":
			return tool.dnfPackage ? `sudo dnf install -y ${tool.dnfPackage}` : null;
		case "yum":
			return tool.dnfPackage ? `sudo yum install -y ${tool.dnfPackage}` : null;
		case "apk":
			return tool.apkPackage
				? `sudo apk add --no-cache ${tool.apkPackage}`
				: null;
		case "pacman":
			return tool.pacmanPackage
				? `sudo pacman -S --noconfirm ${tool.pacmanPackage}`
				: null;
		case "winget":
			return tool.wingetPackage
				? `winget install -e --id ${tool.wingetPackage}`
				: null;
		default:
			return null;
	}
}

async function runInstallCommand(
	cmd: string,
	toolId: string,
	emit: (e: InstallEvent) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const parts = cmd.split(" ");
		const bin = parts[0]!;
		const args = parts.slice(1);
		const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
		proc.stdout.on("data", (d: Buffer) =>
			emit({ type: "install-progress", toolId, line: d.toString().trim() }),
		);
		proc.stderr.on("data", (d: Buffer) =>
			emit({ type: "install-progress", toolId, line: d.toString().trim() }),
		);
		proc.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`Exit code: ${code}`)),
		);
		proc.on("error", reject);
	});
}

export async function checkToolStatus(
	tool: SecurityTool,
): Promise<{ installed: boolean; version?: string }> {
	try {
		const out =
			execSync(tool.verifyCommand, { encoding: "utf8", timeout: 5000 })
				.trim()
				.split("\n")[0] ?? "";
		return { installed: true, version: out };
	} catch {
		return { installed: false };
	}
}

export async function checkAllTools(): Promise<
	Record<string, { installed: boolean; version?: string }>
> {
	const results: Record<string, { installed: boolean; version?: string }> = {};
	await Promise.all(
		SECURITY_TOOLS.map(async (tool) => {
			results[tool.id] = await checkToolStatus(tool);
		}),
	);
	return results;
}
