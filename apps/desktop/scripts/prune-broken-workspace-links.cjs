#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const hoistRoot = path.join(ROOT, "node_modules/.pnpm/node_modules");

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

function pruneDir(dir) {
	if (!fs.existsSync(dir)) return 0;
	let removed = 0;
	for (const name of fs.readdirSync(dir)) {
		const abs = path.join(dir, name);
		if (isBrokenLink(abs)) {
			fs.unlinkSync(abs);
			removed += 1;
		}
	}
	return removed;
}

function main() {
	if (!fs.existsSync(hoistRoot)) return;
	let removed = 0;
	for (const name of fs.readdirSync(hoistRoot)) {
		const abs = path.join(hoistRoot, name);
		try {
			const st = fs.lstatSync(abs);
			if (st.isSymbolicLink()) {
				if (isBrokenLink(abs)) {
					fs.unlinkSync(abs);
					removed += 1;
				}
			} else if (st.isDirectory() && name.startsWith("@")) {
				removed += pruneDir(abs);
			}
		} catch {
			// ignore
		}
	}
	if (removed > 0) {
		console.log(
			`[desktop-build] pruned ${removed} broken workspace/optional link(s) from ${hoistRoot}`,
		);
	}
}

main();
