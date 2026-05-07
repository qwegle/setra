#!/usr/bin/env node
/**
 * setra CLI entry point
 *
 * Two modes:
 *   - Fire-and-forget: setra run, setra mark, setra status (instant commands)
 *   - TUI: setra tui (launches the full Ink interface)
 */

import { Command } from "commander";
import { render } from "ink";
import React from "react";

const program = new Command();

program
	.name("setra")
	.description("Run AI coding agents anywhere, remember everything.")
	.version("0.1.0")
	// Global verbose flag
	.option("-v, --verbose", "verbose output");

// ─────────────────────────────────────────────────────────────────────────────
// setra tui — launch the full Ink TUI
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("tui")
	.description("Launch the interactive TUI")
	.action(async () => {
		const { SetraTUI } = await import("./tui/SetraTUI.js");
		const { waitUntilExit } = render(React.createElement(SetraTUI));
		await waitUntilExit();
	});

// ─────────────────────────────────────────────────────────────────────────────
// setra status — show running plots and active runs
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("status")
	.description("Show status of all active plots and runs")
	.action(async () => {
		const { statusCommand } = await import("./commands/status.js");
		await statusCommand();
	});

// ─────────────────────────────────────────────────────────────────────────────
// setra new — create a new plot
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("new")
	.description("Create a new plot in the current git repo")
	.argument("<name>", "plot name")
	.option(
		"-a, --agent <agent>",
		"agent to use (claude, codex, gemini)",
		"claude",
	)
	.option("-d, --description <text>", "plot description")
	.action(
		async (name: string, opts: { agent: string; description?: string }) => {
			const { newPlotCommand } = await import("./commands/new-plot.js");
			await newPlotCommand({
				name,
				agent: opts.agent,
				description: opts.description,
			});
		},
	);

// ─────────────────────────────────────────────────────────────────────────────
// setra run — start an agent run in the current plot
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("run")
	.description("Start an agent run in the current or specified plot")
	.option(
		"-p, --plot <plotId>",
		"plot ID (defaults to most recent active plot)",
	)
	.option("-a, --agent <agent>", "agent to use", "claude")
	.option(
		"--no-tmux",
		"skip tmux session (not recommended — loses persistence)",
	)
	.action(async (opts: { plot?: string; agent: string; tmux: boolean }) => {
		const { runCommand } = await import("./commands/run.js");
		await runCommand({
			plotId: opts.plot,
			agent: opts.agent,
			useTmux: opts.tmux,
		});
	});

// ─────────────────────────────────────────────────────────────────────────────
// setra mark — create a git checkpoint commit
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("mark")
	.description("Create a manual checkpoint commit (a mark) in the current plot")
	.option("-m, --message <msg>", "commit message")
	.option("-p, --plot <plotId>", "plot ID")
	.action(async (opts: { message?: string; plot?: string }) => {
		const { markCommand } = await import("./commands/mark.js");
		await markCommand({ message: opts.message, plotId: opts.plot });
	});

// ─────────────────────────────────────────────────────────────────────────────
// setra trace search — search past run memory
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("trace")
	.description("Search and view past run traces (memory)")
	.command("search")
	.argument("<query>", "search query")
	.option("-n, --top <k>", "number of results", "5")
	.option("--limit <n>", "max results (alias for --top)")
	.option("--min-score <s>", "minimum similarity score 0-1", "0.3")
	.action(
		async (
			query: string,
			opts: { top: string; limit?: string; minScore: string },
		) => {
			const { memorySearchCommand } = await import("./commands/trace.js");
			await memorySearchCommand(query, {
				limit: Number.parseInt(opts.limit ?? opts.top, 10),
				minScore: Number.parseFloat(opts.minScore),
			});
		},
	);

// ─────────────────────────────────────────────────────────────────────────────
// setra ledger — view cost breakdown
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("ledger")
	.description("Show cost and token usage breakdown")
	.option("--json", "output as JSON")
	.action(async (opts: { json: boolean }) => {
		const { ledgerCommand } = await import("./commands/ledger.js");
		await ledgerCommand({ json: opts.json });
	});

