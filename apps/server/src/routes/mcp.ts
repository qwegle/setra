import { zValidator } from "@hono/zod-validator";
import {
	type McpServerConfig,
	addServer,
	discoverClaudeServers,
	getMcpManager,
	readMcpConfig,
	removeServer,
	updateServer,
} from "@setra/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";

export const mcpRoute = new Hono();

const CreateServerSchema = z.object({
	id: z.string().min(1).optional(),
	name: z.string().min(1),
	transport: z.enum(["stdio", "sse", "http"]),
	command: z.string().min(1).optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
	url: z.string().url().optional(),
	autoStart: z.boolean().optional(),
	description: z.string().optional(),
});

const UpdateServerSchema = z
	.object({
		name: z.string().min(1).optional(),
		transport: z.enum(["stdio", "sse", "http"]).optional(),
		command: z.string().min(1).optional(),
		args: z.array(z.string()).optional(),
		env: z.record(z.string()).optional(),
		url: z.string().url().optional(),
		autoStart: z.boolean().optional(),
		description: z.string().optional(),
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: "at least one field is required",
	});

const CallToolSchema = z.object({
	tool: z.string().min(1),
	args: z.record(z.unknown()).default({}),
});

function getManager(companyId: string) {
	return getMcpManager(companyId);
}

function listServers(companyId: string): McpServerConfig[] {
	return readMcpConfig(companyId);
}

function getServerConfig(
	id: string,
	companyId: string,
): McpServerConfig | undefined {
	return listServers(companyId).find((server) => server.id === id);
}

async function rebindServer(
	companyId: string,
	config: McpServerConfig,
	shouldStart: boolean,
) {
	const mcpManager = getManager(companyId);
	await mcpManager.stop(config.id).catch(() => undefined);
	mcpManager.unregisterConfig(config.id);
	mcpManager.registerConfig(config);
	if (shouldStart) {
		await mcpManager.start(config.id);
	}
}

mcpRoute.get("/servers", (c) => {
	try {
		const companyId = getCompanyId(c);
		const states = new Map(
			getManager(companyId)
				.getAllStates()
				.map((state) => [state.config.id, state] as const),
		);
		const servers = listServers(companyId).map((config) => {
			const state = states.get(config.id);
			return state
				? { ...state, config }
				: { config, status: "stopped" as const, tools: [] };
		});
		return c.json({ servers });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "failed to list MCP servers",
			},
			500,
		);
	}
});

mcpRoute.post("/servers", zValidator("json", CreateServerSchema), async (c) => {
	try {
		const companyId = getCompanyId(c);
		const body = c.req.valid("json");
		const config: McpServerConfig = {
			id: body.id ?? crypto.randomUUID(),
			name: body.name,
			transport: body.transport,
			autoStart: body.autoStart ?? false,
		};
		if (body.command !== undefined) config.command = body.command;
		if (body.args !== undefined) config.args = body.args;
		if (body.env !== undefined) config.env = body.env;
		if (body.url !== undefined) config.url = body.url;
		if (body.description !== undefined) config.description = body.description;

		addServer(config, companyId);
		getManager(companyId).registerConfig(config);
		if (config.autoStart) {
			await getManager(companyId).start(config.id);
		}
		await logActivity(c, "mcp.server.created", "mcp_server", config.id, {
			name: config.name,
			transport: config.transport,
			autoStart: config.autoStart,
		});
		return c.json({ server: getManager(companyId).getState(config.id) }, 201);
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "failed to add MCP server",
			},
			500,
		);
	}
});

