import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Bundle all @setra/* workspace packages directly into the main/preload
// bundles rather than externalizing them. This avoids ESM-vs-CJS conflicts
// when Electron's main process (CJS) tries to require() an ESM-only package.
// Note: externalizeDepsPlugin `exclude` takes string package names (not regex).
// @setra/memory is intentionally NOT in this list — it pulls in @xenova/transformers
// → onnxruntime-web which has native .node binaries that cannot be bundled.
const BUNDLE_WORKSPACE = {
	exclude: [
		"@setra/types",
		"@setra/db",
		"@setra/monitor",
		"@setra/security",
		"@setra/modules",
		"@setra/skills",
		"@setra/commands",
		"@setra/core",
		"@setra/agent-runner",
		"@setra/shared",
		"@setra/company",
		"@setra/mcp",
		"@setra/git",
	],
};

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin(BUNDLE_WORKSPACE)],
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/main/index.ts"),
				},
			},
		},
	},

	preload: {
		plugins: [externalizeDepsPlugin(BUNDLE_WORKSPACE)],
		build: {
			rollupOptions: {
				input: {
					index: resolve(__dirname, "src/preload/index.ts"),
				},
			},
		},
	},

	// No renderer entry — the board app (apps/board) IS the UI.
	// Dev:  Electron loads http://localhost:5173 (board's Vite dev server)
	// Prod: Electron loads from the board's built dist (bundled via extraResources)
});