// ─────────────────────────────────────────────────────────────────────────────
// setra init — initialise setra in the current git repo
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("init")
	.description("Initialise setra in the current git repository")
	.action(async () => {
		const { initCommand } = await import("./commands/init.js");
		await initCommand();
	});

// ─────────────────────────────────────────────────────────────────────────────
// setra connect — connect to a remote ground (SSH machine)
// ─────────────────────────────────────────────────────────────────────────────

program
	.command("connect")
	.description("Connect to a remote ground (SSH machine)")
	.argument("<host>", "hostname or IP address")
	.option(
		"-u, --user <username>",
		"SSH username",
		process.env["USER"] ?? "ubuntu",
	)
	.option("-p, --port <port>", "SSH port", "22")
	.option("--key <keyPath>", "path to private key")
	.action(
		async (
			host: string,
			opts: { user: string; port: string; key?: string },
		) => {
			const { connectCommand } = await import("./commands/connect.js");
			await connectCommand({
				host,
				username: opts.user,
				port: Number.parseInt(opts.port, 10),
				keyPath: opts.key,
			});
		},
	);

// ─── setra governance ─────────────────────────────────────────────────────────
const govCmd = program
	.command("governance")
	.description(
		"Governance & compliance: deployment mode, model policy, audit log",
	);

govCmd
	.command("status")
	.description("Show current governance policy")
	.action(async () => {
		const { runGovernanceStatus } = await import("./commands/governance.js");
		await runGovernanceStatus();
	});

govCmd
	.command("set-mode <mode>")
	.description("Set deployment mode: cloud | hybrid | offline")
	.action(async (mode: string) => {
		const { runGovernanceSetMode } = await import("./commands/governance.js");
		await runGovernanceSetMode(mode);
	});

govCmd
	.command("audit")
	.description("Tail last 50 audit log entries")
	.action(async () => {
		const { runGovernanceAudit } = await import("./commands/governance.js");
		await runGovernanceAudit();
	});

govCmd
	.command("check <model>")
	.description("Validate whether a model is allowed by the current policy")
	.action(async (model: string) => {
		const { runGovernanceCheck } = await import("./commands/governance.js");
		await runGovernanceCheck(model);
	});

// ─── setra team ───────────────────────────────────────────────────────────────
const teamCmd = program
	.command("team")
	.description("Multi-agent team: run, status, stop, list");

teamCmd
	.command("run <companyJson>")
	.description("Start a multi-agent team from a company.json file")
	.option("--tui", "open TUI after launch")
	.action(async (companyJson: string, opts: { tui?: boolean }) => {
		const { runTeamRun } = await import("./commands/team.js");
		await runTeamRun(companyJson, opts);
	});

teamCmd
	.command("status")
	.description("Show running team agents")
	.action(async () => {
		const { runTeamStatus } = await import("./commands/team.js");
		await runTeamStatus();
	});

teamCmd
	.command("prompt")
	.description(
		"Launch multiple agents in parallel from a single prompt (no company.json)",
	)
	.requiredOption("-t, --task <text>", "task prompt for all agents")
	.requiredOption(
		"-a, --agents <names>",
		"comma-separated agent names (e.g. cto,designer,developer)",
	)
	.option("-b, --budget <usd>", "total USD budget split across agents")
	.option("--tui", "open TUI after launch")
	.action(
		async (opts: {
			task: string;
			agents: string;
			budget?: string;
			tui?: boolean;
		}) => {
			const { runTeamPrompt } = await import("./commands/team.js");
			await runTeamPrompt({
				task: opts.task,
				agents: opts.agents,
				budget:
					typeof opts.budget === "string"
						? Number.parseFloat(opts.budget)
						: undefined,
				tui: opts.tui,
			});
		},
	);

