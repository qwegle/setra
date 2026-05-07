import {
	type InstallEvent,
	OfflineError,
	SECURITY_TOOLS,
	checkAllTools,
	checkInternet,
	detectPackageManager,
	installTool,
} from "@setra/security";
import { ipcMain } from "electron";

export function registerSecurityToolHandlers(): void {
	// List all tools with their current install status
	ipcMain.handle("security-tools:list", async () => {
		const statuses = await checkAllTools();
		const pm = detectPackageManager();
		const online = await checkInternet();
		return {
			tools: SECURITY_TOOLS.map((t) => ({
				...t,
				...statuses[t.id],
			})),
			packageManager: pm,
			online,
		};
	});

	// Install a specific tool — streams InstallEvents back via webContents.send
	ipcMain.handle("security-tools:install", async (event, toolId: string) => {
		const tool = SECURITY_TOOLS.find((t) => t.id === toolId);
		if (!tool) return { error: `Unknown tool: ${toolId}` };

		try {
			await installTool(
				tool,
				(evt: InstallEvent) => {
					if (!event.sender.isDestroyed()) {
						event.sender.send(`security-tools:install-event:${toolId}`, evt);
					}
				},
				(_id, _cmd) => Promise.resolve(true), // confirmed by user clicking "Install" in UI
			);
			return { success: true };
		} catch (err) {
			const message =
				err instanceof OfflineError
					? err.message
					: `Installation failed: ${(err as Error).message}`;
			return { error: message };
		}
	});

	// Install ALL not-yet-installed tools sequentially
	ipcMain.handle("security-tools:install-all", async (event) => {
		const statuses = await checkAllTools();
		const online = await checkInternet();
		if (!online) {
			if (!event.sender.isDestroyed()) {
				event.sender.send("security-tools:install-all-event", {
					type: "offline-error",
					message: "Cannot install — no internet connection.",
				});
			}
			return;
		}
		for (const tool of SECURITY_TOOLS) {
			if (!statuses[tool.id]?.installed && tool.license !== "freemium") {
				await installTool(
					tool,
					(evt) => {
						if (!event.sender.isDestroyed()) {
							event.sender.send("security-tools:install-all-event", {
								toolId: tool.id,
								...evt,
							});
						}
					},
					(_id, _cmd) => Promise.resolve(true),
				).catch(() => {
					/* continue with next tool */
				});
			}
		}
		if (!event.sender.isDestroyed()) {
			event.sender.send("security-tools:install-all-event", {
				type: "all-done",
			});
		}
	});

	// Check single tool status
	ipcMain.handle("security-tools:check", async (_event, toolId: string) => {
		const tool = SECURITY_TOOLS.find((t) => t.id === toolId);
		if (!tool) return { installed: false };
		const { checkToolStatus } = await import("@setra/security");
		return checkToolStatus(tool);
	});
}
