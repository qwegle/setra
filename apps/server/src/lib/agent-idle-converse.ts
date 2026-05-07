/**
 * agent-idle-converse.ts — Project-focused conversations when agents are idle.
 *
 * When no issues are available, agents discuss the actual project:
 * - Review project goals and progress
 * - Discuss architecture and technical decisions
 * - Propose improvements based on real project context
 * - Log actionable ideas as backlog issues (with human approval pending)
 *
 * Conversations are grounded in real project data, not generic business advice.
 */

import { existsSync, readFileSync } from "node:fs";
import { getRawDb } from "@setra/db";
import * as collaborationRepo from "../repositories/collaboration.repo.js";
import { emit } from "../sse/handler.js";
import { getCompanySettings } from "./company-settings.js";
import { withRetry } from "./retry.js";
import { recordLlmCost } from "./track-llm-cost.js";

const CONVERSE_COOLDOWN_MS = 15 * 60_000; // 15 minutes between conversations (avoid spam)
const lastConverse = new Map<string, number>();

interface AgentRow {
	id: string;
	slug: string;
	display_name: string;
	adapter_type: string;
	model_id: string | null;
	company_id: string;
	system_prompt: string | null;
}

/**
 * Called from dispatcher tick when agents are idle and no work is available.
 * Triggers a project-focused conversation in the #general channel.
 */
export async function triggerIdleConversation(
	companyId: string,
): Promise<void> {
	const now = Date.now();
	const lastTime = lastConverse.get(companyId) ?? 0;
	if (now - lastTime < CONVERSE_COOLDOWN_MS) return;

	const db = getRawDb();

	// Get all active idle agents (excluding assistant)
	const agents = db
		.prepare(
			`SELECT id, slug, display_name, adapter_type, model_id, company_id, system_prompt
			 FROM agent_roster
			 WHERE company_id = ? AND is_active = 1 AND status = 'idle'
			 AND slug NOT LIKE 'assistant%'`,
		)
		.all(companyId) as AgentRow[];

	if (agents.length < 2) return;

	// Check if there are any issues at all — if not, skip (agents need project context)
	const issueCount =
		(
			db
				.prepare(`SELECT COUNT(*) as c FROM board_issues WHERE company_id = ?`)
				.get(companyId) as { c: number }
		)?.c ?? 0;

	// Build real project context
	const projectInfo = buildProjectContext(db, companyId);
	if (!projectInfo.hasProject) return; // No project = nothing to discuss

	console.log(
		`[agent-converse] ${agents.length} idle agents — starting project-focused discussion`,
	);
	lastConverse.set(companyId, now);

	// Generate a topic grounded in actual project data
	const topic = generateProjectTopic(projectInfo, issueCount);

	// Get recent channel context (avoid repeating)
	const recentMessages = collaborationRepo
		.listMessages(companyId, "general", 10)
		.filter((m) => m.messageKind !== "pinned_sprint_board");
	const recentContext = recentMessages
		.slice(-5)
		.map((m) => `[${m.agentSlug}]: ${m.body}`)
		.join("\n");

	const initiator = agents[0]!;
	const responder = agents[1]!;

	try {
		const initiatorReply = await generateConversation(
			initiator,
			companyId,
			topic,
			recentContext,
			projectInfo.summary,
			null,
		);

		if (initiatorReply) {
			collaborationRepo.insertAutomatedReply({
				channelId: "general",
				reply: initiatorReply,
				companyId,
				fromAgent: initiator.slug,
			});
			emit("collab:message", { channel: "general", companyId });

			setTimeout(async () => {
				try {
					const response = await generateConversation(
						responder,
						companyId,
						topic,
						recentContext,
						projectInfo.summary,
						`[${initiator.display_name}]: ${initiatorReply}`,
					);

					if (response) {
						collaborationRepo.insertAutomatedReply({
							channelId: "general",
							reply: response,
							companyId,
							fromAgent: responder.slug,
						});
						emit("collab:message", { channel: "general", companyId });
					}
				} catch (err) {
					console.warn("[agent-converse] responder failed:", err);
				}
			}, 15_000);
		}
	} catch (err) {
		console.warn("[agent-converse] conversation failed:", err);
	}
}

interface ProjectInfo {
	hasProject: boolean;
	summary: string;
	projectName: string;
	totalIssues: number;
	activeIssues: number;
	doneIssues: number;
	reviewIssues: number;
	contextFile: string;
}

