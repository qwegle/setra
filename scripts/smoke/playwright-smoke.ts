/**
 * Setra smoke test: drives a real Chromium against the running board and
 * server to confirm the dev environment is usable end-to-end.
 *
 * Asserts server health, marketing route mounting, auth gating, and that
 * the board renders without page errors. Run after the dev servers are up.
 */

import { chromium } from "playwright";

const BOARD = process.env["BOARD_URL"] ?? "http://localhost:5173";
const SERVER = process.env["SERVER_URL"] ?? "http://localhost:3141";

interface Result {
	name: string;
	ok: boolean;
	detail?: string;
}

const results: Result[] = [];
const record = (name: string, ok: boolean, detail?: string) => {
	results.push(detail ? { name, ok, detail } : { name, ok });
	const tag = ok ? "PASS" : "FAIL";
	console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
	{
		const res = await fetch(`${SERVER}/api/health`);
		record("server /api/health 200", res.status === 200, `status=${res.status}`);
	}

	{
		const res = await fetch(`${SERVER}/api/public/marketing/landing/__nope__`);
		record(
			"public marketing landing route mounted",
			res.status === 404,
			`status=${res.status}`,
		);
	}

	{
		const res = await fetch(`${SERVER}/api/marketing/leads`);
		record(
			"marketing leads requires auth",
			res.status === 401 || res.status === 403,
			`status=${res.status}`,
		);
	}

	const browser = await chromium.launch();
	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => pageErrors.push(e.message));

	try {
		const resp = await page.goto(BOARD, {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});
		record(
			"board responds 200",
			resp?.status() === 200,
			`status=${resp?.status()}`,
		);
		const title = await page.title();
		record("board document.title set", title.length > 0, `title=${title}`);
		await page.waitForTimeout(2500);
		const html = await page.content();
		record(
			"board HTML contains a root mount",
			html.includes('id="root"') || html.includes("id='root'"),
		);
	} catch (err) {
		record(
			"board navigation",
			false,
			err instanceof Error ? err.message : String(err),
		);
	}

	record(
		"no page errors thrown",
		pageErrors.length === 0,
		pageErrors.slice(0, 3).join(" | "),
	);
	if (consoleErrors.length > 0) {
		console.log(
			`[WARN] ${consoleErrors.length} console.error messages — first: ${consoleErrors[0]?.slice(0, 200)}`,
		);
	}

	await browser.close();

	const failed = results.filter((r) => !r.ok);
	console.log(
		`\nSummary: ${results.length - failed.length}/${results.length} passed.`,
	);
	if (failed.length > 0) {
		console.error("Failures:");
		for (const f of failed) console.error(`  - ${f.name}: ${f.detail ?? ""}`);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
