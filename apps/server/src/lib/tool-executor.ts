import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { IssuesService } from "@setra/application";
import { getRawDb } from "@setra/db";
import { mergePullRequest, openPullRequest } from "@setra/git/github";
import {
	SqliteIssuesRepository,
	requireTenantScope,
} from "@setra/infrastructure";
import { getMcpManager } from "@setra/mcp";
import * as agentsRepo from "../repositories/agents.repo.js";
import * as integrationsRepo from "../repositories/integrations.repo.js";
import * as issuesRepo from "../repositories/issues.repo.js";
import { domainEventBus } from "../sse/handler.js";
import { callAdapterTextOnce } from "./adapters/adapter-dispatch.js";
import { companyRequiresApproval } from "./approval-gates.js";
import { publishDelegationMessage } from "./company-broker.js";
import { addAutomationIssueComment } from "./issue-comments.js";
import { createLogger } from "./logger.js";
import { isCeoAgent, storeRuntimeMemory } from "./prompt-builder.js";
import { resolveAutoAdapter } from "./resolve-auto-adapter.js";
import type {
	AgentRow,
	IssueRow,
	LlmUsage,
	RuntimeKeys,
	ToolContext,
	ToolDefinition,
	ToolDefinitionInput,
	ToolExecutionInput,
	ToolExecutionResult,
	ToolSubIssueInput,
} from "./types.js";
import { isWebSearchEnabled, performWebSearch } from "./web-search.js";

const log = createLogger("tool-executor");
const toolIssuesService = new IssuesService(
	new SqliteIssuesRepository(),
	domainEventBus,
);

function normalizeIntegrationId(value: string): string {
	return value.trim().toLowerCase().replace(/_/g, "-");
}

function getCompanyIntegrations(companyId: string | null) {
	if (!companyId) return [];
	try {
		return integrationsRepo.listIntegrations(companyId);
	} catch {
		return [];
	}
}

function isActiveIntegration(status: string | null | undefined): boolean {
	const normalized = (status ?? "").trim().toLowerCase();
	return normalized === "connected" || normalized === "active";
}

