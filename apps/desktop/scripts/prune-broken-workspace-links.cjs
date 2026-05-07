#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const setraHoistDir = path.join(ROOT, "node_modules/.pnpm/node_modules/@setra");

function isBrokenLink(absPath) {
	try {
		const st = fs.lstatSync(absPath);
		if (!st.isSymbolicLink()) return false;
		const target = fs.readlinkSync(absPath);
		const resolved = path.resolve(path.dirname(absPath), target);
		return !fs.existsSync(resolved);
	} catch {
		return false;
	}
}

function main() {
	if (!fs.existsSync(setraHoistDir)) return;
	const names = fs.readdirSync(setraHoistDir);
	let removed = 0;
	for (const name of names) {
		const abs = path.join(setraHoistDir, name);
		if (!isBrokenLink(abs)) continue;
		fs.unlinkSync(abs);
		removed += 1;
	}
	if (removed > 0) {
		console.log(
			`[desktop-build] pruned ${removed} broken workspace link(s) from ${setraHoistDir}`,
		);
	}
}

main();
