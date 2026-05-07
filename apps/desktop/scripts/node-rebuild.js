/**
 * node-rebuild.js — restore better-sqlite3 to Node.js ABI binary.
 *
 * Called by the server supervisor before (re)starting the server process,
 * so the server always loads the correct Node.js ABI binary, even if
 * electron-rebuild ran previously and left the Electron ABI in build/Release.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const SQLITE_RELEASE = path.join(
	path.dirname(require.resolve("better-sqlite3/package.json")),
	"build/Release",
);

const src = path.join(SQLITE_RELEASE, "better_sqlite3.node");
const bak = path.join(SQLITE_RELEASE, "better_sqlite3.node.nodejs");

if (fs.existsSync(bak)) {
	// Fast path: backup exists from a prior electron-rebuild run → just swap
	fs.copyFileSync(bak, src);
	console.log("✔ Restored Node.js binary from backup (fast path)");
} else {
	// Slow path: no backup yet — rebuild for Node.js from scratch
	console.log("  No Node.js backup found, rebuilding for Node.js...");
	try {
		execFileSync("node-gyp", ["rebuild", "--release"], {
			cwd: path.dirname(require.resolve("better-sqlite3/package.json")),
			stdio: "inherit",
		});
		// Save backup for next time
		if (fs.existsSync(src)) fs.copyFileSync(src, bak);
		console.log("✔ Node.js native rebuild done");
	} catch (e) {
		console.warn(
			"⚠ node-rebuild failed:",
			e.message,
			"— server may fail to load",
		);
	}
}
