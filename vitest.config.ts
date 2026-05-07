import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: [
			"packages/*/src/__tests__/**/*.test.ts",
			"packages/*/tests/**/*.test.ts",
			"apps/cli/src/**/*.test.ts",
			"apps/server/src/**/*.test.ts",
		],
		exclude: [...configDefaults.exclude, "apps/board/**", "apps/desktop/**"],
		coverage: {
			reporter: ["text", "lcov"],
			include: ["packages/*/src/**/*.ts", "apps/cli/src/**/*.ts"],
			exclude: ["**/node_modules/**", "**/dist/**", "**/__tests__/**"],
		},
		testTimeout: 15000,
	},
});
