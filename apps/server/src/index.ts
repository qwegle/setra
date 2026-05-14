/**
 * setra.sh control-plane server
 *
 * Stack: Hono + Drizzle/SQLite + SSE
 * Port:  3141 (default) — set SETRA_PORT to override
 *
 * Route map:
 *   GET  /api/health          — liveness probe
 *   GET  /api/events          — SSE stream for board real-time updates
 *   GET  /api/projects        — list projects
 *   POST /api/projects        — create project
 *   GET  /api/projects/:id    — get project
 *   GET  /api/projects/:id/issues — list issues for project
 *   POST /api/issues          — create issue
 *   GET  /api/issues/:id      — get issue
 *   PATCH /api/issues/:id     — update issue (status, priority, title, etc.)
 *   DELETE /api/issues/:id    — delete issue
 *   GET  /api/agents          — list agents (from runs + company state)
 *   GET  /api/agents/:id      — get agent detail
 *   GET  /api/budget/summary  — cost + token summary with alerts
 *   GET  /api/budget/settings — global budget limits
 *   PATCH /api/budget/settings — update global budget limits
 *   GET  /api/skills          — list reusable agent skills
 *   POST /api/skills          — create skill
 *   GET  /api/artifacts       — list agent-generated artifacts
 *   POST /api/artifacts       — save artifact
 *   GET  /api/wiki            — list wiki entries
 *   POST /api/wiki            — create entry
 *   GET  /api/review          — review queue items
 *   POST /api/review          — request a review
 *   GET  /api/org/members     — org members list
 *   GET  /api/org/stats       — org-level usage stats
 *   GET  /api/settings        — read persisted settings (no secrets returned)
 *   POST /api/settings        — save API keys, model, budget, governance
 */

import { existsSync } from "fs";
import { readFileSync } from "fs";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getDb, getRawDb, runMigrations, seedBuiltins } from "@setra/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { regenerateBrief } from "./clone/observer.js";
import { ensureTables } from "./db/schema.js";
import { startBrokerWakeSubscriptions } from "./lib/agent-wake.js";
import { applyKeysToEnv } from "./lib/company-settings.js";
import { startDispatcher } from "./lib/dispatcher.js";
import { startHeartbeatSweeper } from "./lib/heartbeat-sweeper.js";
import { createLogger } from "./lib/logger.js";
import { jobQueue } from "./lib/queue.js";
import { primeResumePackets } from "./lib/resume-packet-store.js";
import { registerRunQueueProcessor } from "./lib/run-orchestrator.js";
import { seedLocalSkillsCatalog } from "./lib/skills-catalog.js";
import { inputSanitizer } from "./middleware/input-sanitizer.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/request-logger.js";
import { requireAuth } from "./middleware/require-auth.js";
import { requireCompany } from "./middleware/require-company.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { activityRoute } from "./routes/activity.js";
import { agentBreakRoute } from "./routes/agent-break.js";
import { agentContextRoute } from "./routes/agent-context.js";
import { agentEventsRoute } from "./routes/agent-events.js";
import { agentsRoute } from "./routes/agents.js";
import { aiCeoRoute } from "./routes/ai-ceo.js";
import { approvalsRoute } from "./routes/approvals.js";
import artifactsRoute from "./routes/artifacts.js";
import { assistantToolsRoute } from "./routes/assistant.js";
import { authRoute } from "./routes/auth.js";
import { budgetRoute } from "./routes/budget.js";
import { cloneRoute } from "./routes/clone.js";
import { cliStatusRoute } from "./routes/cli-status.js";
import { analyticsRoute } from "./routes/analytics.js";
import { collaborationRoute } from "./routes/collaboration.js";
import { companiesRoute } from "./routes/companies.js";
import { companyRoute } from "./routes/company.js";
import { costsRoute } from "./routes/costs.js";
import { environmentsRoute } from "./routes/environments.js";
import { filesRoute } from "./routes/files.js";
import { goalsRoute } from "./routes/goals.js";
import { healthRoute } from "./routes/health.js";
import { inboxRoute } from "./routes/inbox.js";
import { instanceRoute } from "./routes/instance.js";
import { integrationsRoute } from "./routes/integrations.js";
import { issuesRoute } from "./routes/issues.js";
import { lanRoute } from "./routes/lan.js";
import { llmRoute } from "./routes/llm.js";
import { marketingRoute, publicMarketingRoute } from "./routes/marketing.js";
import { mcpRoute } from "./routes/mcp.js";
import orgRoute from "./routes/org.js";
import parseGoalRoute from "./routes/parse-goal.js";
import { plansRoute } from "./routes/plans.js";
import projectAgentsRoute from "./routes/project-agents.js";
import { projectContextRoute } from "./routes/project-context.js";
import { projectGitRoute } from "./routes/project-git.js";
import { projectSecretsRoute } from "./routes/project-secrets.js";
import { projectWorkspaceRoute } from "./routes/project-workspace.js";
import { projectsRoute } from "./routes/projects.js";
import reviewRoute from "./routes/review.js";
import { routinesRoute } from "./routes/routines.js";
import { runsRoute } from "./routes/runs.js";
import { runtimeRoute } from "./routes/runtime.js";
import searchRoute from "./routes/search.js";
import settingsRoute from "./routes/settings.js";
import skillsRoute from "./routes/skills.js";
import { webhooksRoute } from "./routes/webhooks.js";
import wikiRoute from "./routes/wiki.js";
import { workspacesRoute } from "./routes/workspaces.js";
import { sseRoute } from "./sse/handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const log = createLogger("server");

