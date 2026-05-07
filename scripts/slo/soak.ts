import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_CWD = path.join(ROOT, "apps", "server");

function getArg(name: string, fallback: string): string {
	const match = process.argv.find((a) => a.startsWith(`--${name}=`));
	return match ? match.slice(name.length + 3) : fallback;
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[idx] ?? 0;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

function rssKb(pid: number): number {
	try {
		const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
			encoding: "utf-8",
		}).trim();
		const parsed = Number(out);
		return Number.isFinite(parsed) ? parsed : 0;
	} catch {
		return 0;
	}
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			/* retry */
		}
		await sleep(500);
	}
	throw new Error(`health check did not pass within ${timeoutMs}ms`);
}

async function main() {
	const durationSec = Number(getArg("duration-sec", "600"));
	const intervalMs = Number(getArg("interval-ms", "1000"));
	const port = Number(getArg("port", "33142"));
	const output = getArg("output", path.join("benchmark-results", "soak.json"));
	const healthUrl = `http://127.0.0.1:${port}/api/health`;

	const homeDir = mkdtempSync(path.join(tmpdir(), "setra-soak-"));
	const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
		cwd: SERVER_CWD,
		env: {
			...process.env,
			HOME: homeDir,
			SETRA_PORT: String(port),
			NODE_ENV: "production",
		},
		stdio: "ignore",
	});

	if (!child.pid) {
		throw new Error("failed to start server for soak");
	}

	const startedAt = new Date().toISOString();
	const latencies: number[] = [];
	let total = 0;
	let success = 0;
	let failures = 0;
	let maxRssKb = 0;

	try {
		await waitForHealth(healthUrl, 30_000);
		const rssStartKb = rssKb(child.pid);
		maxRssKb = rssStartKb;
		const deadline = Date.now() + durationSec * 1000;

		while (Date.now() < deadline) {
			const t0 = performance.now();
			total++;
			try {
				const res = await fetch(healthUrl);
				const dt = performance.now() - t0;
				latencies.push(dt);
				if (res.ok) success++;
				else failures++;
			} catch {
				failures++;
			}
			maxRssKb = Math.max(maxRssKb, rssKb(child.pid));
			await sleep(intervalMs);
		}

		const rssEndKb = rssKb(child.pid);
		const p95Ms = percentile(latencies, 95);
		const availabilityPct = total > 0 ? (success / total) * 100 : 0;
		const errorRatePct = total > 0 ? (failures / total) * 100 : 0;
		const memoryGrowthPct =
			rssStartKb > 0 ? ((rssEndKb - rssStartKb) / rssStartKb) * 100 : 0;

		mkdirSync(path.dirname(output), { recursive: true });
		writeFileSync(
			output,
			JSON.stringify(
				{
					startedAt,
					finishedAt: new Date().toISOString(),
					durationSec,
					intervalMs,
					totalRequests: total,
					successRequests: success,
					failedRequests: failures,
					availabilityPct,
					errorRatePct,
					p95Ms,
					rssStartKb,
					rssEndKb,
					maxRssKb,
					memoryGrowthPct,
				},
				null,
				2,
			),
		);

		console.log(`soak: PASS wrote ${output}`);
	} finally {
		try {
			process.kill(child.pid, "SIGTERM");
		} catch {
			/* noop */
		}
		rmSync(homeDir, { recursive: true, force: true });
	}
}

void main().catch((err) => {
	console.error("soak: FAIL");
	console.error(err);
	process.exit(1);
});