function resolveGitHubIntegrationToken(
	companyId: string | null,
): string | null {
	const envToken = process.env.GITHUB_TOKEN?.trim();
	if (envToken) return envToken;
	const integration = getCompanyIntegrations(companyId).find(
		(row) => normalizeIntegrationId(row.type) === "github",
	);
	if (!integration || !integration.config) return null;
	for (const key of ["token", "accessToken", "githubToken", "pat", "apiKey"]) {
		const value = integration.config[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

export function emptyUsage(): LlmUsage {
	return {
		promptTokens: 0,
		completionTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
}

export function mergeUsage(
	total: LlmUsage,
	next: Partial<LlmUsage> | undefined,
): void {
	total.promptTokens += next?.promptTokens ?? 0;
	total.completionTokens += next?.completionTokens ?? 0;
	total.cacheReadTokens += next?.cacheReadTokens ?? 0;
	total.cacheWriteTokens =
		(total.cacheWriteTokens ?? 0) + (next?.cacheWriteTokens ?? 0);
}

export function safeParseJsonObject(
	raw: string | null | undefined,
): Record<string, unknown> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function resolveAgentPath(worktreePath: string, relPath: string): string {
	const sanitized = relPath.replace(/\.\./g, "").replace(/^\/+/, "");
	const abs = resolve(worktreePath, sanitized);
	if (!abs.startsWith(worktreePath)) {
		throw new Error("Path traversal not allowed");
	}
	return abs;
}

function normalizeSubIssuePriority(
	value: string | undefined,
): "none" | "urgent" | "high" | "medium" | "low" {
	switch ((value ?? "").toLowerCase()) {
		case "urgent":
		case "high":
		case "medium":
		case "low":
			return value!.toLowerCase() as "urgent" | "high" | "medium" | "low";
		default:
			return "none";
	}
}

function formatSubIssueDescription(
	description: string | undefined,
	estimatedComplexity: string | undefined,
): string {
	const parts = [
		typeof estimatedComplexity === "string" &&
		estimatedComplexity.trim().length > 0
			? `Estimated complexity: ${estimatedComplexity.trim()}`
			: null,
		typeof description === "string" && description.trim().length > 0
			? description.trim()
			: null,
	].filter((part): part is string => Boolean(part));
	return parts.join("\n\n");
}

async function createSubIssuesFromToolCall(input: {
	agent: AgentRow;
	companyId: string | null;
	parentIssue: IssueRow;
	subIssues: ToolSubIssueInput[];
}): Promise<{
	created: Array<{
		id: string;
		slug: string;
		title: string;
		priority: string;
		estimatedComplexity: string | null;
	}>;
}> {
	if (!input.companyId) {
		throw new Error("create_sub_issues requires a company-scoped issue");
	}
	const scope = requireTenantScope(input.companyId);
	const created: Array<{
		id: string;
		slug: string;
		title: string;
		priority: string;
		estimatedComplexity: string | null;
	}> = [];
	for (const subIssue of input.subIssues) {
		const title = subIssue.title?.trim();
		if (!title) continue;
		const priority = normalizeSubIssuePriority(subIssue.priority);
		const result = await toolIssuesService.createIssue(scope, {
			projectId: input.parentIssue.projectId,
			title,
			description: formatSubIssueDescription(
				subIssue.description,
				subIssue.estimatedComplexity,
			),
			priority,
			parentIssueId: input.parentIssue.id,
			status: "backlog",
		});
		if (!result.issue) continue;
		created.push({
			id: result.issue.id,
			slug: result.issue.slug,
			title: result.issue.title,
			priority,
			estimatedComplexity: subIssue.estimatedComplexity?.trim() || null,
		});
	}
	if (created.length > 0) {
		const now = new Date().toISOString();
		getRawDb()
			.prepare(
				`INSERT INTO activity_log (id, issue_id, company_id, actor, event, payload, reason, created_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				randomUUID(),
				input.parentIssue.id,
				input.companyId,
				input.agent.slug,
				"sub_issues_created",
				JSON.stringify({ created }),
				"Agent decomposed work into sub-issues",
				now,
			);
	}
	return { created };
}

function buildIntegrationTools(input: ToolDefinitionInput): ToolDefinition[] {
	const activeIntegrations = getCompanyIntegrations(input.companyId).filter(
		(integration) => isActiveIntegration(integration.status),
	);
	const hasGitHub = activeIntegrations.some(
		(integration) => normalizeIntegrationId(integration.type) === "github",
	);
	if (!hasGitHub || !input.issue) return [];
	return [
		{
			name: "open_issue_pull_request",
			description:
				"Open a GitHub pull request for the current issue using the connected GitHub integration.",
			inputSchema: {
				type: "object",
				properties: {
					title: { type: "string", description: "Pull request title" },
					body: {
						type: "string",
						description: "Pull request body in markdown",
					},
				},
				required: ["title", "body"],
			},
			kind: "builtin",
		},
		{
			name: "merge_issue_pull_request",
			description:
				"Merge the current issue's GitHub pull request using the connected GitHub integration.",
			inputSchema: { type: "object", properties: {} },
			kind: "builtin",
		},
	];
}

function sanitizeToolName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function extractSkillRefs(skillsRaw: string | null | undefined): string[] {
	if (!skillsRaw) return [];
	try {
		const parsed = JSON.parse(skillsRaw) as unknown;
		if (!Array.isArray(parsed)) return [];
		const refs = new Set<string>();
		for (const item of parsed) {
			if (typeof item === "string" && item.trim()) refs.add(item.trim());
			else if (item && typeof item === "object") {
				for (const key of ["id", "slug", "name", "tool"]) {
					const value = (item as Record<string, unknown>)[key];
					if (typeof value === "string" && value.trim()) refs.add(value.trim());
				}
			}
		}
		return [...refs];
	} catch {
		return [];
	}
}

function loadAssignedSkills(
	agent: AgentRow,
	companyId: string | null,
): Array<{
	id: string;
	name: string;
	slug: string;
	description: string | null;
	prompt: string | null;
}> {
	const refs = extractSkillRefs(agent.skills);
	if (refs.length === 0) return [];
	const rows = getRawDb()
		.prepare(
			`SELECT id, name, slug, description, prompt
   FROM skills
  WHERE is_active = 1
    AND (${companyId ? "company_id = ? OR company_id IS NULL" : "company_id IS NULL"})`,
		)
		.all(...(companyId ? [companyId] : [])) as Array<{
		id: string;
		name: string;
		slug: string;
		description: string | null;
		prompt: string | null;
	}>;
	const refSet = new Set(refs.map((ref) => ref.toLowerCase()));
	return rows.filter(
		(row) =>
			refSet.has(row.id.toLowerCase()) ||
			refSet.has(row.slug.toLowerCase()) ||
			refSet.has(row.name.toLowerCase()),
	);
}

export async function callMcpTool(
	companyId: string | null,
	serverId: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	const mcpMgr = getMcpManager(companyId);
	return mcpMgr.callTool(serverId, toolName, args);
}

export async function buildToolDefinitions(
	input: ToolDefinitionInput,
): Promise<ToolContext> {
	const memoryTools: ToolDefinition[] = [
		{
			name: "store_memory",
			description:
				"Store an important fact or decision in project memory for other agents to reference later.",
			inputSchema: {
				type: "object",
				properties: {
					key: {
						type: "string",
						description:
							"Short identifier for this memory (e.g., 'auth-approach', 'db-schema-v2')",
					},
					content: {
						type: "string",
						description: "The fact, decision, or context to remember",
					},
					tags: {
						type: "array",
						items: { type: "string" },
						description:
							"Optional tags to help future retrieval (e.g. ['auth', 'migration'])",
					},
				},
				required: ["key", "content"],
			},
			kind: "builtin",
		},
		{
			name: "post_issue_comment",
			description:
				"Post a comment on the current issue with your progress, decisions, or summary.",
			inputSchema: {
				type: "object",
				properties: {
					comment: {
						type: "string",
						description: "The comment text (markdown supported)",
					},
				},
				required: ["comment"],
			},
			kind: "builtin",
		},
		{
			name: "reassign_issue",
			description:
				"Use this when the task is outside your expertise or role. Reassigns the issue to a more suitable agent and resets it to todo.",
			inputSchema: {
				type: "object",
				properties: {
					reason: {
						type: "string",
						description:
							"Why you cannot handle this task (e.g., 'This is a business/financial task, not a technical one')",
					},
					suggested_role: {
						type: "string",
						description:
							"Which role should handle this (e.g., 'ceo', 'cto', 'designer')",
					},
				},
				required: ["reason"],
			},
			kind: "builtin",
		},
		{
			name: "delegate_to_agent",
			description:
				"Delegate a focused subtask to another agent through the company broker so they wake up with the requested context.",
			inputSchema: {
				type: "object",
				properties: {
					agent_slug: {
						type: "string",
						description: "Target agent slug to delegate to",
					},
					task: { type: "string", description: "The delegated task" },
					context: {
						type: "string",
						description: "Relevant context the target agent should see",
					},
				},
				required: ["agent_slug", "task", "context"],
			},
			kind: "builtin",
		},
	];
	const fileTools: ToolDefinition[] = [
		{
			name: "read_file",
			description:
				"Read the contents of a file at the given path (relative to project root).",
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Relative file path to read" },
				},
				required: ["path"],
			},
			kind: "builtin",
		},
		{
			name: "write_file",
			description:
				"Write content to a file at the given path (creates directories if needed). Use this to create or update files.",
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string", description: "Relative file path to write" },
					content: {
						type: "string",
						description: "Full file content to write",
					},
				},
				required: ["path", "content"],
			},
			kind: "builtin",
		},
		{
			name: "list_directory",
			description:
				"List files and directories at the given path (relative to project root).",
			inputSchema: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Relative directory path (use '.' for project root)",
					},
				},
				required: ["path"],
			},
			kind: "builtin",
		},
	];
	const ceoTools: ToolDefinition[] = isCeoAgent(input.agent)
		? ([
				...(input.issue
					? [
							{
								name: "create_sub_issues",
								description:
									"Create linked sub-issues for the current parent issue.",
								inputSchema: {
									type: "object",
									properties: {
										subIssues: {
											type: "array",
											items: {
												type: "object",
												properties: {
													title: { type: "string" },
													description: { type: "string" },
													priority: {
														type: "string",
														enum: ["none", "urgent", "high", "medium", "low"],
													},
													estimatedComplexity: { type: "string" },
												},
												required: [
													"title",
													"description",
													"priority",
													"estimatedComplexity",
												],
											},
										},
									},
									required: ["subIssues"],
								},
								kind: "builtin",
							},
						]
					: []),
				{
					name: "hire_agent",
					description:
						"Hire (create) a new AI agent on the team. Pick a template that matches the role needed. The agent will be available immediately for issue assignment.",
					inputSchema: {
						type: "object",
						properties: {
							displayName: {
								type: "string",
								description:
									"Human-readable name for the new agent, e.g. 'Frontend Dev', 'QA Engineer'",
							},
							templateId: {
								type: "string",
								description:
									"Template ID to base the agent on. Available templates: " +
									((
										agentsRepo.listTemplates() as Array<{
											id: string;
											name: string;
										}>
									)
										.map((template) => `${template.id} (${template.name})`)
										.join(", ") || "use any template ID from the catalog"),
							},
							systemPrompt: {
								type: "string",
								description:
									"Optional custom system prompt override. If not provided, uses the template default.",
							},
						},
						required: ["displayName", "templateId"],
					},
					kind: "builtin",
				},
			] as ToolDefinition[])
		: [];
	const webTools: ToolDefinition[] = isWebSearchEnabled(
		input.issue?.companyId ?? input.companyId,
	)
		? [
				{
					name: "web_search",
					description:
						"Search the web for current information. Use when you need up-to-date data, documentation, or facts that might not be in your training data.",
					inputSchema: {
						type: "object",
						properties: {
							query: {
								type: "string",
								description: "The search query",
							},
						},
						required: ["query"],
					},
					kind: "builtin",
				},
			]
		: [];
	const integrationTools = buildIntegrationTools(input);
	const mcpTools: ToolDefinition[] = [];
	try {
		const mcpMgr = getMcpManager(input.companyId);
		for (const state of mcpMgr.getAllStates()) {
			if (state.status !== "connected") continue;
			for (const tool of state.tools) {
				mcpTools.push({
					name: `mcp__${state.config.id}__${tool.name}`,
					description: `[${state.config.name}] ${tool.description}`,
					inputSchema: tool.inputSchema,
					kind: "mcp",
					serverId: state.config.id,
					actualName: tool.name,
				});
			}
		}
	} catch {
		/* MCP not available */
	}
	const skillTools = loadAssignedSkills(input.agent, input.companyId).map(
		(skill): ToolDefinition => ({
			name: sanitizeToolName(`skill__${skill.slug}`),
			description:
				skill.description ??
				`Execute the ${skill.name} skill for a focused sub-task using its stored prompt.`,
			inputSchema: {
				type: "object",
				properties: {
					request: {
						type: "string",
						description:
							"The specific sub-task or question to run through this skill.",
					},
				},
				required: ["request"],
			},
			kind: "skill",
			skill,
		}),
	);
	const tools = [
		...memoryTools,
		...fileTools,
		...webTools,
		...ceoTools,
		...integrationTools,
		...mcpTools,
		...skillTools,
	];
	return {
		tools,
		byName: new Map(tools.map((tool) => [tool.name, tool])),
	};
}

export async function executeToolCall(
	input: ToolExecutionInput,
): Promise<ToolExecutionResult> {
	const usage = emptyUsage();
	if (input.tool.name === "create_sub_issues" && input.issue) {
		let toolResult: {
			created: Array<{
				id: string;
				slug: string;
				title: string;
				priority: string;
				estimatedComplexity: string | null;
			}>;
		};
		try {
			toolResult = await createSubIssuesFromToolCall({
				agent: input.agent,
				companyId: input.issue.companyId,
				parentIssue: input.issue,
				subIssues: Array.isArray(input.args.subIssues)
					? (input.args.subIssues as ToolSubIssueInput[])
					: [],
			});
		} catch (error) {
			toolResult = { created: [] };
			log.warn("create_sub_issues failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return { content: JSON.stringify(toolResult), usage, costUsd: 0 };
	}
	if (input.tool.name === "store_memory") {
		const memKey = String(input.args.key ?? "note").trim() || "note";
		const memContent = String(input.args.content ?? "").trim();
		const memTags = Array.isArray(input.args.tags)
			? input.args.tags
					.filter((tag): tag is string => typeof tag === "string")
					.map((tag) => tag.trim())
					.filter(Boolean)
			: [];
		if (!memContent) {
			return {
				content: JSON.stringify({
					stored: false,
					error: "Memory content is required",
				}),
				usage,
				costUsd: 0,
			};
		}
		const stored = await storeRuntimeMemory({
			key: memKey,
			content: memContent,
			tags: memTags,
			source: "tool",
			agent: input.agent,
			issue: input.issue,
			runId: input.runId,
		});
		return {
			content: JSON.stringify({
				stored: true,
				key: memKey,
				memoryId: stored.memoryId,
				mirroredToTeamFeed: stored.mirrored,
			}),
			usage,
			costUsd: 0,
		};
	}
	if (input.tool.name === "open_issue_pull_request") {
		const companyId = input.issue?.companyId ?? input.companyId;
		if (!companyId || !input.issue) {
			return {
				content: JSON.stringify({
					error: "This tool requires a company-scoped issue context",
				}),
				usage,
				costUsd: 0,
			};
		}
		const issueRow = issuesRepo.loadIssueWithProject(input.issue.id, companyId);
		if (!issueRow) {
			return {
				content: JSON.stringify({ error: "Issue not found" }),
				usage,
				costUsd: 0,
			};
		}
		if (!issueRow.repoUrl || !issueRow.branchName) {
			return {
				content: JSON.stringify({
					error: "Issue must have a repository and branch before opening a PR",
				}),
				usage,
				costUsd: 0,
			};
		}
		const token = resolveGitHubIntegrationToken(companyId);
		if (!token) {
			return {
				content: JSON.stringify({
					error: "GitHub integration is not connected for this company",
				}),
				usage,
				costUsd: 0,
			};
		}
		try {
			const pr = await openPullRequest({
				repoUrl: issueRow.repoUrl,
				branch: issueRow.branchName,
				baseBranch: issueRow.defaultBranch ?? "main",
				title: String(input.args.title ?? issueRow.title),
				body: String(
					input.args.body ??
						`Automated PR for ${issueRow.slug}: ${issueRow.title}`,
				),
				token,
			});
			issuesRepo.updatePrOpened(issueRow.id, companyId, pr.url);
			issuesRepo.addActivityLog(
				issueRow.id,
				companyId,
				"agent",
				"pr_opened",
				JSON.stringify({ url: pr.url, stub: pr.stub, source: "tool" }),
			);
			addAutomationIssueComment(
				issueRow.id,
				companyId,
				`📤 Opened pull request: ${pr.url}`,
				input.agent.slug,
			);
			return {
				content: JSON.stringify({
					ok: true,
					prUrl: pr.url,
					prState: pr.state,
					stub: pr.stub,
				}),
				usage,
				costUsd: 0,
			};
		} catch (error) {
			return {
				content: JSON.stringify({
					error:
						error instanceof Error
							? error.message
							: "Failed to open pull request",
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.name === "merge_issue_pull_request") {
		const companyId = input.issue?.companyId ?? input.companyId;
		if (!companyId || !input.issue) {
			return {
				content: JSON.stringify({
					error: "This tool requires a company-scoped issue context",
				}),
				usage,
				costUsd: 0,
			};
		}
		if (companyRequiresApproval(companyId, "pr_merge")) {
			return {
				content: JSON.stringify({
					error: "PR merge requires human approval in the Approvals workflow",
				}),
				usage,
				costUsd: 0,
			};
		}
		const issueRow = issuesRepo.loadIssueWithProject(input.issue.id, companyId);
		if (!issueRow?.repoUrl || !issueRow.prUrl) {
			return {
				content: JSON.stringify({
					error: "Issue must have an open pull request before merging",
				}),
				usage,
				costUsd: 0,
			};
		}
		const token = resolveGitHubIntegrationToken(companyId);
		if (!token) {
			return {
				content: JSON.stringify({
					error: "GitHub integration is not connected for this company",
				}),
				usage,
				costUsd: 0,
			};
		}
		try {
			await mergePullRequest({
				repoUrl: issueRow.repoUrl,
				prUrl: issueRow.prUrl,
				token,
			});
			issuesRepo.updatePrMerged(issueRow.id, companyId);
			issuesRepo.addActivityLog(
				issueRow.id,
				companyId,
				"agent",
				"pr_merged",
				JSON.stringify({ source: "tool" }),
			);
			addAutomationIssueComment(
				issueRow.id,
				companyId,
				`🔀 Merged pull request: ${issueRow.prUrl}`,
				input.agent.slug,
			);
			return {
				content: JSON.stringify({ ok: true, prState: "merged" }),
				usage,
				costUsd: 0,
			};
		} catch (error) {
			return {
				content: JSON.stringify({
					error:
						error instanceof Error
							? error.message
							: "Failed to merge pull request",
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.name === "post_issue_comment" && input.issue) {
		const comment = String(input.args.comment ?? "");
		if (comment && input.issue.companyId) {
			try {
				addAutomationIssueComment(
					input.issue.id,
					input.issue.companyId,
					comment,
					input.agent.slug,
				);
			} catch {
				/* best-effort */
			}
		}
		return { content: JSON.stringify({ posted: true }), usage, costUsd: 0 };
	}
	if (input.tool.name === "reassign_issue" && input.issue) {
		const reason = String(input.args.reason ?? "Not within my expertise");
		const suggestedRole = String(input.args.suggested_role ?? "");
		try {
			const db = getRawDb();
			db.prepare(
				`UPDATE board_issues SET status = 'todo', assigned_agent_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
			).run(input.issue.id);
			addAutomationIssueComment(
				input.issue.id,
				input.issue.companyId,
				`🔄 **${input.agent.display_name}** reassigned this issue.\n\n**Reason:** ${reason}${suggestedRole ? `\n**Suggested role:** ${suggestedRole}` : ""}`,
				input.agent.slug,
			);
			db.prepare(`UPDATE runs SET outcome = 'reassigned' WHERE id = ?`).run(
				input.runId,
			);
		} catch {
			/* best-effort */
		}
		return {
			content: JSON.stringify({
				reassigned: true,
				reason,
				message: "Issue has been reset to todo for reassignment.",
			}),
			usage,
			costUsd: 0,
			stopLoop: true,
		};
	}
	if (input.tool.name === "delegate_to_agent") {
		const companyId = input.issue?.companyId ?? input.companyId;
		const agentSlug = String(input.args.agent_slug ?? "")
			.trim()
			.toLowerCase();
		const task = String(input.args.task ?? "").trim();
		const context = String(input.args.context ?? "").trim();
		if (!companyId || !agentSlug || !task || !context) {
			return {
				content: JSON.stringify({
					error: "company-scoped agent_slug, task, and context are required",
				}),
				usage,
				costUsd: 0,
			};
		}
		const target = agentsRepo.getAgentBySlugScoped(agentSlug, companyId);
		if (!target) {
			return {
				content: JSON.stringify({ error: `Agent '${agentSlug}' not found` }),
				usage,
				costUsd: 0,
			};
		}
		const message = publishDelegationMessage({
			companyId,
			fromAgent: input.agent.slug,
			targetAgent: agentSlug,
			task,
			context,
			issueId: input.issue?.id ?? null,
			runId: input.runId,
		});
		return {
			content: JSON.stringify({
				delegated: true,
				eventId: message.eventId,
				targetAgent: agentSlug,
				runId: message.runId,
			}),
			usage,
			costUsd: 0,
		};
	}
	if (input.tool.name === "hire_agent") {
		const displayName = String(input.args.displayName ?? "").trim();
		const templateId = String(input.args.templateId ?? "");
		const customPrompt = input.args.systemPrompt
			? String(input.args.systemPrompt)
			: null;
		try {
			const template = agentsRepo.getTemplate(templateId);
			if (!template) throw new Error(`Template '${templateId}' not found`);
			const baseSlug = displayName
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/(^-|-$)/g, "");
			const existingCount = agentsRepo.countAgentsWithSlugPrefix(
				baseSlug,
				input.issue?.companyId ?? input.agent.company_id ?? null,
			);
			const slug =
				existingCount > 0 ? `${baseSlug}-${existingCount + 1}` : baseSlug;
			const companyId =
				input.issue?.companyId ?? input.agent.company_id ?? null;
			const resolved = resolveAutoAdapter(
				"auto",
				template.model ?? null,
				companyId,
			);
			const row = agentsRepo.insertAgentRoster({
				slug,
				displayName,
				modelId: resolved.model,
				systemPrompt: customPrompt ?? template.system_prompt ?? null,
				adapterType: resolved.adapter ?? "auto",
				skills: template.tools ?? null,
				status: resolved.adapter === null ? "awaiting_key" : "idle",
				companyId,
				templateId,
				parentAgentId: input.agent.id ?? null,
			});
			try {
				const collabRepo = await import(
					"../repositories/collaboration.repo.js"
				);
				collabRepo.insertAutomatedReply({
					channelId: "general",
					reply: `🎉 Hired new team member: **${displayName}** (${template.name} template). They're ready for assignments!`,
					companyId,
					fromAgent: input.agent.slug,
				});
				const { emit } = await import("../sse/handler.js");
				emit("collab:message", { channel: "general", companyId });
				emit("roster:updated", { companyId });
			} catch {
				/* best-effort notification */
			}
			return {
				content: JSON.stringify({
					hired: true,
					agentId: row["id"],
					slug: row["slug"],
					displayName: row["display_name"],
					adapterType: row["adapter_type"],
					modelId: row["model_id"],
					status: row["status"],
				}),
				usage,
				costUsd: 0,
			};
		} catch (error) {
			log.warn("hire_agent failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return {
				content: JSON.stringify({
					error: `Failed to hire agent: ${error instanceof Error ? error.message : String(error)}`,
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.name === "read_file" && input.worktreePath) {
		const relPath = String(input.args.path ?? "");
		try {
			const absPath = resolveAgentPath(input.worktreePath, relPath);
			const content = readFileSync(absPath, "utf-8");
			return {
				content:
					content.length > 50_000
						? `${content.slice(0, 50_000)}\n...(truncated)`
						: content,
				usage,
				costUsd: 0,
			};
		} catch (error) {
			return {
				content: JSON.stringify({
					error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.name === "write_file" && input.worktreePath) {
		const relPath = String(input.args.path ?? "");
		const content = String(input.args.content ?? "");
		try {
			const absPath = resolveAgentPath(input.worktreePath, relPath);
			mkdirSync(dirname(absPath), { recursive: true });
			writeFileSync(absPath, content, "utf-8");
			return {
				content: JSON.stringify({
					written: true,
					path: relPath,
					bytes: content.length,
				}),
				usage,
				costUsd: 0,
			};
		} catch (error) {
			return {
				content: JSON.stringify({
					error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.name === "web_search") {
		const query = String(input.args.query ?? "").trim();
		if (!query) {
			return {
				content: JSON.stringify({ error: "query is required" }),
				usage,
				costUsd: 0,
			};
		}
		try {
			const companyId = input.issue?.companyId ?? input.companyId;
			const response = await performWebSearch(query, {
				companyId,
				maxResults: 5,
			});
			return {
				content: JSON.stringify({ query, ...response }),
				usage,
				costUsd: 0,
			};
		} catch (error) {
			return {
				content: JSON.stringify({
					error: error instanceof Error ? error.message : "Web search failed",
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.name === "list_directory" && input.worktreePath) {
		const relPath = String(input.args.path ?? ".");
		try {
			const absPath = resolveAgentPath(input.worktreePath, relPath);
			if (!existsSync(absPath)) {
				return {
					content: JSON.stringify({ error: "Directory does not exist" }),
					usage,
					costUsd: 0,
				};
			}
			const entries = readdirSync(absPath).map((name) => {
				try {
					const stat = statSync(join(absPath, name));
					return {
						name,
						type: stat.isDirectory() ? "directory" : "file",
						size: stat.size,
					};
				} catch {
					return { name, type: "unknown", size: 0 };
				}
			});
			return { content: JSON.stringify(entries), usage, costUsd: 0 };
		} catch (error) {
			return {
				content: JSON.stringify({
					error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (
		input.tool.kind === "mcp" &&
		input.tool.serverId &&
		input.tool.actualName
	) {
		try {
			const mcpResult = await callMcpTool(
				input.companyId,
				input.tool.serverId,
				input.tool.actualName,
				input.args,
			);
			if (
				mcpResult &&
				typeof mcpResult === "object" &&
				"content" in (mcpResult as Record<string, unknown>)
			) {
				const content = (mcpResult as { content: Array<{ text?: string }> })
					.content;
				return {
					content: Array.isArray(content)
						? content.map((entry) => entry.text ?? "").join("\n")
						: JSON.stringify(mcpResult),
					usage,
					costUsd: 0,
				};
			}
			return { content: JSON.stringify(mcpResult), usage, costUsd: 0 };
		} catch (error) {
			return {
				content: JSON.stringify({
					error:
						error instanceof Error ? error.message : "MCP tool call failed",
				}),
				usage,
				costUsd: 0,
			};
		}
	}
	if (input.tool.kind === "skill" && input.tool.skill) {
		const request = String(input.args.request ?? "").trim();
		const skillPrompt = input.tool.skill.prompt?.trim();
		if (!request || !skillPrompt) {
			return {
				content: JSON.stringify({ error: "Skill prompt or request missing" }),
				usage,
				costUsd: 0,
			};
		}
		const skillResult = await callAdapterTextOnce({
			adapterId: input.adapterId,
			model: input.model,
			systemPrompt: `${input.systemPrompt}\n\n## Skill Execution\nYou are executing the skill "${input.tool.skill.name}". Follow the skill instructions below precisely and return only the result for the requested sub-task.\n\n${skillPrompt}`,
			task: request,
			runtimeKeys: input.runtimeKeys,
			maxTokens: 2048,
		});
		mergeUsage(usage, skillResult.usage);
		return {
			content: skillResult.content,
			usage,
			costUsd: skillResult.costUsd,
		};
	}
	return {
		content: JSON.stringify({ error: "Unsupported tool call" }),
		usage,
		costUsd: 0,
	};
}
