import {
	INTEGRATIONS,
	loadIntegrationConfigs,
	removeIntegrationConfig,
	saveIntegrationConfig,
	testIntegration,
} from "@setra/core/integrations.js";
import type { IntegrationConfig } from "@setra/core/integrations.js";
import { ipcMain } from "electron";

export function registerIntegrationsHandlers(): void {
	// integrations:list — returns all integrations with their current config/status
	ipcMain.handle("integrations:list", () => {
		const configs = loadIntegrationConfigs();
		return INTEGRATIONS.map((integration) => ({
			...integration,
			config: configs[integration.id] ?? null,
		}));
	});

	// integrations:save — save (or update) an integration config
	ipcMain.handle("integrations:save", (_e, config: IntegrationConfig) => {
		saveIntegrationConfig(config);
		return { ok: true };
	});

	// integrations:remove — disconnect an integration
	ipcMain.handle("integrations:remove", (_e, integrationId: string) => {
		removeIntegrationConfig(integrationId);
		return { ok: true };
	});

	// integrations:test — test connectivity for an integration
	ipcMain.handle(
		"integrations:test",
		async (_e, integrationId: string, values: Record<string, string>) => {
			const integration = INTEGRATIONS.find((i) => i.id === integrationId);
			if (!integration) return { ok: false, message: "Unknown integration" };
			return testIntegration(integration, values);
		},
	);
}
