import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: ["./src/schema/index.ts", "./src/schema/enterprise.ts"],
	out: "./migrations",
	dialect: "sqlite",
	dbCredentials: {
		url: join(homedir(), ".setra", "setra.db"),
	},
});
