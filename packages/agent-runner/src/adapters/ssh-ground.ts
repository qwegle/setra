/**
 * SSH Ground Adapter
 *
 * Wraps SSH command execution with safety checks from ssh-safety.ts.
 * Commands flagged as requiring confirmation are sent to the team broker
 * as approval requests; unsafe/out-of-scope commands are blocked entirely.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type SshSafetyConfig, checkSshCommand } from "../ssh-safety.js";

// ─── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SshSafetyConfig = {
	allowDestructiveWithoutConfirmation: false,
	allowedCategories: ["deploy", "cicd", "monitor", "support"],
};

/** Load safety config from ~/.setra/grounds/{groundId}/safety.json */
function loadSafetyConfig(groundId: string): SshSafetyConfig {
	try {
		const configPath = join(
			homedir(),
			".setra",
			"grounds",
			groundId,
			"safety.json",
		);
		const raw = readFileSync(configPath, "utf-8");
		return {
			...DEFAULT_CONFIG,
			...(JSON.parse(raw) as Partial<SshSafetyConfig>),
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}

// ─── SshGroundAdapter ─────────────────────────────────────────────────────────

export interface SshRunOptions {
	host: string;
	username: string;
	port?: number;
	keyPath?: string;
}

export class SshGroundAdapter {
	private config: SshSafetyConfig;

	constructor(config?: Partial<SshSafetyConfig> | string) {
		if (typeof config === "string") {
			// Ground ID — load config from disk
			this.config = loadSafetyConfig(config);
		} else {
			this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
		}
	}

	/**
	 * Run a command on a remote SSH host.
	 * Returns { output } on success, or { output: "", blocked: reason } if blocked.
	 * If confirmation is required, the promise rejects with an error that
	 * includes requiresConfirmation: true so callers can surface an approval flow.
	 */
	async runCommand(
		command: string,
		sshOptions?: SshRunOptions,
	): Promise<{ output: string; blocked?: string }> {
		const check = checkSshCommand(command, this.config);

		if (!check.safe && !check.requiresConfirmation) {
			return {
				output: "",
				blocked:
					check.reason +
					(check.suggestedAlternative ? ` ${check.suggestedAlternative}` : ""),
			};
		}

		if (check.requiresConfirmation) {
			// Surface as a structured error so callers can request broker approval
			const err = Object.assign(
				new Error(`Confirmation required: ${check.reason}`),
				{
					requiresConfirmation: true,
					reason: check.reason,
					suggestedAlternative: check.suggestedAlternative,
				},
			);
			throw err;
		}

		// Execute via SSH subprocess if ssh options are provided, else run locally
		if (sshOptions) {
			return this.execViaSsh(command, sshOptions);
		}

		return this.execLocal(command);
	}

	private execViaSsh(
		command: string,
		opts: SshRunOptions,
	): Promise<{ output: string }> {
		return new Promise((resolve, reject) => {
			const sshArgs: string[] = [];

			if (opts.keyPath) {
				sshArgs.push("-i", opts.keyPath);
			}

			sshArgs.push(
				"-p",
				String(opts.port ?? 22),
				"-o",
				"StrictHostKeyChecking=accept-new",
				"-o",
				"BatchMode=yes",
				`${opts.username}@${opts.host}`,
				command,
			);

			const proc = spawn("ssh", sshArgs);
			const chunks: Buffer[] = [];
			const errChunks: Buffer[] = [];

			proc.stdout.on("data", (d: Buffer) => chunks.push(d));
			proc.stderr.on("data", (d: Buffer) => errChunks.push(d));

			proc.on("close", (code) => {
				const output = Buffer.concat(chunks).toString("utf-8");
				const stderr = Buffer.concat(errChunks).toString("utf-8");
				if (code !== 0) {
					reject(new Error(`SSH command exited ${code}: ${stderr || output}`));
				} else {
					resolve({ output });
				}
			});

			proc.on("error", reject);
		});
	}

	private execLocal(command: string): Promise<{ output: string }> {
		return new Promise((resolve, reject) => {
			const proc = spawn("sh", ["-c", command]);
			const chunks: Buffer[] = [];
			const errChunks: Buffer[] = [];

			proc.stdout.on("data", (d: Buffer) => chunks.push(d));
			proc.stderr.on("data", (d: Buffer) => errChunks.push(d));

			proc.on("close", (code) => {
				const output = Buffer.concat(chunks).toString("utf-8");
				const stderr = Buffer.concat(errChunks).toString("utf-8");
				if (code !== 0) {
					reject(new Error(`Command exited ${code}: ${stderr || output}`));
				} else {
					resolve({ output });
				}
			});

			proc.on("error", reject);
		});
	}
}
