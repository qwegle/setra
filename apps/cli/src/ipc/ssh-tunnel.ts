/**
 * SSH tunnel for remote setra-core access
 *
 * When a ground is remote, the TUI connects by:
 *   1. Opening an SSH connection via ssh2
 *   2. Forwarding local Unix socket → remote setra-core socket
 *   3. SocketClient connects to the local forwarded socket
 *
 * This means the TUI code never needs to know if it's local or remote —
 * the same SocketClient API works in both cases.
 *
 * SSH:  local ~/.setra/tunnel-{groundId}.sock  ←→  remote ~/.setra/daemon.sock
 */

import { EventEmitter } from "events";
import type net from "net";
import os from "os";
import path from "path";
import type { Ground } from "./socket.js";

export class SSHTunnel extends EventEmitter {
	private server: net.Server | null = null;

	constructor(
		private ground: Ground,
		private remoteSocketPath = "~/.setra/daemon.sock",
	) {
		super();
	}

	get localSocketPath(): string {
		return path.join(os.homedir(), ".setra", `tunnel-${this.ground.id}.sock`);
	}

	/**
	 * Start the local Unix socket server and forward connections via SSH.
	 * Resolves with the local socket path once ready.
	 */
	start(): Promise<string> {
		return new Promise((resolve, reject) => {
			// Remove stale socket file if it exists
			try {
				const fs = require("fs"); // lazy sync rm
				fs.unlinkSync(this.localSocketPath);
			} catch {
				/* doesn't exist, fine */
			}

			// We use the system `ssh` binary here for reliability. The ssh2 library
			// is reserved for agent-runner's remote PTY (where we need programmatic
			// control of the session). For the tunnel, system ssh handles reconnect,
			// key agent, and known_hosts transparently.
			//
			// Command:
			//   ssh -N -o ExitOnForwardFailure=yes \
			//       -L <localSocket>:<remoteSocket> \
			//       [-i <identityFile>] [-p <port>] \
			//       <user>@<host>
			//
			// The -N flag means "no shell" — just the tunnel.
			// We monitor the process; if it exits, emit 'disconnect'.

			const { spawn } = require("child_process");

			const args: string[] = [
				"-N",
				"-o",
				"ExitOnForwardFailure=yes",
				"-o",
				"ServerAliveInterval=15",
				"-o",
				"ServerAliveCountMax=3",
				"-o",
				"StrictHostKeyChecking=accept-new",
				"-L",
				`${this.localSocketPath}:${this.remoteSocketPath}`,
			];

			if (this.ground.port !== 22) {
				args.push("-p", String(this.ground.port));
			}

			args.push(`${this.ground.user}@${this.ground.host}`);

			const proc = spawn("ssh", args, { stdio: "pipe" });

			proc.on("error", reject);
			proc.on("exit", (code: number) => {
				this.emit("disconnect", code);
			});

			// Poll for socket file to appear (ssh -L creates it on the remote side)
			const pollStart = Date.now();
			const poll = setInterval(() => {
				const fs = require("fs");
				if (fs.existsSync(this.localSocketPath)) {
					clearInterval(poll);
					resolve(this.localSocketPath);
				}
				if (Date.now() - pollStart > 10_000) {
					clearInterval(poll);
					proc.kill();
					reject(new Error(`SSH tunnel to ${this.ground.host} timed out`));
				}
			}, 200);
		});
	}

	stop(): void {
		this.server?.close();
		try {
			const fs = require("fs");
			fs.unlinkSync(this.localSocketPath);
		} catch {
			/* ignore */
		}
		this.emit("disconnect", 0);
	}
}
