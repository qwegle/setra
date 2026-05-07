import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_CWD = path.join(ROOT, "apps", "server");
const PORT = Number(process.env.SETRA_SLO_PORT ?? 33141);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs: number): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(HEALTH_URL);
			if (res.ok) return;
		} catch {
			/* retry */
		}
		await sleep(500);
	}
	throw new Error(`health check did not pass within ${timeoutMs}ms`);
}

function startServer(homeDir: string) {
	const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
		cwd: SERVER_CWD,
		env: {
			...process.env,
			HOME: homeDir,
			SETRA_PORT: String(PORT),
			NODE_ENV: "production",
		},
		stdio: "ignore",
	});
	return child;
}

async function main() {
	const homeDir = mkdtempSync(path.join(tmpdir(), "setra-restart-smoke-"));
	let child = startServer(homeDir);
	try {
		await waitForHealth(30_000);
		if (!child.pid) throw new Error("server pid missing");

		process.kill(child.pid, "SIGKILL");
		await sleep(1_500);

		child = startServer(homeDir);
		await waitForHealth(30_000);

		const res = await fetch(HEALTH_URL);
		if (!res.ok) throw new Error(`restart health status ${res.status}`);
		const body = (await res.json()) as { status?: string };
		if (body.status !== "ok")
			throw new Error(`unexpected health payload: ${JSON.stringify(body)}`);

		console.log("restart-recovery-smoke: PASS");
	} finally {
		if (child.pid) {
			try {
				process.kill(child.pid, "SIGTERM");
			} catch {
				/* noop */
			}
		}
		rmSync(homeDir, { recursive: true, force: true });
	}
}

void main().catch((err) => {
	console.error("restart-recovery-smoke: FAIL");
	console.error(err);
	process.exit(1);
});
