// Redirect better-sqlite3 native module to ABI 115 (Node.js) binary.
// The main .node file is ABI 130 (Electron). The .nodejs backup is ABI 115.
const fs = require("fs");
const origDlopen = process.dlopen.bind(process);
process.dlopen = (module, filename, ...args) => {
	let resolvedFilename = filename;
	if (filename.endsWith("better_sqlite3.node") && !process.versions.electron) {
		const alt = filename + ".nodejs";
		if (fs.existsSync(alt)) resolvedFilename = alt;
	}
	return origDlopen(module, resolvedFilename, ...args);
};
