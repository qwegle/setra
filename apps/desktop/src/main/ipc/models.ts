import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { ipcMain, shell } from "electron";

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

async function getOllamaVersion(ollamaPath: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(ollamaPath, ["--version"]);
		// e.g. "ollama version 0.6.2"
		const m = stdout.match(/(\d+\.\d+\.\d+)/);
		return m ? m[1]! : stdout.trim();
	} catch {
		return "";
	}
}

function checkOllamaRunning(port = 11434): Promise<boolean> {
	return new Promise((resolve) => {
		const req = http.get(
			{ hostname: "localhost", port, path: "/", timeout: 2000 },
			(res) => {
				res.resume();
				resolve(res.statusCode === 200 || res.statusCode === 404);
			},
		);
		req.on("error", () => resolve(false));
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
	});
}

/** Parse a line from `ollama list` output into structured data. */
function parseOllamaListLine(
	line: string,
): { name: string; size: string; modified: string } | null {
	// Header: NAME  ID  SIZE  MODIFIED
	if (!line.trim() || line.startsWith("NAME")) return null;
	const parts = line.split(/\s{2,}/);
	if (parts.length < 3) return null;
	return {
		name: parts[0]!.trim(),
		size: parts[2]?.trim() ?? "",
		modified: parts[3]?.trim() ?? "",
	};
}

/** Parse `ollama pull` progress line.
 *  e.g. "pulling sha256:abc...  45% ▕███▏ 2.1 GB/4.7 GB   42 MB/s  1m2s"
 */
