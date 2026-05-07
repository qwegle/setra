/**
 * setra --desktop — launch the Electron app
 *
 * Looks for the desktop app binary in common install locations.
 * If not found, prompts the user to install setra-desktop.
 */

import { existsSync } from "fs";
import { resolve } from "path";
import { execa } from "execa";
import { c, icon } from "../tui/theme.js";

const DESKTOP_BINARY_NAMES = [
	"setra-desktop",
	"/Applications/setra.app/Contents/MacOS/setra",
	"/usr/local/bin/setra-desktop",
];

export async function launchDesktop(): Promise<void> {
	// Find installed desktop app
	for (const candidate of DESKTOP_BINARY_NAMES) {
		if (existsSync(candidate)) {
			console.log(`  ${icon.pending} Launching ${c.accent("setra desktop")}…`);
			await execa(candidate, [], { stdio: "inherit" });
			return;
		}
	}

	// Not installed
	console.log(`\n  ${icon.error} setra desktop not installed.\n`);
	console.log(`  Install it:\n`);
	console.log(
		`    ${c.key("npm install -g setra-desktop")}  (~300MB, includes Electron)\n`,
	);
	console.log(
		`  Or download from: ${c.accentDim("https://setra.sh/download")}\n`,
	);
	process.exit(1);
}
