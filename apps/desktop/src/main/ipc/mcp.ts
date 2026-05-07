import {
	addServer,
	discoverClaudeServers,
	getMcpManager,
	readMcpConfig,
	removeServer,
} from "@setra/mcp";
import type { McpServerConfig, McpServerState } from "@setra/mcp";
import { BrowserWindow, ipcMain } from "electron";

function broadcastStateChanged(states: McpServerState[]): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send("mcp:state-changed", states);
		}
	}
}

export function registerMcpHandlers(): void {
	const manager = getMcpManager();

	// Push state changes to all renderer windows
	manager.on("state-changed", (states: McpServerState[]) => {
		broadcastStateChanged(states);
	});

	ipcMain.handle("mcp:list", (): McpServerState[] => {
		return manager.getAllStates();
	});

	ipcMain.handle("mcp:add", async (_e, rawInput: unknown): Promise<void> => {
		const config = rawInput as McpServerConfig;
		addServer(config);
		manager.registerConfig(config);
		if (config.autoStart) {
			await manager.start(config.id);
		}
	});

	ipcMain.handle("mcp:remove", async (_e, rawInput: unknown): Promise<void> => {
		const { id } = rawInput as { id: string };
		try {
			await manager.stop(id);
		} catch {
			// attempt stop
		}
		removeServer(id);
		manager.unregisterConfig(id);
	});

	ipcMain.handle("mcp:start", async (_e, rawInput: unknown): Promise<void> => {
		const { id } = rawInput as { id: string };
		await manager.start(id);
	});

	ipcMain.handle("mcp:stop", async (_e, rawInput: unknown): Promise<void> => {
		const { id } = rawInput as { id: string };
		await manager.stop(id);
	});

	ipcMain.handle("mcp:discoverClaude", (): McpServerConfig[] => {
		return discoverClaudeServers();
	});

	ipcMain.handle(
		"mcp:callTool",
		async (_e, rawInput: unknown): Promise<unknown> => {
			const { serverId, toolName, args } = rawInput as {
				serverId: string;
				toolName: string;
				args: Record<string, unknown>;
			};
			return manager.callTool(serverId, toolName, args);
		},
	);

	// Load any persisted configs that weren't auto-started into manager state
	const persistedConfigs = readMcpConfig();
	for (const config of persistedConfigs) {
		manager.registerConfig(config);
	}
}
