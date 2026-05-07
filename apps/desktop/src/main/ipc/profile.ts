import {
	loadProfile,
	saveProfile,
	updateProfile,
} from "@setra/core/user-profile.js";
import { ipcMain } from "electron";

export function registerProfileHandlers(): void {
	ipcMain.handle("profile:load", () => loadProfile());
	ipcMain.handle("profile:save", (_e, data) => {
		saveProfile(data);
		return { ok: true };
	});
	ipcMain.handle("profile:update", (_e, updates) => updateProfile(updates));
}
