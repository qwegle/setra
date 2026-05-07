import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SetraInstance {
	id: string;
	name: string;
	socketPath?: string;
	host?: string;
	port?: number;
	projectDir?: string;
	isLocal: boolean;
	pid?: number;
	version?: string;
}

const setraHome = (): string => path.join(os.homedir(), ".setra");
const registryPath = (): string => path.join(setraHome(), "instances.json");
const activeInstancePath = (): string =>
	path.join(setraHome(), "active-instance");

export function readInstanceRegistry(): SetraInstance[] {
	const file = registryPath();
	if (!fs.existsSync(file)) return [];
	try {
		const raw = fs.readFileSync(file, "utf-8");
		return JSON.parse(raw) as SetraInstance[];
	} catch {
		return [];
	}
}

export function writeInstanceRegistry(instances: SetraInstance[]): void {
	fs.mkdirSync(setraHome(), { recursive: true });
	fs.writeFileSync(registryPath(), JSON.stringify(instances, null, 2), "utf-8");
}

export function registerInstance(inst: SetraInstance): void {
	const instances = readInstanceRegistry().filter((i) => i.id !== inst.id);
	instances.push(inst);
	writeInstanceRegistry(instances);
}

export function unregisterInstance(id: string): void {
	const instances = readInstanceRegistry().filter((i) => i.id !== id);
	writeInstanceRegistry(instances);
}

export function getActiveInstance(): SetraInstance | null {
	const file = activeInstancePath();
	if (!fs.existsSync(file)) return null;
	try {
		const id = fs.readFileSync(file, "utf-8").trim();
		return readInstanceRegistry().find((i) => i.id === id) ?? null;
	} catch {
		return null;
	}
}

export function setActiveInstance(id: string): void {
	fs.mkdirSync(setraHome(), { recursive: true });
	fs.writeFileSync(activeInstancePath(), id, "utf-8");
}