function parsePullLine(line: string): {
	percent?: number;
	downloaded?: string;
	total?: string;
	status: string;
	raw: string;
} {
	const percentMatch = line.match(/(\d+)%/);
	const sizeMatch = line.match(/([\d.]+\s*[KMGT]B)\/([\d.]+\s*[KMGT]B)/i);

	if (percentMatch) {
		return {
			percent: Number.parseInt(percentMatch[1]!, 10),
			...(sizeMatch ? { downloaded: sizeMatch[1]!, total: sizeMatch[2]! } : {}),
			status: "downloading",
			raw: line,
		};
	}
	if (line.includes("pulling manifest"))
		return { status: "pulling manifest", raw: line };
	if (line.includes("verifying sha")) return { status: "verifying", raw: line };
	if (line.includes("writing manifest"))
		return { status: "writing manifest", raw: line };
	if (line.includes("success") || line.includes("done"))
		return { status: "success", raw: line };
	return { status: "info", raw: line };
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC handler registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerModelsHandlers(): void {
	// models:check-ollama
	ipcMain.handle("models:check-ollama", async () => {
		const ollamaPath = await which("ollama");
		if (!ollamaPath) {
			return {
				installed: false,
				running: false,
				version: "",
				path: "",
				port: 11434,
			};
		}
		const version = await getOllamaVersion(ollamaPath);
		const running = await checkOllamaRunning(11434);
		return { installed: true, running, version, path: ollamaPath, port: 11434 };
	});

	// models:install-ollama — streams install progress via 'models:install-progress'
	ipcMain.handle("models:install-ollama", async (event) => {
		const platform = os.platform();
		const webContents = event.sender;

		const sendLine = (line: string) => {
			if (!webContents.isDestroyed()) {
				webContents.send("models:install-progress", line);
			}
		};

		if (platform === "win32") {
			sendLine("Opening Ollama download page in your browser…");
			await shell.openExternal("https://ollama.com/download");
			return;
		}

		if (platform === "darwin") {
			const brew = await which("brew");
			if (brew) {
				sendLine("Found Homebrew. Running: brew install ollama …");
				const child = spawn(brew, ["install", "ollama"], {
					env: process.env,
					stdio: ["ignore", "pipe", "pipe"],
				});
				child.stdout?.on("data", (d: Buffer) => {
					d.toString().split("\n").filter(Boolean).forEach(sendLine);
				});
				child.stderr?.on("data", (d: Buffer) => {
					d.toString().split("\n").filter(Boolean).forEach(sendLine);
				});
				await new Promise<void>((resolve, reject) => {
					child.on("close", (code) => {
						if (code === 0) {
							sendLine("✅ Ollama installed successfully via Homebrew.");
							resolve();
						} else {
							reject(new Error(`brew install ollama exited with code ${code}`));
						}
					});
				});
				return;
			}

			// Fallback: download .pkg
			const pkgUrl = "https://ollama.com/download/Ollama-darwin.pkg";
			const dest = path.join(os.homedir(), "Downloads", "Ollama-darwin.pkg");
			sendLine(`No Homebrew found. Downloading ${pkgUrl} …`);
			await new Promise<void>((resolve, reject) => {
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
								sendLine(
									`Downloading… ${pct}% (${(received / 1e6).toFixed(1)} MB / ${(total / 1e6).toFixed(1)} MB)`,
								);
							}
						});
						res.on("end", () => {
							file.end();
							sendLine(`Saved to ${dest}. Opening installer…`);
							shell
								.openPath(dest)
								.then(() => resolve())
								.catch(reject);
						});
						res.on("error", reject);
					})
					.on("error", reject);
			});
			return;
		}

		// Linux
		sendLine("Running: curl -fsSL https://ollama.com/install.sh | sh");
		const child = spawn(
			"sh",
			["-c", "curl -fsSL https://ollama.com/install.sh | sh"],
			{
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		child.stdout?.on("data", (d: Buffer) => {
			d.toString().split("\n").filter(Boolean).forEach(sendLine);
		});
		child.stderr?.on("data", (d: Buffer) => {
			d.toString().split("\n").filter(Boolean).forEach(sendLine);
		});
		await new Promise<void>((resolve, reject) => {
			child.on("close", (code) => {
				if (code === 0) {
					sendLine("✅ Ollama installed successfully.");
					resolve();
				} else {
					reject(new Error(`Install script exited with code ${code}`));
				}
			});
		});
	});

	// models:list — returns parsed `ollama list` output
	ipcMain.handle("models:list", async () => {
		const ollamaPath = await which("ollama");
		if (!ollamaPath) return [];
		try {
			const { stdout } = await execFileAsync(ollamaPath, ["list"], {
				env: process.env,
			});
			return stdout
				.split("\n")
				.map(parseOllamaListLine)
				.filter((r): r is NonNullable<typeof r> => r !== null);
		} catch {
			return [];
		}
	});

	// models:pull — streams `ollama pull` progress via 'models:pull-progress'
	ipcMain.handle("models:pull", async (event, modelName: string) => {
		const ollamaPath = await which("ollama");
		if (!ollamaPath) throw new Error("Ollama is not installed");

		const webContents = event.sender;
		const sendProgress = (data: object) => {
			if (!webContents.isDestroyed()) {
				webContents.send("models:pull-progress", data);
			}
		};

		const child = spawn(ollamaPath, ["pull", modelName], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let buffer = "";
		const processOutput = (chunk: string) => {
			buffer += chunk;
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const parsed = parsePullLine(line);
				sendProgress({ modelName, ...parsed });
			}
		};

		child.stdout?.on("data", (d: Buffer) => processOutput(d.toString()));
		child.stderr?.on("data", (d: Buffer) => processOutput(d.toString()));

		await new Promise<void>((resolve, reject) => {
			child.on("close", (code) => {
				if (buffer.trim()) {
					const parsed = parsePullLine(buffer.trim());
					sendProgress({ modelName, ...parsed });
				}
				if (code === 0) {
					sendProgress({
						modelName,
						status: "success",
						percent: 100,
						raw: "done",
					});
					resolve();
				} else {
					reject(new Error(`ollama pull exited with code ${code}`));
				}
			});
		});
	});

	// models:delete — ollama rm <modelName>
	ipcMain.handle("models:delete", async (_event, modelName: string) => {
		const ollamaPath = await which("ollama");
		if (!ollamaPath) throw new Error("Ollama is not installed");
		await execFileAsync(ollamaPath, ["rm", modelName], { env: process.env });
	});
}
