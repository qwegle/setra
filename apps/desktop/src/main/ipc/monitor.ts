import { getMonitorService } from "@setra/monitor";
import type { MonitorSnapshot } from "@setra/monitor";
import { ipcMain } from "electron";
import type { WebContents } from "electron";

const subscriptions = new Map<number, () => void>();

export function registerMonitorHandlers(): void {
	ipcMain.handle("monitor:stats", () => getMonitorService().getSnapshot());

	ipcMain.handle("monitor:subscribe", (event) => {
		const wc: WebContents = event.sender;
		const id = wc.id;

		// Clean up any existing subscription for this window
		subscriptions.get(id)?.();

		const unsub = getMonitorService().subscribe((snap: MonitorSnapshot) => {
			if (!wc.isDestroyed()) {
				wc.send("monitor:snapshot", snap);
			}
		});

		subscriptions.set(id, unsub);

		wc.once("destroyed", () => {
			unsub();
			subscriptions.delete(id);
		});
	});

	ipcMain.handle("monitor:unsubscribe", (event) => {
		const id = event.sender.id;
		subscriptions.get(id)?.();
		subscriptions.delete(id);
	});
}
