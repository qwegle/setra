import * as os from "node:os";

export async function sampleCpuPercent(): Promise<number> {
	const sample1 = os.cpus();
	await new Promise<void>((resolve) => setTimeout(resolve, 500));
	const sample2 = os.cpus();

	let totalIdle = 0;
	let totalTick = 0;

	for (let i = 0; i < sample1.length; i++) {
		const c1 = sample1[i];
		const c2 = sample2[i];
		if (!c1 || !c2) continue;
		const idle = c2.times.idle - c1.times.idle;
		const total1 =
			c1.times.user +
			c1.times.nice +
			c1.times.sys +
			c1.times.idle +
			c1.times.irq;
		const total2 =
			c2.times.user +
			c2.times.nice +
			c2.times.sys +
			c2.times.idle +
			c2.times.irq;
		totalIdle += idle;
		totalTick += total2 - total1;
	}

	if (totalTick === 0) return 0;
	return Math.min(
		100,
		Math.max(0, Math.round((1 - totalIdle / totalTick) * 100)),
	);
}

export function sampleRam(): {
	usedMb: number;
	totalMb: number;
	percent: number;
	processMb: number;
} {
	const totalBytes = os.totalmem();
	const freeBytes = os.freemem();
	const usedBytes = totalBytes - freeBytes;
	const totalMb = totalBytes / (1024 * 1024);
	const usedMb = usedBytes / (1024 * 1024);
	const percent = (usedMb / totalMb) * 100;
	const processMb = process.memoryUsage().rss / (1024 * 1024);
	return { usedMb, totalMb, percent, processMb };
}
