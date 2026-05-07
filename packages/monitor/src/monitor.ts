import { sampleCpuPercent, sampleRam } from "./system.js";
import { queryTokenStats } from "./tokens.js";
import type { MonitorSnapshot } from "./types.js";

export class MonitorService {
	private readonly intervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private lastSnapshot: MonitorSnapshot | null = null;
	private readonly listeners = new Set<(snap: MonitorSnapshot) => void>();

	constructor(intervalMs = 2000) {
		this.intervalMs = intervalMs;
	}

	start(): void {
		if (this.timer !== null) return;
		void this.poll();
		this.timer = setInterval(() => {
			void this.poll();
		}, this.intervalMs);
	}

	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	getSnapshot(): MonitorSnapshot | null {
		return this.lastSnapshot;
	}

	subscribe(fn: (snap: MonitorSnapshot) => void): () => void {
		this.listeners.add(fn);
		if (this.lastSnapshot !== null) fn(this.lastSnapshot);
		return () => {
			this.listeners.delete(fn);
		};
	}

	private async poll(): Promise<void> {
		try {
			const cpuPercent = await sampleCpuPercent();
			const ram = sampleRam();
			const tokens = queryTokenStats();

			const snap: MonitorSnapshot = {
				system: {
					cpuPercent,
					ramUsedMb: ram.usedMb,
					ramTotalMb: ram.totalMb,
					ramPercent: ram.percent,
					processRamMb: ram.processMb,
				},
				tokens,
				timestamp: Date.now(),
			};

			this.lastSnapshot = snap;
			this.listeners.forEach((fn) => fn(snap));
		} catch {
			// swallow errors — monitor should never crash the host
		}
	}
}

let _instance: MonitorService | null = null;

export function getMonitorService(): MonitorService {
	if (_instance === null) _instance = new MonitorService();
	return _instance;
}