// ─── setra serve ─────────────────────────────────────────────────────────────
program
	.command("serve")
	.description("Start the setra daemon (HTTP + WebSocket server)")
	.option("--port <n>", "TCP port", "7820")
	.option("--name <label>", "instance label", "")
	.option("--socket <path>", "Unix socket path (overrides port)")
	.action(async (opts: { port: string; name: string; socket?: string }) => {
		const { runServe } = await import("./commands/serve.js");
		await runServe(opts);
	});

// ─── setra models ────────────────────────────────────────────────────────────
const modelsCmd = program
	.command("models")
	.description("Manage local SLMs via Ollama (install, pull, list, remove)");

modelsCmd
	.command("list")
	.description("Show installed local models")
	.action(async () => {
		const { runModelsList } = await import("./commands/models.js");
		await runModelsList();
	});

const modelsInstallCmd = modelsCmd
	.command("install")
	.description("Install a runtime or model");

modelsInstallCmd
	.command("ollama")
	.description("Install the Ollama runtime")
	.action(async () => {
		const { runModelsInstallOllama } = await import("./commands/models.js");
		await runModelsInstallOllama();
	});

modelsCmd
	.command("pull <name>")
	.description("Pull (download) a model with live progress")
	.action(async (name: string) => {
		const { runModelsPull } = await import("./commands/models.js");
		await runModelsPull(name);
	});

modelsCmd
	.command("rm <name>")
	.description("Remove an installed model")
	.action(async (name: string) => {
		const { runModelsRm } = await import("./commands/models.js");
		await runModelsRm(name);
	});

modelsCmd
	.command("recommend")
	.description("Show recommended models for offline / governance use")
	.action(async () => {
		const { runModelsRecommend } = await import("./commands/models.js");
		await runModelsRecommend();
	});

// ─── setra pr ────────────────────────────────────────────────────────────────
const prCmd = program
	.command("pr")
	.description("PR review workflow: list, diff, and review pull requests");

prCmd
	.command("list")
	.description("List open pull requests in the current or specified repo")
	.option("--repo <owner/repo>", "repository (defaults to git remote origin)")
	.option("--token <token>", "GitHub personal access token")
	.action(async (opts: { repo?: string; token?: string }) => {
		const { prListCommand } = await import("./commands/pr.js");
		await prListCommand(opts);
	});

prCmd
	.command("diff <pr-number>")
	.description("Show the diff of a pull request in the terminal")
	.option("--repo <owner/repo>", "repository (defaults to git remote origin)")
	.option("--token <token>", "GitHub personal access token")
	.action(async (prNumber: string, opts: { repo?: string; token?: string }) => {
		const { prDiffCommand } = await import("./commands/pr.js");
		await prDiffCommand(Number.parseInt(prNumber, 10), opts);
	});

prCmd
	.command("review <pr-number>")
	.description("Start a review agent session for a pull request")
	.option("--repo <owner/repo>", "repository (defaults to git remote origin)")
	.option("--token <token>", "GitHub personal access token")
	.action(async (prNumber: string, opts: { repo?: string; token?: string }) => {
		const { prReviewCommand } = await import("./commands/pr.js");
		await prReviewCommand(Number.parseInt(prNumber, 10), opts);
	});

// ─── setra security-tools ─────────────────────────────────────────────────────
const securityToolsCmd = program
	.command("security-tools")
	.description(
		"Sentinel Tool Installer — install and check security tools (nmap, nuclei, ffuf, …)",
	);

securityToolsCmd
	.command("list")
	.description("Show all security tools and their install status")
	.action(async () => {
		const { runSecurityToolsList } = await import(
			"./commands/security-tools.js"
		);
		await runSecurityToolsList();
	});

securityToolsCmd
	.command("install <tool>")
	.description("Install a specific security tool (e.g. nmap, nuclei, ffuf)")
	.action(async (tool: string) => {
		const { runSecurityToolsInstall } = await import(
			"./commands/security-tools.js"
		);
		await runSecurityToolsInstall(tool);
	});