export async function createApp(
	options: {
		allowedOrigins?: string[];
		serveBoard?: boolean;
	} = {},
) {
	// Initialise @setra/db singleton so getRawDb() works in all route handlers
	const dataDir = process.env.SETRA_DATA_DIR ?? join(homedir(), ".setra");
	mkdirSync(dataDir, { recursive: true });
	const dbPath = join(dataDir, "setra.db");
	getDb({ dbPath, verbose: false });

	// Order matters. ensureTables() creates the server-local tables that the
	// drizzle migrations do not own (approvals, routines, agent_roster, ...).
	// Some migrations rebuild those tables to attach foreign keys, so the
	// tables must exist before the migrations run; otherwise a fresh install
	// would silently skip the rebuild and end up without the FK constraints.
	ensureTables();
	await runMigrations();
	seedBuiltins();

	seedLocalSkillsCatalog();
	const app = new Hono();

	app.use("*", logger());
	app.use(
		"*",
		cors({
			origin: [
				"http://localhost:5173",
				"http://127.0.0.1:5173",
				"http://localhost:3141",
				"setra://app",
				...(options.allowedOrigins ?? []),
				...(process.env.SETRA_ALLOWED_ORIGINS?.split(",") ?? []),
			],
			credentials: true,
		}),
	);
	app.use("*", rateLimit({ windowMs: 60_000, max: 120 }));
	app.use("*", securityHeaders());
	app.use("*", requestLogger());
	app.use("*", inputSanitizer());

	// SSE (real-time board events)

	// ── Public routes ────────────────────────────────────────────────────────
	app.route("/api/events", sseRoute);
	app.route("/api/auth", authRoute);
	app.route("/api/companies", companiesRoute);
	app.route("/api/llm", llmRoute);
	app.route("/api/runtime", runtimeRoute);
	app.route("/api/instance", instanceRoute);
	app.route("/api/lan", lanRoute);
	app.route("/api/clone", cloneRoute);
	app.route("/api/parse-goal", parseGoalRoute);
	app.route("/api/search", searchRoute);
	app.route("/api/health", healthRoute);
	app.route("/api/cli-status", cliStatusRoute);
	app.route("/api/webhooks", webhooksRoute);

	// ── Authenticated/scoped routes ─────────────────────────────────────────
	const authGuard = requireAuth();
	const scopedMounts = [
		"/api/projects/*",
		"/api/issues/*",
		"/api/agents/*",
		"/api/budget/*",
		"/api/collaboration/*",
		"/api/integrations/*",
		"/api/environments",
		"/api/environments/*",
		"/api/skills/*",
		"/api/artifacts/*",
		"/api/wiki/*",
		"/api/review/*",
		"/api/org/*",
		"/api/approvals/*",
		"/api/goals/*",
		"/api/plans/*",
		"/api/routines/*",
		"/api/inbox/*",
		"/api/activity/*",
		"/api/costs/*",
		"/api/company/*",
		"/api/workspaces/*",
		"/api/ai/*",
		"/api/assistant/*",
		"/api/settings/*",
		"/api/files/*",
		"/api/agent-events/*",
		"/api/mcp/*",
		"/api/project-agents/*",
		"/api/marketing",
		"/api/marketing/*",
	];
	for (const mount of scopedMounts) {
		app.use(mount, authGuard, requireCompany);
	}

	for (const mount of [
		"/api/clone",
		"/api/clone/*",
		"/api/parse-goal",
		"/api/search",
		"/api/search/*",
		"/api/instance/*",
		"/api/runs/*",
	]) {
		app.use(mount, authGuard);
	}

	app.use("/api/companies", async (c, next) => {
		if (c.req.method === "GET") return next();
		return authGuard(c, next);
	});
	app.use("/api/companies/*", authGuard, requireCompany);
	app.use("/api/llm/*", async (c, next) => {
		if (c.req.method === "GET" && c.req.path === "/api/llm/models") {
			return next();
		}
		return authGuard(c, next);
	});

	// LAN routes:
	//  - POST /api/lan/join-request and GET /api/lan/join-request/:id are public
	//    so peer Setra instances on the same Wi-Fi can hand off join requests
	//    without sharing credentials. Everything else requires auth + company.
	app.use("/api/lan/*", async (c, next) => {
		const path = c.req.path;
		const method = c.req.method;
		const isPublicHandshake =
			(method === "POST" && path === "/api/lan/join-request") ||
			(method === "GET" && path.startsWith("/api/lan/join-request/"));
		if (isPublicHandshake) return next();
		return authGuard(c, async () => {
			await requireCompany(c, next);
		});
	});

	app.route("/api/projects", projectsRoute);
	app.route("/api/projects", projectSecretsRoute);
	app.route("/api/projects", projectGitRoute);
	app.route("/api/projects", projectWorkspaceRoute);
	app.route("/api/projects", projectAgentsRoute);
	app.route("/api/project-agents", projectAgentsRoute);
	app.route("/api", projectContextRoute);
	app.route("/api", agentContextRoute);
	app.route("/api", agentBreakRoute);
	app.route("/api/issues", issuesRoute);
	app.route("/api/agents", agentsRoute);
	app.route("/api/budget", budgetRoute);
	app.route("/api/collaboration", collaborationRoute);
	app.route("/api/integrations", integrationsRoute);
	app.route("/api/environments", environmentsRoute);
	app.route("/api/skills", skillsRoute);
	app.route("/api/artifacts", artifactsRoute);
	app.route("/api/wiki", wikiRoute);
	app.route("/api/review", reviewRoute);
	app.route("/api/org", orgRoute);
	app.route("/api/approvals", approvalsRoute);
	app.route("/api/goals", goalsRoute);
	app.route("/api/plans", plansRoute);
	app.route("/api/routines", routinesRoute);
	app.route("/api/inbox", inboxRoute);
	app.route("/api/activity", activityRoute);
	app.route("/api/analytics", analyticsRoute);
	app.route("/api/costs", costsRoute);
	app.route("/api/company", companyRoute);
	app.route("/api/workspaces", workspacesRoute);
	app.route("/api/ai", aiCeoRoute);
	app.route("/api/assistant", assistantToolsRoute);
	app.route("/api/settings", settingsRoute);
	app.route("/api/files", filesRoute);
	app.route("/api/agent-events", agentEventsRoute);
	app.route("/api/mcp", mcpRoute);
	app.route("/api/runs", runsRoute);
	app.route("/api/marketing", marketingRoute);
	app.route("/api/public/marketing", publicMarketingRoute);

	// ─── Board UI static serving ──────────────────────────────────────────────────
	// When the built board assets exist, serve them as static files so that
	// `npx setra@latest start` works without a separate Vite dev server.
	// Build path resolution: dist/ is co-located with the server in the monorepo.
	if (options.serveBoard !== false) {
		const boardDist = resolve(__dirname, "../../board/dist");
		if (existsSync(join(boardDist, "index.html"))) {
			// Serve static assets (JS/CSS/fonts)
			app.use("/assets/*", serveStatic({ root: boardDist }));
			// Serve index.html for all non-API routes (SPA client-side routing)
			app.get("*", (c, next) => {
				if (c.req.path.startsWith("/api/")) return next();
				const html = readFileSync(join(boardDist, "index.html"), "utf-8");
				return c.html(html);
			});
		}
	}

	return app;
}

