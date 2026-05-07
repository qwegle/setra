/**
 * TUI entry point — renders the Ink app tree
 *
 * Startup experience:
 *   1. Print the setra.sh logo (one-time, then erased)
 *   2. Attempt to connect to setra-core daemon
 *   3. If daemon not running, offer to start it automatically
 *   4. On connect, render the full Layout
 *
 * The ConnectionGate component handles steps 2–3 before showing Layout,
 * so the user never sees a "daemon offline" flash in the main UI.
 */

import chalk from "chalk";
import { execa } from "execa";
import { Box, Text, render } from "ink";
import Spinner from "ink-spinner";
import React, { useState, useEffect } from "react";
import { getClient } from "../ipc/socket.js";
import { api } from "../ipc/socket.js";
import { Layout } from "./components/Layout.js";
import { c, icon, palette } from "./theme.js";

// Model availability banner
function ModelWarningBanner() {
	const [warning, setWarning] = React.useState<"no-keys" | "no-models" | null>(
		null,
	);

	React.useEffect(() => {
		const hasAnyKey = !!(
			process.env["ANTHROPIC_API_KEY"] ||
			process.env["OPENAI_API_KEY"] ||
			process.env["GEMINI_API_KEY"] ||
			process.env["GOOGLE_API_KEY"]
		);
		if (!hasAnyKey) {
			// Check if Ollama is running
			fetch("http://localhost:11434/api/tags", {
				signal: AbortSignal.timeout(1500),
			})
				.then((r) => {
					if (r.ok) {
						setWarning("no-keys"); // Ollama available, no cloud keys
					} else {
						setWarning("no-models"); // Nothing available
					}
				})
				.catch(() => setWarning("no-models"));
		}
	}, []);

	if (!warning) return null;

	if (warning === "no-keys") {
		return (
			<Box paddingX={2} paddingY={0}>
				<Text color="yellow">
					⚠ No cloud API keys — using local models (Ollama)
				</Text>
			</Box>
		);
	}

	return (
		<Box paddingX={2} paddingY={0}>
			<Text color="red">
				✗ No models available. Run: setra models install ollama or set
				ANTHROPIC_API_KEY
			</Text>
		</Box>
	);
}

// ─── ASCII logo (printed once, before the reactive UI takes over) ─────────────
//
// Font: block letters using box-drawing characters.
// Width: 40 chars. Rendered at startup then cleared.
//
// setra
// ┏━━━━━━━━━━━━━━━━━━━┓
// ┃  setra.sh  v0.1  ┃
// ┗━━━━━━━━━━━━━━━━━━━┛

// ─── setra.sh console logo ────────────────────────────────────────────────────
//
// Rendered once at startup before the reactive Ink UI takes over.
// Colors: accent blue for the wordmark, muted for the subtitle.
//
//   ███████╗███████╗████████╗██████╗  █████╗
//   ██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗
//   ███████╗█████╗     ██║   ██████╔╝███████║
//   ╚════██║██╔══╝     ██║   ██╔══██╗██╔══██║
//   ███████║███████╗   ██║   ██║  ██║██║  ██║
//   ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝

function buildLogo(): string {
	const a = (s: string) => chalk.hex("#4f7eff")(s); // accent blue
	const b = (s: string) => chalk.hex("#4f7eff").bold(s);
	const m = (s: string) => chalk.hex("#484f58")(s); // muted
	const s = (s: string) => chalk.hex("#8b949e")(s); // secondary

	const lines = [
		b("  ███████╗███████╗████████╗██████╗  █████╗ ") + a(" .sh"),
		b("  ██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗"),
		b("  ███████╗█████╗     ██║   ██████╔╝███████║"),
		b("  ╚════██║██╔══╝     ██║   ██╔══██╗██╔══██║"),
		b("  ███████║███████╗   ██║   ██║  ██║██║  ██║"),
		b("  ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝"),
		"",
		s("  a field for AI agents") + m("  ·  v0.1.0  ·  Apache 2.0"),
		m("  ─────────────────────────────────────────────"),
	];
	return lines.join("\n");
}

const LOGO = buildLogo();

// ─── ConnectionGate — wraps the app, handles daemon startup ──────────────────

type GateState = "connecting" | "starting-daemon" | "connected" | "error";

function ConnectionGate({ children }: { children: React.ReactNode }) {
	const [state, setState] = useState<GateState>("connecting");
	const [errorMsg, setErrorMsg] = useState("");

	useEffect(() => {
		attemptConnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	async function attemptConnect() {
		setState("connecting");
		try {
			await getClient().connect();
			setState("connected");
		} catch {
			// Daemon not running — try to start it
			await startDaemon();
		}
	}

	async function startDaemon() {
		setState("starting-daemon");
		try {
			// Start daemon in background (detached)
			execa("setra", ["serve", "--detach"], {
				detached: true,
				stdio: "ignore",
			}).unref();

			// Wait up to 5s for it to start
			for (let i = 0; i < 25; i++) {
				await sleep(200);
				try {
					await getClient().connect();
					setState("connected");
					return;
				} catch {
					/* not ready yet */
				}
			}

			throw new Error("Daemon did not start within 5 seconds");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			setErrorMsg(msg);
			setState("error");
		}
	}

	if (state === "connected") {
		return (
			<>
				<ModelWarningBanner />
				{children}
			</>
		);
	}

	return (
		<Box flexDirection="column" padding={2}>
			<Text>{LOGO}</Text>

			{state === "connecting" && (
				<Box>
					<Spinner type="dots" />
					<Text color={palette.textSecondary}>
						{" Connecting to setra-core…"}
					</Text>
				</Box>
			)}

			{state === "starting-daemon" && (
				<Box flexDirection="column">
					<Box>
						<Spinner type="dots" />
						<Text color={palette.textSecondary}>
							{" Starting setra-core daemon…"}
						</Text>
					</Box>
					<Text color={palette.textMuted}>{"  (setra serve --detach)"}</Text>
				</Box>
			)}

			{state === "error" && (
				<Box flexDirection="column">
					<Text color={palette.error}>
						{icon.error + " Failed to start setra-core"}
					</Text>
					<Text color={palette.textMuted}>{"  " + errorMsg}</Text>
					<Box marginTop={1}>
						<Text color={palette.textSecondary}>
							{"  Run "}
							{c.key("setra serve")}
							{" in another terminal, then try again."}
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}

// ─── Launch function (called from cli.ts) ────────────────────────────────────

export async function launchTUI(): Promise<void> {
	// Print the logo to stdout before Ink takes over the terminal.
	// Ink uses an alternate buffer — the logo appears in the normal buffer
	// before the TUI starts, so it shows up while connecting.
	process.stdout.write("\n" + LOGO + "\n\n");

	const { waitUntilExit } = render(
		<ConnectionGate>
			<Layout />
		</ConnectionGate>,
		{
			exitOnCtrlC: true,
		},
	);

	await waitUntilExit();
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export { CommandInput } from "./components/CommandInput.js";
export type { CommandInputProps } from "./components/CommandInput.js";