securityToolsCmd
	.command("install-all")
	.description("Install all missing security tools sequentially")
	.action(async () => {
		const { runSecurityToolsInstallAll } = await import(
			"./commands/security-tools.js"
		);
		await runSecurityToolsInstallAll();
	});

securityToolsCmd
	.command("check <tool>")
	.description("Check if a specific tool is installed")
	.action(async (tool: string) => {
		const { runSecurityToolsCheck } = await import(
			"./commands/security-tools.js"
		);
		await runSecurityToolsCheck(tool);
	});

// ─── setra wiki ───────────────────────────────────────────────────────────────
const wikiCmd = program
	.command("wiki")
	.description("Team wiki — read and write shared knowledge articles");

wikiCmd
	.command("list")
	.description("List all wiki articles")
	.option(
		"--section <section>",
		"Filter by section: people, projects, decisions, runbooks, leads",
	)
	.action(async (opts: { section?: string }) => {
		const { runWikiList } = await import("./commands/wiki.js");
		await runWikiList(opts);
	});

wikiCmd
	.command("read <slug>")
	.description("Read a wiki article by slug")
	.action(async (slug: string) => {
		const { runWikiRead } = await import("./commands/wiki.js");
		await runWikiRead(slug);
	});

wikiCmd
	.command("write <slug>")
	.description("Create or update a wiki article")
	.option("--content <content>", "Markdown content (use \\n for newlines)")
	.action(async (slug: string, opts: { content: string }) => {
		const { runWikiWrite } = await import("./commands/wiki.js");
		await runWikiWrite(slug, opts);
	});

wikiCmd
	.command("search <query>")
	.description("Search wiki articles by keyword")
	.action(async (query: string) => {
		const { runWikiSearch } = await import("./commands/wiki.js");
		await runWikiSearch(query);
	});

wikiCmd
	.command("toc")
	.description("Show the full table of contents")
	.action(async () => {
		const { runWikiToc } = await import("./commands/wiki.js");
		await runWikiToc();
	});

// ─── setra kanban ─────────────────────────────────────────────────────────────
const kanbanCmd = program
	.command("kanban")
	.description("Kanban board — create and move cards across columns");

kanbanCmd
	.command("list")
	.description("List all kanban boards")
	.action(async () => {
		const { runKanbanList } = await import("./commands/kanban.js");
		runKanbanList();
	});

kanbanCmd
	.command("board <boardId>")
	.description("Show full board with all columns and cards")
	.action(async (boardId: string) => {
		const { runKanbanBoard } = await import("./commands/kanban.js");
		runKanbanBoard(boardId);
	});

kanbanCmd
	.command("add-card <boardId>")
	.description("Add a card to a board")
	.option("--title <title>", "Card title (required)")
	.option(
		"--priority <priority>",
		"Priority: critical, high, medium, low (default: medium)",
	)
	.option("--ref <ref>", "External reference, e.g. JIRA-123")
	.option("--column <column>", "Column name (default: Backlog)")
	.option("--assignee <assignee>", "Assignee agent slug")
	.action(
		async (
			boardId: string,
			opts: {
				title: string;
				priority?: string;
				ref?: string;
				column?: string;
				assignee?: string;
			},
		) => {
			const { runKanbanAddCard } = await import("./commands/kanban.js");
			runKanbanAddCard(boardId, opts);
		},
	);

kanbanCmd
	.command("move <cardId>")
	.description("Move a card to a different column")
	.option("--to <column>", "Target column name (required)")
	.action(async (cardId: string, opts: { to: string }) => {
		const { runKanbanMove } = await import("./commands/kanban.js");
		runKanbanMove(cardId, opts);
	});

// ─── setra chat ───────────────────────────────────────────────────────────────
program
	.command("chat")
	.description("Interactive chat with an agent")
	.option("-a, --agent <name>", "agent to chat with", "ceo")
	.option("-p, --project <id>", "project context")
	.action(async (opts: { agent: string; project?: string }) => {
		const { chatCommand } = await import("./commands/chat.js");
		await chatCommand(opts);
	});

