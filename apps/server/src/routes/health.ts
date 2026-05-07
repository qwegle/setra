/**
 * Health route — GET /api/health
 *
 * Returns system health snapshot (CPU, RAM, uptime) and
 * supports triggering garbage collection to reclaim memory.
 *
 *   GET  /api/health            → { system, process, os }
 *   GET  /api/health/processes  → top processes by memory
 *   POST /api/health/gc         → triggers GC if available, returns freed memory
 */

import { execSync } from "node:child_process";
import os from "node:os";
import { Hono } from "hono";

export const healthRoute = new Hono();

healthRoute.get("/", (c) => {
	const mem = process.memoryUsage();
	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const usedMem = totalMem - freeMem;

	// CPU load averages (1, 5, 15 min)
	const loadAvg = os.loadavg();
	const cpuCount = os.cpus().length;

	return c.json({
		system: {
			cpuCount,
			loadAvg1m: Math.round(loadAvg[0]! * 100) / 100,
			loadAvg5m: Math.round(loadAvg[1]! * 100) / 100,
			loadAvg15m: Math.round(loadAvg[2]! * 100) / 100,
			cpuPercent: Math.round((loadAvg[0]! / cpuCount) * 100),
			ramTotalMb: Math.round(totalMem / 1024 / 1024),
			ramUsedMb: Math.round(usedMem / 1024 / 1024),
			ramFreeMb: Math.round(freeMem / 1024 / 1024),
			ramPercent: Math.round((usedMem / totalMem) * 100),
		},
		process: {
			pid: process.pid,
			rssMb: Math.round(mem.rss / 1024 / 1024),
			heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
			heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
			externalMb: Math.round(mem.external / 1024 / 1024),
			arrayBuffersMb: Math.round((mem.arrayBuffers ?? 0) / 1024 / 1024),
			uptimeSeconds: Math.round(process.uptime()),
		},
		os: {
			platform: os.platform(),
			arch: os.arch(),
			hostname: os.hostname(),
			uptimeSeconds: Math.round(os.uptime()),
			nodeVersion: process.version,
		},
		timestamp: Date.now(),
	});
});

healthRoute.get("/processes", (c) => {
	try {
		const isDarwin = os.platform() === "darwin";
		const cmd = isDarwin
			? "ps -eo pid,pcpu,pmem,rss,comm -r | head -21"
			: "ps -eo pid,pcpu,pmem,rss,comm --sort=-rss | head -21";
		const raw = execSync(cmd, { encoding: "utf-8", timeout: 5000 });
		const lines = raw.trim().split("\n");
		const header = lines[0];
		const rows = lines.slice(1).map((line) => {
			const parts = line.trim().split(/\s+/);
			const pid = Number(parts[0]);
			const cpu = Number.parseFloat(parts[1] ?? "0");
			const mem = Number.parseFloat(parts[2] ?? "0");
			const rssMb = Math.round((Number(parts[3] ?? "0") / 1024) * 10) / 10;
			const name = parts.slice(4).join(" ");
			return { pid, cpu, mem, rssMb, name };
		});
		return c.json({ header, processes: rows });
	} catch {
		return c.json({ header: "", processes: [] });
	}
});

healthRoute.post("/gc", (c) => {
	const before = process.memoryUsage();

	// Attempt garbage collection if --expose-gc flag was used
	if (typeof globalThis.gc === "function") {
		globalThis.gc();
	}

	const after = process.memoryUsage();
	const freedMb = Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024);

	return c.json({
		gcAvailable: typeof globalThis.gc === "function",
		freedMb: Math.max(0, freedMb),
		before: {
			rssMb: Math.round(before.rss / 1024 / 1024),
			heapUsedMb: Math.round(before.heapUsed / 1024 / 1024),
		},
		after: {
			rssMb: Math.round(after.rss / 1024 / 1024),
			heapUsedMb: Math.round(after.heapUsed / 1024 / 1024),
		},
	});
});