mcpRoute.put(
	"/servers/:id",
	zValidator("json", UpdateServerSchema),
	async (c) => {
		try {
			const companyId = getCompanyId(c);
			const id = c.req.param("id");
			const existing = getServerConfig(id, companyId);
			if (!existing) return c.json({ error: "server not found" }, 404);

			const body = c.req.valid("json");
			const updates: Partial<McpServerConfig> = {};
			if (body.name !== undefined) updates.name = body.name;
			if (body.transport !== undefined) updates.transport = body.transport;
			if (body.command !== undefined) updates.command = body.command;
			if (body.args !== undefined) updates.args = body.args;
			if (body.env !== undefined) updates.env = body.env;
			if (body.url !== undefined) updates.url = body.url;
			if (body.autoStart !== undefined) updates.autoStart = body.autoStart;
			if (body.description !== undefined)
				updates.description = body.description;
			const mcpManager = getManager(companyId);
			const currentState = mcpManager
				.getAllStates()
				.find((state) => state.config.id === id);
			const nextConfig: McpServerConfig = { ...existing, ...updates, id };
			updateServer(id, updates, companyId);
			await rebindServer(
				companyId,
				nextConfig,
				currentState?.status === "connected" || nextConfig.autoStart,
			);
			await logActivity(c, "mcp.server.updated", "mcp_server", id, {
				name: nextConfig.name,
				transport: nextConfig.transport,
				autoStart: nextConfig.autoStart,
			});
			return c.json({ server: mcpManager.getState(id) });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error
							? error.message
							: "failed to update MCP server",
				},
				500,
			);
		}
	},
);

mcpRoute.delete("/servers/:id", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const id = c.req.param("id");
		const existing = getServerConfig(id, companyId);
		if (!existing) return c.json({ error: "server not found" }, 404);
		removeServer(id, companyId);
		await getManager(companyId)
			.stop(id)
			.catch(() => undefined);
		getManager(companyId).unregisterConfig(id);
		await logActivity(c, "mcp.server.deleted", "mcp_server", id, {
			name: existing.name,
		});
		return c.json({ deleted: true });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "failed to remove MCP server",
			},
			500,
		);
	}
});

mcpRoute.post("/servers/:id/start", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const id = c.req.param("id");
		const existing = getServerConfig(id, companyId);
		if (!existing) return c.json({ error: "server not found" }, 404);
		await getManager(companyId).start(id);
		await logActivity(c, "mcp.server.started", "mcp_server", id, {
			name: existing.name,
		});
		return c.json({ server: getManager(companyId).getState(id) });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "failed to start MCP server",
			},
			500,
		);
	}
});

mcpRoute.post("/servers/:id/stop", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const id = c.req.param("id");
		const existing = getServerConfig(id, companyId);
		if (!existing) return c.json({ error: "server not found" }, 404);
		await getManager(companyId).stop(id);
		await logActivity(c, "mcp.server.stopped", "mcp_server", id, {
			name: existing.name,
		});
		return c.json({ server: getManager(companyId).getState(id) });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "failed to stop MCP server",
			},
			500,
		);
	}
});

mcpRoute.get("/servers/:id/tools", (c) => {
	try {
		const companyId = getCompanyId(c);
		const id = c.req.param("id");
		const existing = getServerConfig(id, companyId);
		if (!existing) return c.json({ error: "server not found" }, 404);
		return c.json({ tools: getManager(companyId).getState(id).tools });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : "failed to list MCP tools",
			},
			500,
		);
	}
});

mcpRoute.post(
	"/servers/:id/call",
	zValidator("json", CallToolSchema),
	async (c) => {
		try {
			const companyId = getCompanyId(c);
			const id = c.req.param("id");
			const existing = getServerConfig(id, companyId);
			if (!existing) return c.json({ error: "server not found" }, 404);
			const body = c.req.valid("json");
			const result = await getManager(companyId).callTool(
				id,
				body.tool,
				body.args,
			);
			await logActivity(c, "mcp.tool.called", "mcp_server", id, {
				tool: body.tool,
			});
			return c.json({ result });
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "failed to call MCP tool",
				},
				500,
			);
		}
	},
);

mcpRoute.post("/discover", (c) => {
	try {
		return c.json({ servers: discoverClaudeServers() });
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error
						? error.message
						: "failed to discover MCP servers",
			},
			500,
		);
	}
});
