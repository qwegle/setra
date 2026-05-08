import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	INTEGRATIONS,
	buildIntegrationContext,
} from "@setra/core/integrations.js";
import { getRawDb } from "@setra/db";
import { getMcpManager } from "@setra/mcp";
import { MemoryStore } from "@setra/memory";
import * as integrationsRepo from "../repositories/integrations.repo.js";
import { getAgentExperience } from "./agent-reflection.js";
import { getAgentScore } from "./credibility.js";
import { createLogger } from "./logger.js";
import { getMatchingRules, loadProjectRules } from "./project-rules.js";
import { rawSqlite } from "../db/client.js";
import type { AgentRow, IssueRow } from "./types.js";

const log = createLogger("prompt-builder");
const runtimeMemoryStores = new Map<string, Promise<MemoryStore>>();

function normalizeIntegrationId(value: string): string {
	return value.trim().toLowerCase().replace(/_/g, "-");
}

function getMemoryDbPath(companyId: string | null): string {
	const dataDir = process.env.SETRA_DATA_DIR ?? join(homedir(), ".setra");
	return join(dataDir, "memory", `${companyId ?? "global"}.db`);
}

async function getRuntimeMemoryStore(
	companyId: string | null,
): Promise<MemoryStore | null> {
	const key = companyId ?? "global";
	let pending = runtimeMemoryStores.get(key);
	if (!pending) {
		const store = new MemoryStore({ dbPath: getMemoryDbPath(companyId) });
		pending = store.init().then(() => store);
		runtimeMemoryStores.set(key, pending);
	}
	try {
		return await pending;
	} catch (error) {
		runtimeMemoryStores.delete(key);
		log.warn("memory store unavailable", {
			companyId: key,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

function isActiveIntegration(status: string | null | undefined): boolean {
	const normalized = (status ?? "").trim().toLowerCase();
	return normalized === "connected" || normalized === "active";
}

function getCompanyIntegrations(companyId: string | null) {
	if (!companyId) return [];
	try {
		return integrationsRepo.listIntegrations(companyId);
	} catch {
		return [];
	}
}

function getIntegrationToolNames(type: string): string[] {
	switch (normalizeIntegrationId(type)) {
		case "github":
			return ["open_issue_pull_request", "merge_issue_pull_request"];
		default:
			return [];
	}
}

function buildCompanyIntegrationSection(companyId: string | null): string {
	const active = getCompanyIntegrations(companyId).filter((integration) =>
		isActiveIntegration(integration.status),
	);
	if (active.length === 0) return "";
	const definitions = new Map(
		INTEGRATIONS.map((integration) => [
			normalizeIntegrationId(integration.id),
			integration,
		]),
	);
	const context = buildIntegrationContext(
		active.map((integration) => normalizeIntegrationId(integration.type)),
	);
	const runtimeLines = active.map((integration) => {
		const normalizedType = normalizeIntegrationId(integration.type);
		const definition = definitions.get(normalizedType);
		const toolNames = getIntegrationToolNames(normalizedType);
		return `- ${definition?.name ?? integration.name}: ${integration.status ?? "configured"}${toolNames.length > 0 ? ` (tools: ${toolNames.join(", ")})` : ""}`;
	});
	return `${context}\n\n## Integration Runtime\n${runtimeLines.join("\n")}`;
}

function buildMemoryQuery(
	agent: AgentRow,
	issue: IssueRow | null,
	task: string,
): string {
	return [
		agent.display_name,
		agent.slug,
		issue?.title,
		issue?.description,
		task,
	]
		.filter(
			(value): value is string =>
				typeof value === "string" && value.trim().length > 0,
		)
		.join("\n")
		.slice(0, 4000);
}

async function buildSemanticMemorySection(
	agent: AgentRow,
	issue: IssueRow | null,
	task: string,
): Promise<string> {
	const companyId = issue?.companyId ?? agent.company_id ?? null;
	const store = await getRuntimeMemoryStore(companyId);
	if (!store) return "";
	const query = buildMemoryQuery(agent, issue, task);
	if (!query) return "";
	try {
		const results = await store.search(query, {
			limit: 6,
			minScore: 0.35,
			...(issue?.projectId ? { plotId: issue.projectId } : {}),
		});
		if (results.length === 0) return "";
		const entries = results.map(({ entry, score }) => {
			const metadata = entry.metadata as Record<string, unknown>;
			const key =
				typeof metadata.key === "string" && metadata.key.trim().length > 0
					? `${metadata.key}: `
					: "";
			const tags = Array.isArray(metadata.tags)
				? metadata.tags.filter((tag): tag is string => typeof tag === "string")
				: [];
			return `- [score ${score.toFixed(2)}${tags.length > 0 ? `; tags: ${tags.join(", ")}` : ""}] ${key}${entry.content}`;
		});
		return `\n\n## Semantic Memory\nRelevant memories from previous runs:\n${entries.join("\n")}`;
	} catch (error) {
		log.warn("memory search failed", {
			companyId: companyId ?? "global",
			error: error instanceof Error ? error.message : String(error),
		});
		return "";
	}
}

export async function storeRuntimeMemory(input: {
	key: string;
	content: string;
	tags?: string[];
	source: "tool" | "run-summary";
	agent: AgentRow;
	issue: IssueRow | null;
	runId: string;
}): Promise<{ memoryId: string | null; mirrored: boolean }> {
	const companyId = input.issue?.companyId ?? input.agent.company_id ?? null;
	const projectId = input.issue?.projectId ?? null;
	const tags = [
		...(input.tags ?? []),
		input.source,
		input.agent.slug,
		...(projectId ? [`project:${projectId}`] : []),
	].filter(
		(tag, index, values) => Boolean(tag) && values.indexOf(tag) === index,
	);
	let memoryId: string | null = null;
	const store = await getRuntimeMemoryStore(companyId);
	if (store) {
		memoryId = await store.add(
			input.content,
			{
				key: input.key,
				companyId,
				projectId,
				agentId: input.agent.id,
				agentSlug: input.agent.slug,
				timestamp: new Date().toISOString(),
				source: input.source,
				tags,
			},
			{
				sessionId: input.runId,
				...(projectId ? { plotId: projectId } : {}),
				agentId: input.agent.id,
			},
		);
	}
	let mirrored = false;
	if (companyId) {
		try {
			getRawDb()
				.prepare(
					`INSERT INTO team_messages (id, company_id, channel, from_agent, content, message_type, sequence, created_at)
 VALUES (?, ?, 'memory', ?, ?, 'memory', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
				)
				.run(
					randomUUID(),
					companyId,
					input.agent.slug,
					JSON.stringify({
						key: input.key,
						content: input.content,
						tags,
						memoryId,
						source: input.source,
					}),
				);
			mirrored = true;
		} catch {
			/* keep semantic memory even if legacy mirror fails */
		}
	}
	return { memoryId, mirrored };
}

export function buildRunSummaryMemory(input: {
	agent: AgentRow;
	issue: IssueRow | null;
	task: string;
	content: string;
}): { key: string; content: string; tags: string[] } | null {
	const trimmed = input.content.trim();
	if (trimmed.length < 80) return null;
	const subject = input.issue
		? `${input.issue.slug}: ${input.issue.title}`
		: input.task.trim().slice(0, 120) || input.agent.slug;
	return {
		key: input.issue?.slug ?? `${input.agent.slug}-run-summary`,
		content: `Outcome for ${subject} — ${trimmed.replace(/\s+/g, " ").slice(0, 900)}`,
		tags: ["run-summary", input.agent.slug],
	};
}

export function isCeoAgent(agent: AgentRow): boolean {
	return (
		agent.slug === "ceo" ||
		agent.slug.startsWith("ceo-") ||
		agent.display_name.trim().toLowerCase() === "ceo"
	);
}

export function isCtoAgent(agent: AgentRow): boolean {
	const displayName = agent.display_name.trim().toLowerCase();
	return (
		agent.slug === "cto" ||
		agent.slug.startsWith("cto-") ||
		displayName === "cto" ||
		displayName.includes("chief technology officer")
	);
}

export function isDevAgent(agent: AgentRow): boolean {
	if (isCeoAgent(agent) || isCtoAgent(agent)) return false;
	const identity = `${agent.slug} ${agent.display_name}`.toLowerCase();
	return [
		"dev",
		"developer",
		"engineer",
		"frontend",
		"backend",
		"fullstack",
		"full-stack",
		"coder",
	].some((token) => identity.includes(token));
}

function isComplexIssueTask(issue: IssueRow | null, task: string): boolean {
	const text =
		`${issue?.title ?? ""}\n${issue?.description ?? ""}\n${task}`.toLowerCase();
	const complexitySignals = [
		"feature",
		"multi",
		"workflow",
		"architecture",
		"system",
		"dashboard",
		"approval",
		"dispatch",
		"plan",
		"subtask",
		"integration",
		"refactor",
		"monorepo",
		"api",
		"ui",
	];
	const signalCount = complexitySignals.filter((signal) =>
		text.includes(signal),
	).length;
	const wordCount = text.split(/\s+/).filter(Boolean).length;
	const lineCount = text
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0).length;
	return signalCount >= 2 || wordCount >= 120 || lineCount >= 8;
}

function extractReferencedFilePaths(
	issue: IssueRow | null,
	task: string,
): string[] {
	const text = `${issue?.title ?? ""}\n${issue?.description ?? ""}\n${task}`;
	const matches =
		text.match(
			/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html)/g,
		) ?? [];
	return [
		...new Set(
			matches
				.map((match) => match.replace(/^`|`$/g, "").trim())
				.filter(Boolean),
		),
	];
}

async function buildProjectRulesSection(
	issue: IssueRow | null,
	task: string,
): Promise<string> {
	const projectPath = issue?.workspacePath?.trim();
	if (!projectPath) return "";
	try {
		const rules = await loadProjectRules(projectPath);
		if (rules.length === 0) return "";
		return await getMatchingRules(
			rules,
			extractReferencedFilePaths(issue, task),
		);
	} catch (error) {
		log.warn("project rules unavailable", {
			projectPath,
			error: error instanceof Error ? error.message : String(error),
		});
		return "";
	}
}

/**
 * Auto-select relevant skills based on agent role and task content.
 * Skills are matched by keyword triggers against the task description.
 * Agent role (frontend, backend, etc.) provides additional signal.
 */
function buildSkillsSection(
	agent: AgentRow,
	issue: IssueRow | null,
	task: string,
): string {
	try {
		const text = `${task} ${issue?.title ?? ""} ${issue?.description ?? ""}`.toLowerCase();
		const agentRole = `${agent.slug} ${agent.display_name ?? ""}`.toLowerCase();

		// Role-based skill affinity — these skills are always loaded for certain roles
		const roleSkillMap: Record<string, string[]> = {
			frontend: [
				"anthropic-frontend-design",
				"ui-ux-pro-max",
				"vercel-react-best-practices",
				"vercel-web-design",
				"bencium-controlled-ux",
				"accesslint-audit",
			],
			backend: [
				"api-design-patterns",
				"database-performance",
				"supabase-postgres",
				"security-hardening",
			],
			cto: [
				"bencium-renaissance-architecture",
				"code-review-expert",
				"testing-strategy",
				"devops-cicd",
			],
			fullstack: [
				"vercel-react-best-practices",
				"api-design-patterns",
				"database-performance",
				"devops-cicd",
			],
		};

		// Determine which role skills to include
		const matchedRoleSlugs = new Set<string>();
		for (const [role, slugs] of Object.entries(roleSkillMap)) {
			if (agentRole.includes(role)) {
				for (const s of slugs) matchedRoleSlugs.add(s);
			}
		}

		// Task-content keyword matching against skill triggers
		const allSkills = rawSqlite
			.prepare(
				`SELECT slug, name, prompt, trigger FROM skills WHERE is_active = 1 AND trigger != '' LIMIT 100`,
			)
			.all() as Array<{
			slug: string;
			name: string;
			prompt: string;
			trigger: string;
		}>;

		const matched: Array<{ name: string; prompt: string }> = [];
		for (const skill of allSkills) {
			// Include if role-matched
			if (matchedRoleSlugs.has(skill.slug)) {
				matched.push({ name: skill.name, prompt: skill.prompt });
				continue;
			}
			// Include if task keywords match trigger words
			const triggers = skill.trigger.split(",").map((t) => t.trim().toLowerCase());
			const taskMatch = triggers.some(
				(trigger) => trigger.length > 2 && text.includes(trigger),
			);
			if (taskMatch) {
				matched.push({ name: skill.name, prompt: skill.prompt });
			}
		}

		if (matched.length === 0) return "";

		// Limit to top 5 most relevant skills to avoid prompt bloat
		const selected = matched.slice(0, 5);
		const lines = ["## Active Skills for This Task"];
		for (const skill of selected) {
			lines.push(`\n### ${skill.name}`);
			lines.push(skill.prompt);
		}
		return lines.join("\n");
	} catch {
		return "";
	}
}

function buildRoleSpecificPrompt(
	agent: AgentRow,
	issue: IssueRow | null,
	task: string,
): string {
	if (isCeoAgent(agent)) {
		const complex = isComplexIssueTask(issue, task);
		return [
			"## CEO Role",
			"You are the CEO — a strategic business leader, NOT a coder.",
			"",
			"YOUR THINKING STYLE:",
			'- Always ask "Why?" before "How?" — understand business value first',
			"- Think in terms of user impact, revenue, and competitive advantage",
			"- Break complex requests into phases: MVP first, then iterate",
			"- Prioritize ruthlessly: what gives 80% value with 20% effort?",
			"",
			"YOUR RESPONSIBILITIES:",
			"- Analyze new issues for business priority (P0-P3)",
			"- Create implementation plans with clear subtasks",
			"- Delegate technical work to CTO and Dev agents",
			"- NEVER write code yourself — delegate and review",
			"- Approve/reject proposals from CTO",
			"- Communicate progress to stakeholders (the human)",
			"",
			"WHEN YOU RECEIVE AN ISSUE:",
			"1. FIRST assess complexity and start your response with [COMPLEXITY: XS|S|M|L|XL]",
			"2. XS: Config change, typo fix, one-line change (< 5 min)",
			"3. S: Single-file bug fix or small enhancement (< 30 min)",
			"4. M: Multi-file feature, needs design thinking (< 2 hours)",
			"5. L: Major feature, multiple components affected (< 1 day)",
			"6. XL: Architecture change, new system, major refactor (> 1 day)",
			"7. Simple → assign directly to most appropriate agent",
			"8. Complex → create a plan with subtasks, present for approval",
			"9. Always set clear acceptance criteria and follow the SOP level that matches the assessed complexity.",
			complex
				? [
						"",
						"This issue is COMPLEX. Do not execute or write code.",
						"Produce a plan only, then stop.",
						"Return a fenced JSON block that can be parsed automatically:",
						"```json",
						'{"title":"...","approach":"...","subtasks":[{"id":"subtask-1","title":"...","description":"...","assignTo":"dev","priority":1,"dependsOn":[],"status":"pending"}]}',
						"```",
						"Also post a short issue comment summarizing the plan for approval.",
					].join("\n")
				: "This issue looks SIMPLE. Delegate directly to the best agent, keep scope tight, and state acceptance criteria.",
		].join("\n");
	}
	if (isCtoAgent(agent)) {
		return [
			"## CTO Role",
			"You are the CTO — a technical architect and quality guardian.",
			"",
			"YOUR THINKING STYLE:",
			"- Think about system design, scalability, and maintainability",
			"- Consider edge cases, error handling, and security implications",
			"- Evaluate technical debt vs. speed tradeoffs",
			"- Review code for correctness, not just functionality",
			"",
			"YOUR RESPONSIBILITIES:",
			"- Review all code produced by dev agents before it ships",
			"- Make architectural decisions (which patterns, which tools)",
			"- Identify technical risks and propose mitigations",
			"- Break technical subtasks into specific, actionable items",
			"- WRITE code only for complex architectural pieces",
			"",
			"WHEN REVIEWING CODE:",
			"1. Check: Does it solve the stated problem?",
			"2. Check: Security vulnerabilities? SQL injection? XSS?",
			"3. Check: Error handling? What happens when things fail?",
			"4. Check: Performance? O(n²) loops? Unnecessary re-renders?",
			"5. Verdict: APPROVED (with optional suggestions) or CHANGES_REQUESTED (with specific fixes)",
			"",
			"If the task is a code review, begin your response with exactly one line:",
			"VERDICT: APPROVED",
			"or",
			"VERDICT: CHANGES_REQUESTED",
		].join("\n");
	}
	if (isDevAgent(agent)) {
		return [
			"## Developer Role",
			"You are a Senior Developer — a focused implementer.",
			"",
			"YOUR THINKING STYLE:",
			"- Think in terms of working code, tests, and clean implementation",
			"- Start with the simplest solution that works, then refine",
			"- Write code that other developers can understand and maintain",
			"- Test edge cases and error paths",
			"",
			"YOUR RESPONSIBILITIES:",
			"- Implement features and fixes assigned to you",
			"- Write clean, tested, documented code",
			"- Address review feedback from CTO promptly",
			"- Ask clarifying questions if requirements are ambiguous",
			"- NEVER change architecture without CTO approval",
			"",
			"WHEN IMPLEMENTING:",
			"1. Understand the requirement fully (re-read issue + context)",
			"2. Plan your approach (which files, which changes)",
			"3. Implement with error handling",
			"4. Self-review before submitting",
			"5. Respond to CTO review feedback",
		].join("\n");
	}
	return "";
}

export function buildUserPrompt(input: {
	task?: string | null | undefined;
	issue: IssueRow | null;
}): string {
	let task = input.task ?? "";
	if (!task && input.issue) {
		task =
			`Issue: ${input.issue.title}\n\n${input.issue.description ?? ""}`.trim();
	}
	return task || "(no task supplied)";
}

export async function buildSystemPrompt(
	agent: AgentRow,
	issue: IssueRow | null,
	task: string,
): Promise<string> {
	const companyId = issue?.companyId ?? agent.company_id ?? null;

	let companyContext = "";
	try {
		if (companyId) {
			const company = getRawDb()
				.prepare(`SELECT name, slug FROM company_settings WHERE id = ?`)
				.get(companyId) as { name: string; slug: string } | undefined;
			const projects = getRawDb()
				.prepare(
					`SELECT p.name, COUNT(i.id) as total,
 SUM(CASE WHEN i.status IN ('todo','in_progress') THEN 1 ELSE 0 END) as active,
 SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) as done
 FROM board_projects p
 LEFT JOIN board_issues i ON i.project_id = p.id
 WHERE p.company_id = ? GROUP BY p.id`,
				)
				.all(companyId) as Array<{
				name: string;
				total: number;
				active: number;
				done: number;
			}>;
			if (company || projects.length > 0) {
				companyContext = `\n\n## Company & Project Context\n`;
				if (company) companyContext += `Company: ${company.name}\n`;
				if (projects.length > 0) {
					companyContext += `Projects:\n${projects
						.map(
							(project) =>
								`- ${project.name}: ${project.total} issues (${project.active} active, ${project.done} done)`,
						)
						.join("\n")}`;
				}
			}
		}
	} catch {
		/* best-effort */
	}

	const base =
		agent.system_prompt ??
		`You are ${agent.display_name}, an autonomous engineer in a Setra company. Be concise and concrete.`;
	const semanticMemorySection = await buildSemanticMemorySection(
		agent,
		issue,
		task,
	);
	const projectRulesSection = await buildProjectRulesSection(issue, task);
	let experienceSection = "";
	try {
		if (companyId) {
			const experience = getAgentExperience(agent.slug, companyId);
			const score = getAgentScore(agent.slug);
			if (experience.totalReflections > 0) {
				const lines = [
					"## Your Experience Profile",
					`Level: ${experience.level} (${experience.totalReflections} completed tasks)`,
					`Credibility: ${((score.credibility ?? 0.5) * 100).toFixed(0)}%`,
				];
				if (experience.skills.length > 0) {
					lines.push(
						`Strongest skills: ${experience.skills
							.slice(0, 5)
							.map((skill) => `${skill.name} (${skill.successRate}% success)`)
							.join(", ")}`,
					);
				}
				const recentLessons = experience.recent
					.filter((reflection) => reflection.lessonsLearned)
					.slice(0, 3);
				if (recentLessons.length > 0) {
					lines.push("", "Recent lessons learned:");
					for (const lesson of recentLessons) {
						lines.push(`- ${lesson.lessonsLearned}`);
					}
				}
				experienceSection = `\n\n${lines.join("\n")}`;
			}
		}
	} catch {
		/* best-effort */
	}
	let legacyMemorySection = "";
	try {
		if (companyId) {
			const rows = getRawDb()
				.prepare(
					`SELECT from_agent, content, created_at FROM team_messages
  WHERE channel = 'memory' AND company_id = ?
  ORDER BY created_at DESC LIMIT 10`,
				)
				.all(companyId) as Array<{
				from_agent: string;
				content: string;
				created_at: string;
			}>;
			if (rows.length > 0) {
				const entries = rows.map((row) => {
					try {
						const parsed = JSON.parse(row.content) as {
							key?: string;
							content?: string;
						};
						return `- [${row.from_agent}] ${parsed.key ?? "memory"}: ${parsed.content ?? row.content}`;
					} catch {
						return `- [${row.from_agent}] ${row.content}`;
					}
				});
				legacyMemorySection = `\n\n## Team Memory Feed\nRecent stored notes mirrored to the collaboration timeline:\n${entries.join("\n")}`;
			}
		}
	} catch {
		/* best-effort */
	}

	const integrationSection = buildCompanyIntegrationSection(companyId);

	let cloneBriefSection = "";
	try {
		const cloneRow = getRawDb()
			.prepare(
				`SELECT brief, mode FROM clone_profile WHERE company_id = ? LIMIT 1`,
			)
			.get(companyId ?? "default") as
			| { brief: string | null; mode: string }
			| undefined;
		if (cloneRow?.brief && cloneRow.brief.trim().length > 0) {
			cloneBriefSection = `\n\n## Your Boss's Working Style\nThe following describes your boss's preferences, communication style, and priorities. Adapt your work to match:\n${cloneRow.brief}`;
			if (cloneRow.mode === "locked") {
				cloneBriefSection += `\n\n**Note: Clone is in LOCKED mode.** You should act exactly as your boss would — use the same tone, make the same decisions, prioritize the same way.`;
			}
		}
	} catch {
		/* best-effort */
	}

	let mcpToolsList = "";
	try {
		const mcpMgr = getMcpManager(companyId);
		const connectedServers = mcpMgr
			.getAllStates()
			.filter((state) => state.status === "connected");
		if (connectedServers.length > 0) {
			const serverDescriptions = connectedServers.map((state) => {
				const toolNames = state.tools.map((tool) => tool.name).join(", ");
				return `- **${state.config.name}**: ${toolNames}`;
			});
			mcpToolsList = `\n\n## Connected MCP Servers\nYou have access to tools from these MCP servers (prefixed with mcp__{serverId}__):\n${serverDescriptions.join("\n")}\nUse these tools to read/write files, store memories, search, and more.`;
		}
	} catch {
		/* MCP not available */
	}

	const mcpGuidance = [
		"## Core Principles",
		"- **Stay focused on the assigned issue.** Do not work on unrelated tasks.",
		"- **Discuss before acting.** If unsure about an approach, post a comment on the issue first.",
		"- **Write real code when your role is implementation.** Use tools to create and modify files. Do NOT just describe what you would do.",
		"- **Post progress updates.** Use post_issue_comment to share what you did and why.",
		"- **Respect the company role split.** CEO plans, CTO reviews architecture and quality, Developers implement.",
		"",
		"## Available Tools",
		"- **read_file(path)**: Read file contents from the project workspace.",
		"- **write_file(path, content)**: Create or update files. Directories are created automatically.",
		"- **list_directory(path)**: List files and directories. Use '.' for the project root.",
		"- **store_memory(key, content, tags?)**: Store important decisions for other agents.",
		"- **post_issue_comment(comment)**: Post progress updates on the issue.",
		"- **reassign_issue(reason)**: Decline a task outside your expertise.",
	].join("\n");

	const rolePrompt = buildRoleSpecificPrompt(agent, issue, task);
	const skillsSection = buildSkillsSection(agent, issue, task);
	return [
		base,
		companyContext,
		semanticMemorySection,
		experienceSection,
		legacyMemorySection,
		integrationSection,
		cloneBriefSection,
		projectRulesSection,
		rolePrompt,
		skillsSection,
		mcpGuidance + mcpToolsList,
		issue ? `Parent issue: ${issue.slug} — ${issue.title}` : null,
	]
		.filter(Boolean)
		.join("\n\n");
}
