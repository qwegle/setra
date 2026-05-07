import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		strictPort: true, // fail fast if port is taken so we don't silently bump
		proxy: {
			"/api": {
				target: "http://localhost:3141",
				changeOrigin: true,
				ws: false, // SSE uses HTTP, not WS
			},
		},
	},
	build: {
		outDir: "dist",
		sourcemap: true,
	},
});
