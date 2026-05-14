/**
 * Rebuild native modules (better-sqlite3, node-pty) for Electron's Node ABI.
 *
 * Previous versions relied on `prebuild-install`, which silently no-ops when
 * the upstream package doesn't publish prebuilds for the active Electron
 * ABI — leaving the wrong-ABI Node binary in place. We now delegate
 * exclusively to @electron/rebuild and verify the resulting ABI.
 */

const fs = require("fs");
const path = require("path");

const SQLITE_DIR = path.dirname(require.resolve("better-sqlite3/package.json"));
const SQLITE_RELEASE = path.join(SQLITE_DIR, "build/Release");
const BINARY = path.join(SQLITE_RELEASE, "better_sqlite3.node");
const NODEJS_BACKUP = path.join(SQLITE_RELEASE, "better_sqlite3.node.nodejs");

function abiOf(file) {
if (!fs.existsSync(file)) return 0;
const m = fs.readFileSync(file).toString("binary").match(/node_register_module_v(\d+)/);
return m ? Number.parseInt(m[1], 10) : 0;
}

function saveNodejsBackup() {
if (abiOf(BINARY) === 115) {
fs.copyFileSync(BINARY, NODEJS_BACKUP);
console.log("  Saved Node.js ABI-115 binary as backup");
}
}

async function main() {
saveNodejsBackup();

const { rebuild } = require("@electron/rebuild");
const ELECTRON_VERSION = require("electron/package.json").version;
const ELECTRON_ABI = Number.parseInt(
require("node-abi").getAbi(ELECTRON_VERSION, "electron"),
10,
);

console.log(`  Rebuilding for Electron ${ELECTRON_VERSION} (ABI ${ELECTRON_ABI})`);

await rebuild({
buildPath: SQLITE_DIR,
projectRootPath: path.resolve(__dirname, "../../.."),
electronVersion: ELECTRON_VERSION,
force: true,
onlyModules: ["better-sqlite3", "node-pty"],
arch: process.arch,
});

const finalAbi = abiOf(BINARY);
if (finalAbi === ELECTRON_ABI) {
console.log("  ✔ better-sqlite3 rebuilt to Electron ABI");
} else {
console.error(`  ✗ Rebuild left binary at ABI ${finalAbi} (need ${ELECTRON_ABI})`);
process.exitCode = 1;
return;
}

console.log("✔ Electron native rebuild done (better-sqlite3 + node-pty)");
}

main().catch((e) => {
console.error("✗ Electron native rebuild failed:", e.message);
process.exit(1);
});
