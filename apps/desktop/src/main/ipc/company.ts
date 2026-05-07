/**
 * Company IPC handlers — bridges the Electron renderer to the TeamBroker HTTP API.
 *
 * Broker port registry: when a company run starts (notifyRenderer fires
 * "company:run-started"), the launcher registers the run here so the renderer
 * can later look up the broker URL without hard-coding ports.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { ipcMain } from "electron";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory broker registry: companyRunId → { port, token }
// The CompanyLauncher calls registerCompanyRun() via notifyRenderer.
// ─────────────────────────────────────────────────────────────────────────────

interface BrokerEntry {
	port: number;
	token: string;
}

const brokerRegistry = new Map<string, BrokerEntry>();

export function registerCompanyRun(
	runId: string,
	port: number,
	token: string,
): void {
	brokerRegistry.set(runId, { port, token });
}

export function unregisterCompanyRun(runId: string): void {
	brokerRegistry.delete(runId);
}

function getBrokerEntry(runId: string): BrokerEntry | null {
	return brokerRegistry.get(runId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────────────────────

export function registerCompanyHandlers(): void {
	// company:get-broker-url → string | null
	// Renderer calls this to get the base URL it should open EventSource against.
	ipcMain.handle("company:get-broker-url", (_event, runId: string) => {
		const entry = getBrokerEntry(runId);
		if (!entry) return null;
		return `http://localhost:${entry.port}`;
	});

	// company:get-broker-port → number | null
	ipcMain.handle("company:get-broker-port", (_event, runId: string) => {
		const entry = getBrokerEntry(runId);
		return entry?.port ?? null;
	});

	// company:get-activity → AgentActivitySnapshot[]
	ipcMain.handle("company:get-activity", async (_event, runId: string) => {
		const entry = getBrokerEntry(runId);
		if (!entry) return [];
		const url = `http://localhost:${entry.port}/agent-activity`;
		const resp = await fetch(url, {
			headers: { Authorization: `Bearer ${entry.token}` },
		});
		if (!resp.ok) return [];
		const json = (await resp.json()) as { activity: unknown[] };
		return json.activity ?? [];
	});

	// company:post-message → PostMessageResponse
	ipcMain.handle(
		"company:post-message",
		async (_event, runId: string, msg: Record<string, unknown>) => {
			const entry = getBrokerEntry(runId);
			if (!entry) throw new Error(`No active broker for run ${runId}`);
			const resp = await fetch(`http://localhost:${entry.port}/messages`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${entry.token}`,
				},
				body: JSON.stringify(msg),
			});
			if (!resp.ok)
				throw new Error(`Broker POST /messages failed: ${resp.status}`);
			return resp.json();
		},
	);

	// company:get-messages → GetMessagesResponse
	ipcMain.handle(
		"company:get-messages",
		async (_event, runId: string, channel = "general", sinceId?: string) => {
			const entry = getBrokerEntry(runId);
			if (!entry) return { messages: [], taggedCount: 0 };
			const params = new URLSearchParams({ channel, limit: "50" });
			if (sinceId) params.set("since_id", sinceId);
			const resp = await fetch(
				`http://localhost:${entry.port}/messages?${params.toString()}`,
				{ headers: { Authorization: `Bearer ${entry.token}` } },
			);
			if (!resp.ok) return { messages: [], taggedCount: 0 };
			return resp.json();
		},
	);

	const companiesDir = join(homedir(), ".setra", "companies");

	ipcMain.handle("company:list-templates", () => {
		return [
			{
				id: "starter",
				name: "Starter Team",
				description: "CEO + Engineer + GTM Lead",
				category: "engineering",
				memberCount: 3,
				totalCostBudgetUsd: 5,
				tags: ["starter"],
			},
			{
				id: "founding-team",
				name: "Full Founding Team",
				description: "8-agent full founding team",
				category: "engineering",
				memberCount: 8,
				totalCostBudgetUsd: 20,
				tags: ["founding"],
			},
			{
				id: "gtm-sales",
				name: "GTM & Sales Machine",
				description: "Full GTM and sales pipeline team",
				category: "gtm",
				memberCount: 5,
				totalCostBudgetUsd: 10,
				tags: ["gtm", "sales"],
			},
			{
				id: "code-review",
				name: "Code Review Squad",
				description: "Tech lead + security + QA + docs",
				category: "engineering",
				memberCount: 4,
				totalCostBudgetUsd: 10,
				tags: ["review"],
			},
			{
				id: "governance-onprem",
				name: "Governance / On-Premise",
				description: "All local models, no cloud API keys needed",
				category: "governance",
				memberCount: 4,
				totalCostBudgetUsd: 0,
				tags: ["governance", "local"],
			},
			{
				id: "support-team",
				name: "Customer Support Team",
				description: "L1, L2, and KB writer",
				category: "support",
				memberCount: 4,
				totalCostBudgetUsd: 8,
				tags: ["support"],
			},
			{
				id: "research",
				name: "Research & Analysis Team",
				description:
					"Research lead + data analyst + lit reviewer + report writer",
				category: "research",
				memberCount: 4,
				totalCostBudgetUsd: 15,
				tags: ["research"],
			},
		];
	});

	ipcMain.handle("company:save", (_event, company: Record<string, unknown>) => {
		if (!existsSync(companiesDir)) mkdirSync(companiesDir, { recursive: true });
		const name = String(company.name ?? "unnamed")
			.replace(/[^a-z0-9-_]/gi, "-")
			.toLowerCase();
		const filePath = join(companiesDir, `${name}.json`);
		writeFileSync(
			filePath,
			JSON.stringify(
				{ ...company, savedAt: new Date().toISOString() },
				null,
				2,
			),
		);
	});

	ipcMain.handle("company:list", () => {
		if (!existsSync(companiesDir)) return [];
		const files = readdirSync(companiesDir).filter((f) => f.endsWith(".json"));
		return files
			.map((f) => {
				try {
					const data = JSON.parse(
						readFileSync(join(companiesDir, f), "utf8"),
					) as Record<string, unknown>;
					return data;
				} catch {
					return null;
				}
			})
			.filter(Boolean);
	});

	ipcMain.handle("company:delete", (_event, name: string) => {
		const safeName = name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
		const filePath = join(companiesDir, `${safeName}.json`);
		if (existsSync(filePath)) unlinkSync(filePath);
	});
}
