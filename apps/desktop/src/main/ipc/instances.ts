import http from "node:http";
import {
	getActiveInstance,
	readInstanceRegistry,
	registerInstance,
	setActiveInstance,
	unregisterInstance,
} from "@setra/shared";
import type { SetraInstance } from "@setra/shared";
import { ipcMain } from "electron";

function pingInstance(inst: SetraInstance): Promise<boolean> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => resolve(false), 2000);

		const options = inst.host
			? {
					host: inst.host,
					port: inst.port ?? 7820,
					path: "/status",
					method: "GET",
				}
			: { socketPath: inst.socketPath, path: "/status", method: "GET" };

		try {
			const req = http.request(options, (res) => {
				clearTimeout(timeout);
				resolve(res.statusCode === 200);
				res.resume();
			});
			req.on("error", () => {
				clearTimeout(timeout);
				resolve(false);
			});
			req.end();
		} catch {
			clearTimeout(timeout);
			resolve(false);
		}
	});
}

export function registerInstancesHandlers(): void {
	ipcMain.handle("instances:list", async () => {
		const instances = readInstanceRegistry();
		const results = await Promise.all(
			instances.map(async (inst) => ({
				...inst,
				alive: await pingInstance(inst),
			})),
		);
		return results;
	});

	ipcMain.handle("instances:connect", (_event, { id }: { id: string }) => {
		setActiveInstance(id);
	});

	ipcMain.handle("instances:get-active", () => {
		return getActiveInstance();
	});

	ipcMain.handle(
		"instances:add",
		(
			_event,
			{ name, host, port }: { name: string; host: string; port: number },
		) => {
			const inst: SetraInstance = {
				id: crypto.randomUUID(),
				name,
				host,
				port,
				isLocal: false,
			};
			registerInstance(inst);
			return inst;
		},
	);

	ipcMain.handle("instances:remove", (_event, { id }: { id: string }) => {
		unregisterInstance(id);
	});
}
