import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRow, IssueRow } from "../types.js";

const INTEGRATION_CONTEXT =
	"## Integration Context\nGitHub is connected for issue and pull request workflows.";

let db: Database.Database;

function createDb(): Database.Database {
	const nextDb = new Database(":memory:");
	nextDb.exec(`
		CREATE TABLE company_settings (
			id TEXT PRIMARY KEY,
			name TEXT,
			slug TEXT
		);
		CREATE TABLE board_projects (
			id TEXT PRIMARY KEY,
			company_id TEXT,
			name TEXT
		);
		CREATE TABLE board_issues (
			id TEXT PRIMARY KEY,
			project_id TEXT,
			status TEXT
		);
		CREATE TABLE clone_profile (
			company_id TEXT,
			brief TEXT,
			mode TEXT
		);
		CREATE TABLE team_messages (
			id TEXT PRIMARY KEY,
			company_id TEXT,
			channel TEXT,
			from_agent TEXT,
			content TEXT,
			created_at TEXT
		);
		CREATE TABLE integrations (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			status TEXT,
			config_json TEXT,
			company_id TEXT,
			created_at TEXT,
			updated_at TEXT
		);
	`);
	return nextDb;
}

async function loadPromptBuilder() {
	vi.resetModules();
	vi.doMock("@setra/db", () => ({
		getRawDb: () => db,
	}));
	vi.doMock("@setra/core/integrations.js", () => ({
		INTEGRATIONS: [{ id: "github", name: "GitHub" }],
		buildIntegrationContext: () => INTEGRATION_CONTEXT,
	}));
	vi.doMock("@setra/memory", () => ({
		MemoryStore: class {
			async init() {}
			async search() {
				return [];
			}
			async add() {
				return "memory-1";
			}
		},
	}));
	vi.doMock("@setra/mcp", () => ({
		getMcpManager: () => ({
			getAllStates: () => [],
		}),
	}));
	vi.doMock("../project-rules.js", () => ({
		loadProjectRules: async () => [],
		getMatchingRules: async () => "",
	}));
	return import("../prompt-builder.js");
}

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
	return {
		id: "agent-1",
		slug: "backend-engineer",
		display_name: "Riley Backend Engineer",
		adapter_type: null,
		model_id: null,
		system_prompt:
			"You are Riley, a pragmatic backend engineer focused on reliability.",
		skills: null,
		company_id: null,
		...overrides,
	};
}

function makeIssue(overrides: Partial<IssueRow> = {}): IssueRow {
	return {
		id: "issue-1",
		projectId: "project-1",
		companyId: "company-1",
		slug: "SET-101",
		title: "Add server coverage",
		description: "Exercise prompt construction paths.",
		workspacePath: null,
		...overrides,
	};
}

beforeEach(() => {
	db = createDb();
});

afterEach(() => {
	db.close();
	vi.restoreAllMocks();
});

