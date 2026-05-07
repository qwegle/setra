#!/usr/bin/env node
/**
 * Post-pack hook: strip dev/build artifacts from native modules
 * in the asar-unpacked directory to reduce install size.
 */
const fs = require("node:fs");
const path = require("node:path");

const STRIP_PATTERNS = [
	/(^|\/)(src|deps|test|tests|docs?|examples?|benchmark)(\/|$)/i,
	/(^|\/)\.github(\/|$)/,
	/\/build\/Release\/obj(\/|$)/i,
	/\/build\/deps(\/|$)/i,
	/\/build\/node_gyp_bins(\/|$)/i,
	/\/prebuilds(\/|$)/i,
	/\/binding\.gyp$/i,
	/\/Makefile$/i,
	/\/CHANGELOG/i,
	/\/LICENSE/i,
	/\/README/i,
	/\.md$/i,
	/\.ts$/i,
	/\.map$/i,
	/\.node\.nodejs$/i,
	/\/test_extension\.node$/i,
	/\/\.eslint/i,
	/\/\.prettier/i,
];

function shouldStrip(relativePath) {
	return STRIP_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function sizeOf(targetPath) {
	const stats = fs.lstatSync(targetPath);
	if (!stats.isDirectory()) return stats.size;

	let total = 0;
	for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
		total += sizeOf(path.join(targetPath, entry.name));
	}
	return total;
}

function pruneRecursive(dir, rootDir) {
	if (!fs.existsSync(dir)) return 0;
	let freed = 0;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		const relativePath = `/${path.relative(rootDir, fullPath).split(path.sep).join("/")}`;

		if (shouldStrip(relativePath)) {
			freed += sizeOf(fullPath);
			fs.rmSync(fullPath, { recursive: true, force: true });
			continue;
		}

		if (entry.isDirectory()) {
			freed += pruneRecursive(fullPath, rootDir);
			try {
				if (fs.readdirSync(fullPath).length === 0) {
					fs.rmdirSync(fullPath);
				}
			} catch {
				// Ignore races while pruning.
			}
		}
	}

	return freed;
}

function main() {
	const targetDir = process.argv[2];
	if (!targetDir) {
		console.error("Usage: strip-native-bloat.cjs <app-unpacked-dir>");
		process.exit(1);
	}

	const nodeModulesDir = path.join(targetDir, "node_modules");
	if (!fs.existsSync(nodeModulesDir)) {
		console.log("[strip] No node_modules found, skipping");
		return;
	}

	const freed = pruneRecursive(nodeModulesDir, nodeModulesDir);
	console.log(
		`[strip] Removed ${(freed / 1024 / 1024).toFixed(1)} MB of dev/build artifacts`,
	);
}

main();
