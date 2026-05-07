/**
 * setra models — local SLM management via Ollama
 */
import { execFile, spawn } from "node:child_process";
import * as https from "node:https";
import * as os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function which(bin: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("which", [bin]);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

function requireOllama(
	ollamaPath: string | null,
): asserts ollamaPath is string {
	if (!ollamaPath) {
		console.error(
			"❌  Ollama is not installed. Run: setra models install ollama",
		);
		process.exit(1);
	}
}

/** Render a simple ASCII progress bar. */
function renderBar(percent: number, width = 20): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	return "█".repeat(filled) + "░".repeat(empty);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommended models list
// ─────────────────────────────────────────────────────────────────────────────

const RECOMMENDED = [
	{
		id: "qwen2.5-coder:7b",
		size: "4.7 GB",
		note: "Best code model for local use (⭐ Recommended)",
	},
	{
		id: "qwen2.5-coder:1.5b",
		size: "1.0 GB",
		note: "Ultra-fast, runs on any machine",
	},
	{ id: "phi4-mini", size: "2.5 GB", note: "Microsoft Phi — fast & capable" },
	{ id: "deepseek-r1:7b", size: "4.7 GB", note: "Strong reasoning model" },
	{ id: "gemma3:4b", size: "3.3 GB", note: "Google Gemma — solid general use" },
	{ id: "mistral:7b", size: "4.1 GB", note: "Reliable general-purpose model" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

export async function runModelsList(): Promise<void> {
	const ollamaPath = await which("ollama");
	requireOllama(ollamaPath);
	try {
		const { stdout } = await execFileAsync(ollamaPath, ["list"]);
		const lines = stdout.trim().split("\n");
		if (lines.length <= 1) {
			console.log("No models installed. Run: setra models pull <name>");
			return;
		}
		// Pretty-print table
		console.log("\n  Installed Local Models\n");
		for (const line of lines) {
			if (line.startsWith("NAME")) {
				console.log(`  \x1b[2m${line}\x1b[0m`);
			} else if (line.trim()) {
				const parts = line.split(/\s{2,}/);
				const name = parts[0]?.padEnd(30) ?? "";
				const size = parts[2]?.padEnd(10) ?? "";
				const mod = parts[3] ?? "";
				console.log(`  \x1b[36m${name}\x1b[0m  ${size}  \x1b[2m${mod}\x1b[0m`);
			}
		}
		console.log();
	} catch (e) {
		console.error(
			"Error running ollama list:",
			e instanceof Error ? e.message : e,
		);
		process.exit(1);
	}
}

export async function runModelsInstallOllama(): Promise<void> {
	const platform = os.platform();
	console.log(`\n  Installing Ollama on ${platform}…\n`);

	if (platform === "win32") {
		console.log("  Opening https://ollama.com/download in your browser…");
		const { exec } = await import("node:child_process");
		exec("start https://ollama.com/download");
		return;
	}

	if (platform === "darwin") {
		const brew = await which("brew");
		if (brew) {
			console.log("  Found Homebrew. Running: brew install ollama\n");
			const child = spawn(brew, ["install", "ollama"], {
				stdio: "inherit",
				env: process.env,
			});
			await new Promise<void>((resolve, reject) => {
				child.on("close", (code) => {
					if (code === 0) {
						console.log("\n  ✅  Ollama installed via Homebrew.");
						resolve();
					} else {
						reject(new Error(`brew exited with code ${code}`));
					}
				});
			});
			return;
		}

		// Fallback: download .pkg
		const pkgUrl = "https://ollama.com/download/Ollama-darwin.pkg";
		const dest = `${os.homedir()}/Downloads/Ollama-darwin.pkg`;
		console.log(`  Downloading ${pkgUrl} → ${dest}\n`);
		await new Promise<void>((resolve, reject) => {
			const fs = require("node:fs") as typeof import("node:fs");
			const file = fs.createWriteStream(dest);
			https
				.get(pkgUrl, (res) => {
					const total = Number.parseInt(
						res.headers["content-length"] ?? "0",
						10,
					);
					let received = 0;
					res.on("data", (chunk: Buffer) => {
						received += chunk.length;
						file.write(chunk);
						if (total > 0) {
							const pct = Math.round((received / total) * 100);
							const bar = renderBar(pct);
							process.stdout.write(
								`\r  [${bar}] ${pct}%  ${(received / 1e6).toFixed(1)} MB`,
							);
						}
					});
					res.on("end", () => {
						file.end();
						process.stdout.write("\n");
						console.log(`  Saved to ${dest}. Open it to install Ollama.`);
						resolve();
					});
					res.on("error", reject);
				})
				.on("error", reject);
		});
		return;
	}

	// Linux
	console.log("  Running: curl -fsSL https://ollama.com/install.sh | sh\n");
	const child = spawn(
		"sh",
		["-c", "curl -fsSL https://ollama.com/install.sh | sh"],
		{
			stdio: "inherit",
			env: process.env,
		},
	);
	await new Promise<void>((resolve, reject) => {
		child.on("close", (code) => {
			if (code === 0) {
				console.log("\n  ✅  Ollama installed.");
				resolve();
			} else {
				reject(new Error(`Install script exited with code ${code}`));
			}
		});
	});
}

export async function runModelsPull(modelName: string): Promise<void> {
	const ollamaPath = await which("ollama");
	requireOllama(ollamaPath);

	console.log(`\n  Pulling ${modelName}…\n`);

	const child = spawn(ollamaPath, ["pull", modelName], {
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});

	let buffer = "";
	const processChunk = (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			const percentMatch = line.match(/(\d+)%/);
			const sizeMatch = line.match(/([\d.]+\s*[KMGT]B)\/([\d.]+\s*[KMGT]B)/i);
			if (percentMatch) {
				const pct = Number.parseInt(percentMatch[1]!, 10);
				const bar = renderBar(pct);
				const sizes = sizeMatch ? `  ${sizeMatch[1]} / ${sizeMatch[2]}` : "";
				process.stdout.write(
					`\r  ${modelName.padEnd(25)} [${bar}] ${String(pct).padStart(3)}%${sizes}    `,
				);
			} else {
				process.stdout.write(`\r  ${line.trim().slice(0, 80).padEnd(80)}`);
			}
		}
	};

	child.stdout?.on("data", (d: Buffer) => processChunk(d.toString()));
	child.stderr?.on("data", (d: Buffer) => processChunk(d.toString()));

	await new Promise<void>((resolve, reject) => {
		child.on("close", (code) => {
			if (buffer.trim()) {
				process.stdout.write(`\r  ${buffer.trim().slice(0, 80).padEnd(80)}`);
			}
			process.stdout.write("\n");
			if (code === 0) {
				console.log(`\n  ✅  ${modelName} is ready to use.\n`);
				resolve();
			} else {
				reject(new Error(`ollama pull exited with code ${code}`));
			}
		});
	});
}

export async function runModelsRm(modelName: string): Promise<void> {
	const ollamaPath = await which("ollama");
	requireOllama(ollamaPath);
	try {
		await execFileAsync(ollamaPath, ["rm", modelName]);
		console.log(`  ✅  ${modelName} removed.`);
	} catch (e) {
		console.error("Error:", e instanceof Error ? e.message : e);
		process.exit(1);
	}
}

export async function runModelsRecommend(): Promise<void> {
	console.log("\n  ✨  Recommended models for offline / governance use\n");
	console.log(`  ${"Model".padEnd(26)} ${"Size".padEnd(10)} Notes`);
	console.log(`  ${"─".repeat(26)} ${"─".repeat(10)} ${"─".repeat(40)}`);
	for (const m of RECOMMENDED) {
		console.log(
			`  \x1b[36m${m.id.padEnd(26)}\x1b[0m ${m.size.padEnd(10)} \x1b[2m${m.note}\x1b[0m`,
		);
	}
	console.log("\n  Install with:  setra models pull <name>\n");
}
