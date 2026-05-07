import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSlashCommand } from "../resolver.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "setra-res-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveSlashCommand", () => {
	it("resolves /new → new_session action", () => {
		const result = resolveSlashCommand("/new", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("new");
		expect(result.action?.type).toBe("new_session");
	});

	it("resolves /model claude-opus-4 → set_model action with argument", () => {
		const result = resolveSlashCommand("/model claude-opus-4", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("model");
		expect(result.action?.type).toBe("set_model");
		expect(result.action?.argument).toBe("claude-opus-4");
	});

	it("resolves /review src/auth.ts → prompt with $ARGUMENTS substituted", () => {
		const result = resolveSlashCommand("/review src/auth.ts", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("review");
		expect(result.prompt).toBeDefined();
		expect(result.prompt).toContain("src/auth.ts");
		expect(result.prompt).not.toContain("$ARGUMENTS");
	});

	it("returns handled=false for unknown command", () => {
		const result = resolveSlashCommand("/nonexistentcommandxyz", tmpDir);
		expect(result.handled).toBe(false);
	});

	it("returns handled=false for non-slash input", () => {
		const result = resolveSlashCommand("just some text", tmpDir);
		expect(result.handled).toBe(false);
	});

	it("resolves command by alias — /clear resolves to new", () => {
		const result = resolveSlashCommand("/clear", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("new");
		expect(result.action?.type).toBe("new_session");
	});

	it("resolves /help → template prompt", () => {
		const result = resolveSlashCommand("/help", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("help");
		expect(result.prompt).toBeDefined();
		expect(typeof result.prompt).toBe("string");
		expect(result.prompt!.length).toBeGreaterThan(0);
	});

	it("resolves /? alias → help template", () => {
		const result = resolveSlashCommand("/?", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("help");
	});

	it("handles extra whitespace around command name", () => {
		// The resolver strips leading slash then trims — "/ new" should still work
		// Actually the implementation does: withoutSlash = text.slice(1).trim()
		// So "/  model gpt-4o" → "model gpt-4o" after trim
		const result = resolveSlashCommand("/  model gpt-4o", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("model");
		expect(result.action?.argument).toBe("gpt-4o");
	});

	it("resolves /cost → show_cost action via alias /spend", () => {
		const result = resolveSlashCommand("/spend", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.action?.type).toBe("show_cost");
	});

	it("substitutes empty string when no args given to template command", () => {
		const result = resolveSlashCommand("/review", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.prompt).toBeDefined();
		expect(result.prompt).not.toContain("$ARGUMENTS");
	});

	it("resolves custom project command when defined in .setra/commands", () => {
		const projectCmdsDir = path.join(tmpDir, ".setra", "commands");
		fs.mkdirSync(projectCmdsDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectCmdsDir, "deploy.md"),
			[
				"---",
				"name: deploy",
				"description: Deploy app",
				"---",
				"Deploy the application: $ARGUMENTS",
			].join("\n"),
			"utf-8",
		);

		const result = resolveSlashCommand("/deploy staging", tmpDir);
		expect(result.handled).toBe(true);
		expect(result.commandName).toBe("deploy");
		expect(result.prompt).toBe("Deploy the application: staging");
	});
});