describe("buildSystemPrompt", () => {
	it("includes the agent role/persona in the system prompt", async () => {
		const { buildSystemPrompt } = await loadPromptBuilder();
		const prompt = await buildSystemPrompt(
			makeAgent(),
			null,
			"Investigate the failing deployment.",
		);

		expect(prompt).toContain(
			"You are Riley, a pragmatic backend engineer focused on reliability.",
		);
	});

	it("adds the MetaGPT-style complexity instructions for CEO agents", async () => {
		const { buildSystemPrompt } = await loadPromptBuilder();
		const prompt = await buildSystemPrompt(
			makeAgent({ slug: "ceo", display_name: "CEO" }),
			makeIssue(),
			"Plan the next release.",
		);

		expect(prompt).toContain("[COMPLEXITY: XS|S|M|L|XL]");
		expect(prompt).toContain(
			"M: Multi-file feature, needs design thinking (< 2 hours)",
		);
	});

	it("injects the clone brief when one is configured", async () => {
		db.prepare(
			"INSERT INTO clone_profile (company_id, brief, mode) VALUES (?, ?, ?)",
		).run(
			"company-1",
			"Prefer crisp updates, prioritize impact, and explain trade-offs.",
			"locked",
		);

		const { buildSystemPrompt } = await loadPromptBuilder();
		const prompt = await buildSystemPrompt(
			makeAgent({ company_id: "company-1" }),
			makeIssue(),
			"Ship the patch.",
		);

		expect(prompt).toContain("## Your Boss's Working Style");
		expect(prompt).toContain("Prefer crisp updates, prioritize impact");
		expect(prompt).toContain("Clone is in LOCKED mode");
	});

	it("includes integration context for active company integrations", async () => {
		db.prepare(
			`INSERT INTO integrations (id, type, name, status, config_json, company_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			"int-1",
			"github",
			"GitHub",
			"connected",
			"{}",
			"company-1",
			new Date().toISOString(),
		);

		const { buildSystemPrompt } = await loadPromptBuilder();
		const prompt = await buildSystemPrompt(
			makeAgent({ company_id: "company-1" }),
			makeIssue(),
			"Review the linked pull request.",
		);

		expect(prompt).toContain(INTEGRATION_CONTEXT);
		expect(prompt).toContain("## Integration Runtime");
		expect(prompt).toContain(
			"GitHub: connected (tools: open_issue_pull_request, merge_issue_pull_request)",
		);
	});

	it("adds project context when a company and project are available", async () => {
		db.prepare(
			"INSERT INTO company_settings (id, name, slug) VALUES (?, ?, ?)",
		).run("company-1", "Acme Labs", "acme-labs");
		db.prepare(
			"INSERT INTO board_projects (id, company_id, name) VALUES (?, ?, ?)",
		).run("project-1", "company-1", "Phoenix");
		db.prepare(
			"INSERT INTO board_issues (id, project_id, status) VALUES (?, ?, ?)",
		).run("issue-a", "project-1", "in_progress");
		db.prepare(
			"INSERT INTO board_issues (id, project_id, status) VALUES (?, ?, ?)",
		).run("issue-b", "project-1", "done");

		const { buildSystemPrompt } = await loadPromptBuilder();
		const prompt = await buildSystemPrompt(
			makeAgent({ company_id: "company-1" }),
			makeIssue(),
			"Implement the next milestone.",
		);

		expect(prompt).toContain("## Company & Project Context");
		expect(prompt).toContain("Company: Acme Labs");
		expect(prompt).toContain("- Phoenix: 2 issues (1 active, 1 done)");
	});

	it("omits project context when no company context exists", async () => {
		const { buildSystemPrompt } = await loadPromptBuilder();
		const prompt = await buildSystemPrompt(
			makeAgent({ company_id: null }),
			null,
			"Handle the support request.",
		);

		expect(prompt).not.toContain("## Company & Project Context");
		expect(prompt).not.toContain("Company:");
	});

	it("injects matching project rules when a workspace is available", async () => {
		vi.resetModules();
		vi.doMock("@setra/db", () => ({
			getRawDb: () => db,
		}));
		vi.doMock("@setra/core/integrations.js", () => ({
			INTEGRATIONS: [{ id: "github", name: "GitHub" }],
			buildIntegrationContext: () => INTEGRATION_CONTEXT,
		}));
		vi.doMock("@setra/memory", () => ({
			MemoryStore: class {
				async init() {}
				async search() {
					return [];
				}
				async add() {
					return "memory-1";
				}
			},
		}));
		vi.doMock("@setra/mcp", () => ({
			getMcpManager: () => ({
				getAllStates: () => [],
			}),
		}));
		vi.doMock("../project-rules.js", () => ({
			loadProjectRules: async () => [
				{ name: "global.md", content: "# Global\n- Stay consistent" },
			],
			getMatchingRules: async () =>
				"## Project Rules\n\nThe following rules are defined for this project:\n\n### Global (always)\n# Global\n- Stay consistent",
		}));
		const { buildSystemPrompt } = await import("../prompt-builder.js");
		const prompt = await buildSystemPrompt(
			makeAgent({ company_id: "company-1" }),
			makeIssue({ workspacePath: "/repo" }),
			"Update src/api/users.ts",
		);

		expect(prompt).toContain("## Project Rules");
		expect(prompt).toContain("Stay consistent");
	});
});