function buildProjectContext(
	db: ReturnType<typeof getRawDb>,
	companyId: string,
): ProjectInfo {
	const empty: ProjectInfo = {
		hasProject: false,
		summary: "",
		projectName: "",
		totalIssues: 0,
		activeIssues: 0,
		doneIssues: 0,
		reviewIssues: 0,
		contextFile: "",
	};

	try {
		const project = db
			.prepare(
				`SELECT id, name, COALESCE(NULLIF(trim(workspace_path),''), NULLIF(trim(repo_path),'')) as path
			 FROM board_projects WHERE company_id = ? LIMIT 1`,
			)
			.get(companyId) as
			| { id: string; name: string; path: string | null }
			| undefined;
		if (!project) return empty;

		const stats = db
			.prepare(
				`SELECT
				COUNT(*) as total,
				SUM(CASE WHEN status IN ('todo','in_progress') THEN 1 ELSE 0 END) as active,
				SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
				SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as review
			 FROM board_issues WHERE project_id = ?`,
			)
			.get(project.id) as {
			total: number;
			active: number;
			done: number;
			review: number;
		};

		// Read project context file if it exists
		let contextFile = "";
		if (project.path) {
			const contextPath = `${project.path}/.setra/project-context.md`;
			if (existsSync(contextPath)) {
				contextFile = readFileSync(contextPath, "utf-8").slice(0, 2000);
			}
		}

		// Get recent issues for context
		const recentIssues = db
			.prepare(
				`SELECT slug, title, status, priority FROM board_issues
			 WHERE project_id = ? ORDER BY updated_at DESC LIMIT 10`,
			)
			.all(project.id) as Array<{
			slug: string;
			title: string;
			status: string;
			priority: string;
		}>;

		const issueList = recentIssues
			.map((i) => `  - [${i.status}] ${i.slug}: ${i.title} (${i.priority})`)
			.join("\n");

		const summary = [
			`Project: ${project.name}`,
			`Issues: ${stats.total} total (${stats.active} active, ${stats.done} done, ${stats.review} in review)`,
			recentIssues.length > 0 ? `Recent issues:\n${issueList}` : "",
			contextFile ? `\nProject context:\n${contextFile}` : "",
		]
			.filter(Boolean)
			.join("\n");

		return {
			hasProject: true,
			summary,
			projectName: project.name,
			totalIssues: stats.total,
			activeIssues: stats.active,
			doneIssues: stats.done,
			reviewIssues: stats.review,
			contextFile,
		};
	} catch {
		return empty;
	}
}

function generateProjectTopic(info: ProjectInfo, issueCount: number): string {
	// Topics grounded in actual project state
	if (issueCount === 0) {
		return `We have a project "${info.projectName}" but no issues yet. What should our first priorities be? What goals should we set? What's the first thing we should build or improve?`;
	}
	if (info.reviewIssues > 0) {
		return `We have ${info.reviewIssues} issues waiting for review. What should we focus on while waiting? Are there any improvements or optimizations we should prepare for?`;
	}
	if (info.activeIssues === 0 && info.totalIssues > 0) {
		return `All ${info.totalIssues} issues are either done or in backlog. What should we pick up next? Are there gaps in our project that need attention?`;
	}

	// Rotate through project-focused topics
	const projectTopics = [
		`Looking at our "${info.projectName}" project — what's the most impactful improvement we could make right now?`,
		`How can we improve the architecture of "${info.projectName}"? Any patterns or refactors that would help?`,
		`What are the biggest risks or gaps in "${info.projectName}" that we should address soon?`,
		`If we were to onboard a new developer to "${info.projectName}", what would they struggle with? What needs documentation?`,
	];
	return projectTopics[Date.now() % projectTopics.length]!;
}

async function generateConversation(
	agent: AgentRow,
	companyId: string,
	topic: string,
	recentContext: string,
	projectContext: string,
	priorMessage: string | null,
): Promise<string | null> {
	const settings = getCompanySettings(companyId) as Record<string, unknown>;
	const apiKey =
		(typeof settings["openai_api_key"] === "string"
			? settings["openai_api_key"]
			: "") ||
		(process.env.OPENAI_API_KEY ?? "");
	if (!apiKey) return null;

	const mode = priorMessage
		? "responding to a colleague"
		: "starting a discussion";
	const systemPrompt = `You are ${agent.display_name} (${agent.slug}), an AI team member.
You're between tasks. Have a focused, productive discussion about the project.

Your role:
${agent.system_prompt ?? `You are ${agent.display_name}, a skilled engineer.`}

Project status:
${projectContext || "(no project data)"}

Recent conversation:
${recentContext || "(quiet)"}

Rules:
- You're ${mode}. Be specific about THIS project — not generic advice.
- Keep it to 2-3 sentences. Be concrete.
- Reference actual issues, files, or architecture from the project.
- If you have an actionable suggestion, be specific about what to do.
- Never say "as an AI" — you're a team member.`;

	const userPrompt = priorMessage
		? `Topic: ${topic}\n\nColleague said:\n${priorMessage}\n\nYour take:`
		: `Discuss: ${topic}`;

	try {
		const data = await withRetry(
			async () => {
				const resp = await fetch("https://api.openai.com/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model: agent.model_id ?? "gpt-4o-mini",
						max_completion_tokens: 512,
						messages: [
							{ role: "system", content: systemPrompt },
							{ role: "user", content: userPrompt },
						],
					}),
				});
				if (!resp.ok) {
					const errBody = await resp.text().catch(() => "");
					throw new Error(
						`openai-api ${resp.status}: ${errBody.slice(0, 200)}`,
					);
				}
				return (await resp.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
					usage?: { prompt_tokens?: number; completion_tokens?: number };
				};
			},
			{
				maxAttempts: 2,
				onRetry: (attempt, error, delay) => {
					console.warn(
						`[agent-converse] retry ${attempt} for ${agent.slug} after ${Math.round(delay)}ms: ${error.message}`,
					);
				},
			},
		);

		// Record cost
		if (data.usage) {
			recordLlmCost({
				agentSlug: agent.slug,
				model: agent.model_id ?? "gpt-4o-mini",
				usage: data.usage,
				source: "idle-converse",
				companyId,
			});
		}

		return data.choices?.[0]?.message?.content?.trim() ?? null;
	} catch (err) {
		console.warn(`[agent-converse] fetch error for ${agent.slug}:`, err);
		return null;
	}
}
