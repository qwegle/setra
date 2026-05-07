const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const SQLITE_DIR = path.dirname(require.resolve("better-sqlite3/package.json"));
const SQLITE_RELEASE = path.join(SQLITE_DIR, "build/Release");
const BINARY = path.join(SQLITE_RELEASE, "better_sqlite3.node");
const NODEJS_BACKUP = path.join(SQLITE_RELEASE, "better_sqlite3.node.nodejs");

// Save current binary as Node.js backup (only if it's the Node.js ABI)
function saveNodejsBackup() {
	if (!fs.existsSync(BINARY)) return;
	// Check ABI version embedded in binary
	const data = fs.readFileSync(BINARY);
	const match = data.toString("binary").match(/node_register_module_v(\d+)/);
	const abi = match ? Number.parseInt(match[1]) : 0;
	if (abi === 115) {
		// Node.js v20 ABI — save as backup
		fs.copyFileSync(BINARY, NODEJS_BACKUP);
		console.log("  Saved Node.js ABI-115 binary as backup");
	}
}

// Use prebuild-install to get the Electron ABI binary (fast — downloads prebuilt)
// Falls back to node-gyp compile if no prebuilt available
function buildElectronBinary() {
	try {
		execFileSync(
			"npx",
			[
				"prebuild-install",
				"--runtime",
				"electron",
				"--target",
				require("electron/package.json").version,
				"--arch",
				process.arch,
				"--platform",
				process.platform,
				"--download",
			],
			{ cwd: SQLITE_DIR, stdio: "pipe" },
		);
		// prebuild-install places binary in lib/binding/ — copy to build/Release
		const prebuildBinary = path.join(
			SQLITE_DIR,
			`lib/binding/node-v130-${process.platform}-${process.arch}/better_sqlite3.node`,
		);
		if (fs.existsSync(prebuildBinary)) {
			fs.mkdirSync(SQLITE_RELEASE, { recursive: true });
			fs.copyFileSync(prebuildBinary, BINARY);
			console.log("  Installed Electron prebuilt binary to build/Release");
		}
	} catch {
		// Fallback: compile with node-gyp + Electron headers
		console.log("  Prebuilt not available — compiling with node-gyp...");
		try {
			execFileSync(
				"node-gyp",
				[
					"rebuild",
					"--release",
					`--target=${require("electron/package.json").version}`,
					`--arch=${process.arch}`,
					"--dist-url=https://electronjs.org/headers",
				],
				{
					cwd: SQLITE_DIR,
					env: { ...process.env, HOME: `${process.env.HOME}/.electron-gyp` },
					stdio: "inherit",
				},
			);
		} catch (e2) {
			console.error("  ✗ Compile fallback also failed:", e2.message);
			process.exit(1);
		}
	}
}

saveNodejsBackup();
buildElectronBinary();

// Also rebuild node-pty for Electron (needed for PTY bridge)
try {
	const rebuildPath = require.resolve("@electron/rebuild/lib/rebuild.js");
	const { rebuild } = require(rebuildPath);
	const ELECTRON_VERSION = require("electron/package.json").version;
	rebuild({
		buildPath: path.resolve(__dirname, "../../.."),
		electronVersion: ELECTRON_VERSION,
		force: true,
		onlyModules: ["node-pty"],
		arch: process.arch,
	})
		.then(() =>
			console.log("✔ Electron native rebuild done (better-sqlite3 + node-pty)"),
		)
		.catch((e) => console.warn("  ⚠ node-pty rebuild warning:", e.message));
} catch (e) {
	console.warn("  ⚠ Could not rebuild node-pty:", e.message);
}