// ─── setra vault ──────────────────────────────────────────────────────────────
const vaultCmd = program.command("vault").description("Manage secrets vault");

vaultCmd
	.command("list")
	.description("List secret names")
	.option("-p, --project <id>", "project scope")
	.option("--reveal", "show secret values")
	.action(async (opts: { project?: string; reveal?: boolean }) => {
		const { vaultListCommand } = await import("./commands/vault.js");
		await vaultListCommand(opts);
	});

vaultCmd
	.command("set <key> <value>")
	.description("Set a secret value")
	.option("-p, --project <id>", "project scope")
	.action(async (key: string, value: string, opts: { project?: string }) => {
		const { vaultSetCommand } = await import("./commands/vault.js");
		await vaultSetCommand(key, value, opts);
	});

vaultCmd
	.command("get <key>")
	.description("Get a secret value")
	.option("-p, --project <id>", "project scope")
	.option("--reveal", "show the raw value")
	.action(async (key: string, opts: { project?: string; reveal?: boolean }) => {
		const { vaultGetCommand } = await import("./commands/vault.js");
		await vaultGetCommand(key, opts);
	});

vaultCmd
	.command("delete <key>")
	.description("Delete a secret")
	.option("-p, --project <id>", "project scope")
	.action(async (key: string, opts: { project?: string }) => {
		const { vaultDeleteCommand } = await import("./commands/vault.js");
		await vaultDeleteCommand(key, opts);
	});

// ─── setra dispatch ───────────────────────────────────────────────────────────
program
	.command("dispatch")
	.description("Dispatch a task to the multi-agent team")
	.argument("<task>", "task description")
	.option("-a, --agents <names>", "comma-separated agent names")
	.option("-b, --budget <usd>", "budget limit in USD")
	.action(async (task: string, opts: { agents?: string; budget?: string }) => {
		const { dispatchCommand } = await import("./commands/dispatch.js");
		await dispatchCommand(task, opts);
	});

// ─── setra activity ───────────────────────────────────────────────────────────
program
	.command("activity")
	.description("Show recent activity feed")
	.option("-n, --limit <n>", "number of entries", "20")
	.option("--since <date>", "show activity since date (ISO)")
	.action(async (opts: { limit: string; since?: string }) => {
		const { activityCommand } = await import("./commands/activity.js");
		await activityCommand(opts);
	});

// ─── setra deploy ─────────────────────────────────────────────────────────────
program
	.command("deploy")
	.description("Deploy the current project")
	.option("--env <environment>", "target environment", "production")
	.option("-p, --project <id>", "project ID")
	.action(async (opts: { env: string; project?: string }) => {
		const { deployCommand } = await import("./commands/deploy.js");
		await deployCommand(opts);
	});

// ─── setra diff — review pending sandbox changes ─────────────────────────────
program
	.command("diff")
	.description("Review pending agent changes in sandbox")
	.option("--run-id <id>", "specific run ID to review")
	.option("--apply", "apply all pending changes")
	.option("--reject", "reject all pending changes")
	.action(
		async (opts: { runId?: string; apply?: boolean; reject?: boolean }) => {
			const { diffCommand } = await import("./commands/diff.js");
			await diffCommand(opts);
		},
	);

// ─── setra log — plan history ────────────────────────────────────────────────
program
	.command("log")
	.description("Show plan execution history")
	.option("-n, --limit <n>", "number of entries to show", "50")
	.option("--run <id>", "filter by run ID prefix")
	.action(async (opts: { limit: string; run?: string }) => {
		const { logCommand } = await import("./commands/log.js");
		await logCommand(opts);
	});

// ─────────────────────────────────────────────────────────────────────────────
// Parse and run
// ─────────────────────────────────────────────────────────────────────────────

// Show help if no subcommand is given
if (process.argv.length <= 2) {
	program.help();
}

program.parseAsync(process.argv).catch((err: unknown) => {
	console.error("Error:", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
