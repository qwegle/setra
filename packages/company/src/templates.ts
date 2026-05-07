/**
 * setra.sh — Company Formation: Built-in Company Templates
 *
 * These are the pre-built company presets available in the "New Company" UI.
 * Each template is a complete Company definition that the user can use as-is
 * or customize before running.
 *
 * Template design philosophy:
 *   - Each template has a clear, focused purpose (not "a team for everything")
 *   - Model selection follows the CEO=opus, workers=sonnet, reviewers=haiku rule
 *   - The "Security Audit" template intentionally uses different models for
 *     independent analysis (model diversity reduces blind spots)
 *   - Solo Coder is the default single-agent experience
 *
 * Templates are stored in the DB with templateSlug set. When the user
 * customizes one, it saves as a new company with templateSlug preserved for
 * provenance.
 */

import type { Company } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Build minimal company from a template spec
// ─────────────────────────────────────────────────────────────────────────────

function makeCompany(
	spec: Omit<Company, "id" | "version">,
): Omit<Company, "id"> {
	return { ...spec, version: "1" };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 1: SOLO CODER
// Single agent with full tools. Equivalent to setra's default run mode but
// surfaced as a "company" so it can be parameterized and saved.
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_SOLO_CODER = makeCompany({
	name: "Solo Coder",
	description:
		"One agent with full coding tools. Use this for focused single-task work where you want full visibility without team overhead.",
	leadSlug: "dev",
	templateSlug: "solo-coder",
	totalCostBudgetUsd: 2.0,
	members: [
		{
			slug: "dev",
			name: "Developer",
			role: "Full-Stack Developer",
			model: "claude-sonnet-4-5",
			maxTurns: 30,
			permissionMode: "auto",
			worktreeIsolation: true,
			costBudgetUsd: 2.0,
			expertise: ["full-stack", "architecture", "debugging", "refactoring"],
			systemPrompt:
				"You are a senior full-stack developer working solo. You have full coding access.\n\nGuidelines:\n- Read the codebase carefully before making changes\n- Make surgical, minimal changes — don't refactor what isn't broken\n- Run tests after changes: npm test or the project's test command\n- Use team_request_approval kind=merge when your work is ready for review\n- Use team_cost occasionally to stay aware of your spending",
			toolScope: {
				allowList: ["Edit", "Write", "Read", "Bash(*)", "Glob", "Grep"],
				denyList: ["Bash(git push*)", "Bash(git merge*)"],
				mcpServers: ["setra-core", "setra-team", "filesystem"],
			},
		},
	],
	channels: [
		{
			slug: "general",
			name: "General",
			description: "Main work channel.",
			type: "broadcast",
			members: ["dev", "human"],
			retentionHours: null,
		},
	],
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 2: CODE REVIEW TEAM
// Author + 2 reviewers using different models for independent analysis.
// Model diversity is intentional: different models have different blind spots.
// Claude reviews for code quality, GPT-4o reviews for architecture, haiku for tests.
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_CODE_REVIEW = makeCompany({
	name: "Code Review Team",
	description:
		"Three-way code review with model diversity. The author writes the code; two independent reviewers (using different models) catch different classes of issues.",
	leadSlug: "author",
	templateSlug: "code-review",
	totalCostBudgetUsd: 3.0,
	members: [
		{
			slug: "author",
			name: "Author",
			role: "Code Author",
			model: "claude-sonnet-4-5",
			maxTurns: 20,
			permissionMode: "auto",
			worktreeIsolation: true,
			costBudgetUsd: 1.5,
			expertise: ["implementation", "refactoring", "feature-development"],
			systemPrompt:
				"You are the code author. Implement the requested change in your worktree.\n\nWhen done:\n1. Post a summary to #general describing what you changed and why\n2. Tag @reviewer-1 and @reviewer-2 in the message\n3. Submit for approval: team_request_approval kind=merge with your branch_name\n\nRespond to reviewer feedback by making revisions in your worktree and resubmitting.",
			toolScope: {
				allowList: ["Edit", "Write", "Read", "Bash(*)", "Glob", "Grep"],
				denyList: ["Bash(git push*)", "Bash(git merge*)"],
				mcpServers: ["setra-core", "setra-team", "filesystem"],
			},
		},
		{
			slug: "reviewer-1",
			name: "Code Reviewer",
			role: "Senior Code Reviewer",
			model: "claude-opus-4-5", // Different from author — intentional
			maxTurns: 10,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 1.0,
			expertise: ["code-quality", "security", "performance", "maintainability"],
			systemPrompt:
				"You are a senior code reviewer. Read the diff shown in the approval request.\n\nYour review focuses on:\n- Logic errors and edge cases\n- Security vulnerabilities (injection, auth bypass, exposed secrets)\n- Performance issues (N+1 queries, unnecessary re-renders, blocking I/O)\n- Code clarity and maintainability\n\nPost your findings to #review. Use ✅ if the code looks good, 🚨 for blockers, ⚠️ for suggestions.\nIf you find blockers, tag @author with specific line-by-line feedback.\nIf everything looks good, post team_react ✅ to the author's approval request.",
			toolScope: {
				allowList: ["Read", "Glob", "Grep"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
		{
			slug: "reviewer-2",
			name: "Architecture Reviewer",
			role: "Architecture & Test Reviewer",
			model: "gpt-4o", // Intentionally different model for independent analysis
			maxTurns: 10,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 0.75,
			expertise: ["architecture", "testing", "API-design", "data-modeling"],
			systemPrompt:
				"You are the architecture and test reviewer. Read the diff shown in the approval request.\n\nYour review focuses on:\n- Architecture fit: does the change follow existing patterns?\n- Test coverage: are the new code paths tested?\n- API design: are interfaces clean and stable?\n- Data modeling: are new DB changes reversible?\n\nPost your findings to #review.\nYou use GPT-4o — which means you'll notice things that Claude might miss. Use this.\nBe direct and specific. If tests are missing, say exactly what tests are needed.",
			toolScope: {
				allowList: ["Read", "Glob", "Grep"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
	],
	channels: [
		{
			slug: "general",
			name: "General",
			description: "Main coordination channel.",
			type: "broadcast",
			members: ["author", "reviewer-1", "reviewer-2", "human"],
			retentionHours: null,
		},
		{
			slug: "review",
			name: "Review",
			description: "Review findings, inline comments, revision requests.",
			type: "broadcast",
			members: ["reviewer-1", "reviewer-2", "author"],
			observers: ["human"],
			retentionHours: 72,
		},
	],
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 3: FEATURE TEAM
// PM + Frontend + Backend + QA. Classic cross-functional feature team.
// PM uses gpt-4o (good at structured specs), engineers use Claude (better code),
// QA uses haiku (fast and cheap for test writing).
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_FEATURE_TEAM = makeCompany({
	name: "Feature Team",
	description:
		"Full feature development team: PM writes specs, engineers implement, QA verifies. Use this for complete feature work from requirements to tested code.",
	leadSlug: "pm",
	templateSlug: "feature-team",
	totalCostBudgetUsd: 8.0,
	members: [
		{
			slug: "pm",
			name: "Product Manager",
			role: "Product Manager & Lead",
			model: "gpt-4o", // GPT-4o excels at structured specs and user stories
			maxTurns: 25,
			permissionMode: "plan",
			worktreeIsolation: false,
			costBudgetUsd: 1.5,
			expertise: [
				"product-strategy",
				"user-stories",
				"requirements",
				"prioritization",
				"acceptance-criteria",
			],
			systemPrompt:
				"You are the product manager and team lead. You do NOT write code.\n\nYour job:\n1. Understand the feature request fully — ask clarifying questions via team_request kind=freeform if anything is unclear\n2. Write a structured spec: user stories, acceptance criteria, technical requirements\n3. Post the spec to #specs\n4. Create tasks for @fe and @be with clear, testable requirements\n5. Create a test task for @qa with the acceptance criteria as the test checklist\n6. Monitor progress, unblock the team\n7. When QA passes, review the output and submit team_request_approval kind=merge\n\nYou use GPT-4o — which means you're excellent at structured thinking. Write precise specs.",
			toolScope: {
				allowList: ["Read"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
		{
			slug: "fe",
			name: "Frontend Engineer",
			role: "Frontend Engineer",
			model: "claude-sonnet-4-5",
			maxTurns: 15,
			permissionMode: "auto",
			worktreeIsolation: true,
			costBudgetUsd: 2.0,
			expertise: [
				"React",
				"TypeScript",
				"TailwindCSS",
				"accessibility",
				"state-management",
			],
			systemPrompt:
				"You are the frontend engineer. Read the spec in #specs before starting.\n\nImplement the frontend requirements. When done, post team_request_approval kind=merge.",
			toolScope: {
				allowList: [
					"Edit",
					"Write",
					"Read",
					"Bash(npm*,npx*,git status,git diff)",
					"Glob",
					"Grep",
				],
				denyList: ["Bash(git push*)", "Bash(git merge*)"],
				mcpServers: ["setra-core", "setra-team", "filesystem"],
			},
		},
		{
			slug: "be",
			name: "Backend Engineer",
			role: "Backend Engineer",
			model: "claude-sonnet-4-5",
			maxTurns: 15,
			permissionMode: "auto",
			worktreeIsolation: true,
			costBudgetUsd: 2.0,
			expertise: [
				"Node.js",
				"TypeScript",
				"REST-APIs",
				"databases",
				"authentication",
			],
			systemPrompt:
				"You are the backend engineer. Read the spec in #specs before starting.\n\nImplement the backend requirements. When done, post team_request_approval kind=merge.",
			toolScope: {
				allowList: [
					"Edit",
					"Write",
					"Read",
					"Bash(npm*,node*,git status,git diff,curl*)",
					"Glob",
					"Grep",
				],
				denyList: ["Bash(git push*)", "Bash(git merge*)", "Bash(sudo*)"],
				mcpServers: ["setra-core", "setra-team", "filesystem"],
			},
		},
		{
			slug: "qa",
			name: "QA Engineer",
			role: "QA Engineer",
			model: "claude-haiku-3-5", // Fast and cheap for test writing
			maxTurns: 10,
			permissionMode: "auto",
			worktreeIsolation: true,
			costBudgetUsd: 0.75,
			expertise: [
				"Vitest",
				"Playwright",
				"testing",
				"edge-cases",
				"acceptance-criteria",
			],
			systemPrompt:
				"You are the QA engineer. Write tests against the acceptance criteria in #specs.\n\nRun: npm test. If all pass, team_react ✅ on the PM's spec message.\nIf tests fail, post details to #qa tagging @fe or @be.\nWhen your tests are written and passing, team_request_approval kind=merge.",
			toolScope: {
				allowList: [
					"Edit",
					"Write",
					"Read",
					"Bash(npm test,npm run test*,npx vitest*,npx playwright*)",
					"Glob",
					"Grep",
				],
				denyList: ["Bash(git push*)", "Bash(npm install*)"],
				mcpServers: ["setra-team"],
			},
		},
	],
	channels: [
		{
			slug: "general",
			name: "General",
			description: "Team coordination. PM leads from here.",
			type: "broadcast",
			members: ["pm", "fe", "be", "qa", "human"],
			retentionHours: null,
		},
		{
			slug: "specs",
			name: "Specs",
			description: "Product specs, user stories, acceptance criteria.",
			type: "announce",
			members: ["pm", "human"],
			observers: ["fe", "be", "qa"],
			retentionHours: null,
		},
		{
			slug: "frontend",
			name: "Frontend",
			description: "Frontend implementation updates.",
			type: "broadcast",
			members: ["fe", "pm"],
			observers: ["qa", "human"],
			retentionHours: 48,
		},
		{
			slug: "backend",
			name: "Backend",
			description: "Backend implementation updates.",
			type: "broadcast",
			members: ["be", "pm"],
			observers: ["qa", "human"],
			retentionHours: 48,
		},
		{
			slug: "qa",
			name: "QA",
			description: "Test results and bug reports.",
			type: "broadcast",
			members: ["qa", "pm"],
			observers: ["fe", "be", "human"],
			retentionHours: 48,
		},
	],
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 4: SECURITY AUDIT
// Three security-focused agents with READ-ONLY tools.
// All three use different models — intentional for independent analysis.
// No code is written; only findings are reported.
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_SECURITY_AUDIT = makeCompany({
	name: "Security Audit",
	description:
		"Three independent security reviewers using different models to audit your codebase. No code is written — only findings are reported. Model diversity catches more issues.",
	leadSlug: "lead-auditor",
	templateSlug: "security-audit",
	totalCostBudgetUsd: 4.0,
	members: [
		{
			slug: "lead-auditor",
			name: "Lead Security Auditor",
			role: "Lead Security Auditor",
			model: "claude-opus-4-5",
			maxTurns: 20,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 2.0,
			expertise: [
				"OWASP-Top-10",
				"authentication",
				"authorization",
				"injection",
				"secrets-management",
				"dependency-audit",
			],
			systemPrompt:
				"You are the lead security auditor. Coordinate the audit and synthesize findings.\n\nYour process:\n1. Assign specific areas to @auditor-2 (infrastructure/deps) and @auditor-3 (auth/access control)\n2. You audit the application logic, data flow, and API surface\n3. Collect findings via #audit-findings\n4. Synthesize into a final report posted to #general\n5. Submit team_request kind=info to present findings to the human\n\nUse CVSS scores for severity. Be specific about file paths and line numbers.\nDo NOT modify any files — this is a read-only audit.",
			toolScope: {
				allowList: ["Read", "Glob", "Grep", "Bash(git log,git blame,git show)"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
		{
			slug: "auditor-2",
			name: "Infrastructure Auditor",
			role: "Infrastructure & Dependency Auditor",
			model: "gpt-4o", // Good at dependency analysis and configuration review
			maxTurns: 15,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 1.25,
			expertise: [
				"dependency-vulnerabilities",
				"supply-chain",
				"Docker",
				"env-config",
				"CI-CD",
				"secrets-in-code",
			],
			systemPrompt:
				"You are the infrastructure and dependency auditor.\n\nFocus areas:\n- npm audit / package.json dependencies (known CVEs)\n- Secrets accidentally committed (API keys, passwords, tokens)\n- Docker/container configuration issues\n- CI/CD pipeline security (exposed secrets in env vars)\n- .env files committed, hardcoded credentials\n\nPost all findings to #audit-findings with:\n- Severity: Critical/High/Medium/Low\n- File + line number\n- Description of the vulnerability\n- Recommended fix\n\nDo NOT modify any files.",
			toolScope: {
				allowList: ["Read", "Glob", "Grep", "Bash(git log,git blame,cat,find)"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
		{
			slug: "auditor-3",
			name: "Auth & Access Auditor",
			role: "Authentication & Authorization Auditor",
			model: "gemini-2.5-pro", // Third model for maximum independence
			maxTurns: 15,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 0.75,
			expertise: [
				"JWT",
				"session-management",
				"RBAC",
				"IDOR",
				"CSRF",
				"XSS",
				"SQL-injection",
			],
			systemPrompt:
				"You are the auth and access control auditor.\n\nFocus areas:\n- Authentication flows (login, logout, token refresh, session expiry)\n- Authorization checks (is auth required on all protected routes?)\n- IDOR vulnerabilities (can user A access user B's resources?)\n- JWT vulnerabilities (alg:none, weak secrets, missing claims)\n- CSRF protection on state-changing endpoints\n- XSS in user-controlled output\n- SQL/NoSQL injection in query construction\n\nPost all findings to #audit-findings with file + line + CVSS score.\nDo NOT modify any files.",
			toolScope: {
				allowList: ["Read", "Glob", "Grep"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
	],
	channels: [
		{
			slug: "general",
			name: "General",
			description: "Lead auditor uses this for kickoff and final report.",
			type: "broadcast",
			members: ["lead-auditor", "auditor-2", "auditor-3", "human"],
			retentionHours: null,
		},
		{
			slug: "audit-findings",
			name: "Audit Findings",
			description:
				"All individual findings from all auditors. Aggregated into the final report.",
			type: "broadcast",
			members: ["lead-auditor", "auditor-2", "auditor-3"],
			observers: ["human"],
			retentionHours: null,
		},
	],
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE 5: DOCUMENTATION TEAM
// Tech writer + reviewer + editor. Useful for writing/updating docs.
// ─────────────────────────────────────────────────────────────────────────────

export const TEMPLATE_DOCUMENTATION = makeCompany({
	name: "Documentation Team",
	description:
		"Write and review technical documentation. Tech writer drafts, a technical reviewer checks accuracy, an editor polishes prose.",
	leadSlug: "tech-writer",
	templateSlug: "documentation",
	totalCostBudgetUsd: 2.0,
	members: [
		{
			slug: "tech-writer",
			name: "Technical Writer",
			role: "Lead Technical Writer",
			model: "claude-sonnet-4-5",
			maxTurns: 20,
			permissionMode: "auto",
			worktreeIsolation: true,
			costBudgetUsd: 1.0,
			expertise: [
				"technical-writing",
				"API-docs",
				"tutorials",
				"README",
				"markdown",
			],
			systemPrompt:
				"You are the lead technical writer. Read the codebase, then write clear documentation.\n\nProcess:\n1. Read the source code to understand what you're documenting\n2. Write documentation in your worktree\n3. Post a summary to #docs-review tagging @tech-reviewer and @editor\n4. Submit team_request_approval kind=merge when ready",
			toolScope: {
				allowList: [
					"Edit",
					"Write",
					"Read",
					"Glob",
					"Grep",
					"Bash(git status,git diff)",
				],
				denyList: ["Bash(git push*)", "Bash(git merge*)"],
				mcpServers: ["setra-core", "setra-team", "filesystem"],
			},
		},
		{
			slug: "tech-reviewer",
			name: "Technical Reviewer",
			role: "Technical Accuracy Reviewer",
			model: "claude-opus-4-5",
			maxTurns: 10,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 0.75,
			expertise: ["technical-accuracy", "code-examples", "API-correctness"],
			systemPrompt:
				"You are the technical reviewer. Check that the documentation is technically accurate.\n\nVerify:\n- Code examples actually work\n- API signatures match the source code\n- Configuration examples are correct\n- No outdated information\n\nPost feedback to #docs-review. Use team_react ✅ if accurate, otherwise tag @tech-writer with specific corrections.",
			toolScope: {
				allowList: ["Read", "Glob", "Grep"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
		{
			slug: "editor",
			name: "Editor",
			role: "Copy Editor",
			model: "claude-haiku-3-5",
			maxTurns: 8,
			permissionMode: "readonly",
			worktreeIsolation: false,
			costBudgetUsd: 0.25,
			expertise: ["prose", "clarity", "grammar", "tone", "structure"],
			systemPrompt:
				"You are the copy editor. Review the documentation for clarity and readability.\n\nFocus on:\n- Clear, concise sentences (no jargon without explanation)\n- Consistent tone (second person 'you', active voice)\n- Logical structure and flow\n- Typos and grammar\n\nPost feedback to #docs-review. Keep it actionable — specific line-level suggestions.",
			toolScope: {
				allowList: ["Read"],
				denyList: [],
				mcpServers: ["setra-team"],
			},
		},
	],
	channels: [
		{
			slug: "general",
			name: "General",
			description: "Team coordination.",
			type: "broadcast",
			members: ["tech-writer", "tech-reviewer", "editor", "human"],
			retentionHours: null,
		},
		{
			slug: "docs-review",
			name: "Docs Review",
			description: "Documentation drafts and review feedback.",
			type: "broadcast",
			members: ["tech-writer", "tech-reviewer", "editor"],
			observers: ["human"],
			retentionHours: 72,
		},
	],
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyTemplateEntry {
	slug: string;
	name: string;
	description: string;
	category: "coding" | "review" | "audit" | "docs" | "solo";
	memberCount: number;
	estimatedCostUsd: string; // e.g. "$0.50–$2.00 / run"
	company: Omit<Company, "id">;
}

export const COMPANY_TEMPLATES: CompanyTemplateEntry[] = [
	{
		slug: "solo-coder",
		name: "Solo Coder",
		description: "One agent, full tools. The default experience.",
		category: "solo",
		memberCount: 1,
		estimatedCostUsd: "$0.10–$0.50 / run",
		company: TEMPLATE_SOLO_CODER,
	},
	{
		slug: "code-review",
		name: "Code Review Team",
		description:
			"Author + 2 reviewers using different AI models for independent analysis.",
		category: "review",
		memberCount: 3,
		estimatedCostUsd: "$0.50–$2.00 / run",
		company: TEMPLATE_CODE_REVIEW,
	},
	{
		slug: "feature-team",
		name: "Feature Team",
		description:
			"PM + Frontend + Backend + QA. Full feature from spec to tested code.",
		category: "coding",
		memberCount: 4,
		estimatedCostUsd: "$2.00–$8.00 / run",
		company: TEMPLATE_FEATURE_TEAM,
	},
	{
		slug: "security-audit",
		name: "Security Audit",
		description:
			"3 independent security auditors using different models. Read-only analysis.",
		category: "audit",
		memberCount: 3,
		estimatedCostUsd: "$1.00–$4.00 / run",
		company: TEMPLATE_SECURITY_AUDIT,
	},
	{
		slug: "documentation",
		name: "Documentation Team",
		description: "Tech writer + technical reviewer + copy editor.",
		category: "docs",
		memberCount: 3,
		estimatedCostUsd: "$0.30–$2.00 / run",
		company: TEMPLATE_DOCUMENTATION,
	},
	{
		slug: "fullstack-dev-team",
		name: "Full Stack Dev Team",
		description:
			"Architect + Frontend + Backend + QA with approval workflow. Load from examples/.",
		category: "coding",
		memberCount: 4,
		estimatedCostUsd: "$1.00–$5.00 / run",
		company: {
			...TEMPLATE_FEATURE_TEAM,
			name: "Full Stack Dev Team",
			templateSlug: "fullstack-dev-team",
		},
	},
];

export function getTemplate(slug: string): CompanyTemplateEntry | undefined {
	return COMPANY_TEMPLATES.find((t) => t.slug === slug);
}