// ─── Start standalone server when run directly ────────────────────────────────
const isMain =
	process.argv[1] === __filename ||
	process.argv[1]?.endsWith("index.ts") ||
	import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
	const PORT = Number(process.env.SETRA_PORT ?? 3141);
	// Bind to 0.0.0.0 so other devices on the local Wi-Fi can reach this
	// instance for multi-developer collaboration. SETRA_BIND_HOST overrides
	// when an operator wants to lock it down to loopback only.
	const HOST = process.env.SETRA_BIND_HOST ?? "0.0.0.0";
	const app = await createApp();

	log.info("server listening", {
		host: HOST,
		port: PORT,
		url: `http://localhost:${PORT}`,
	});
	serve({ fetch: app.fetch, port: PORT, hostname: HOST });

	if (process.env.NODE_ENV !== "test") {
		registerRunQueueProcessor();
		startBrokerWakeSubscriptions();
		jobQueue.process("brief-regen", async (job) => {
			const companyId = String(job.payload.companyId ?? "default");
			return regenerateBrief(companyId);
		});
		startHeartbeatSweeper();
		startDispatcher();
		try {
			primeResumePackets();
		} catch (err) {
			log.warn("primeResumePackets failed", { err: String(err) });
		}

		// Start LAN browser unconditionally (passive listening — does not
		// announce). The broadcaster only starts for companies that have
		// opted into discoverability.
		try {
			const { startBrowser, startBroadcast } = await import(
				"./lib/lan-discovery.js"
			);
			startBrowser();
			const discoverable = getRawDb()
				.prepare(
					`SELECT id, name FROM companies WHERE lan_discoverable = 1`,
				)
				.all() as Array<{ id: string; name: string }>;
			for (const co of discoverable) {
				const owner = getRawDb()
					.prepare(
						`SELECT email FROM users WHERE company_id = ? AND role = 'owner'
						 ORDER BY created_at ASC LIMIT 1`,
					)
					.get(co.id) as { email: string } | undefined;
				startBroadcast({
					companyId: co.id,
					companyName: co.name,
					ownerEmail: owner?.email ?? "",
					port: PORT,
				});
				break; // bonjour-service supports one broadcast per process for now
			}
		} catch (err) {
			log.warn("lan-discovery start failed", { err: String(err) });
		}

		// Apply API keys from settings.json to process.env for all companies
		// so that /llm/status and server-runner can find them without requiring
		// a manual "Save" click in the UI after every restart.
		try {
			const companies = getRawDb()
				.prepare("SELECT id FROM companies")
				.all() as Array<{ id: string }>;
			for (const co of companies) applyKeysToEnv(co.id);
		} catch {
			/* best-effort */
		}
	}

	const enqueueCloneBriefRegeneration = () => {
		try {
			const companies = getRawDb()
				.prepare("SELECT id FROM companies")
				.all() as Array<{ id: string }>;
			const companyIds =
				companies.length > 0 ? companies.map((co) => co.id) : ["default"];
			for (const companyId of companyIds) {
				jobQueue.add(
					"brief-regen",
					{ companyId },
					{ priority: 3, maxAttempts: 2 },
				);
			}
		} catch {
			jobQueue.add(
				"brief-regen",
				{ companyId: "default" },
				{ priority: 3, maxAttempts: 2 },
			);
		}
	};

	setInterval(
		() => {
			enqueueCloneBriefRegeneration();
		},
		30 * 60 * 1000,
	);
	setTimeout(() => {
		enqueueCloneBriefRegeneration();
	}, 10_000);
}
