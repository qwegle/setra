#!/usr/bin/env node
/**
 * Setra evals runner — minimal harness, no extra deps.
 *
 * Loads YAML cases from evals/cases/*.yaml, performs the setup HTTP calls
 * against SETRA_EVAL_BASE_URL (default http://localhost:3141), then polls
 * the expect block until each assertion is true or the deadline elapses.
 *
 * Exit code 0 = all green; 1 = any failure; 2 = harness error.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.SETRA_EVAL_BASE_URL ?? "http://localhost:3141";
const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

const args = process.argv.slice(2);
const onlyCase = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const jsonOut = args.includes("--json");

// Tiny YAML reader: only supports the subset our cases use (key: value,
// nested mappings, bullet lists with `- key: value`). For richer cases
// swap in `yaml` from npm.
function parseYaml(text) {
	const lines = text.split(/\r?\n/);
	function parse(indent, idx) {
		const out = {};
		while (idx < lines.length) {
			const raw = lines[idx];
			if (!raw.trim() || raw.trim().startsWith("#")) { idx++; continue; }
			const curIndent = raw.match(/^(\s*)/)[1].length;
			if (curIndent < indent) return [out, idx];
			if (raw.trim().startsWith("- ")) {
				if (!Array.isArray(out._list)) out._list = [];
				const inline = raw.slice(curIndent + 2);
				if (inline.includes(":")) {
					const itemLines = [inline, ...takeBlock(idx + 1, curIndent + 2).lines];
					const [item, next] = parse(curIndent + 2, idx);
					// fallback simple item
					const obj = {};
					obj[inline.split(":")[0].trim()] = inline.slice(inline.indexOf(":") + 1).trim();
					out._list.push(obj);
					idx++;
				} else {
					out._list.push(inline);
					idx++;
				}
				continue;
			}
			const m = raw.match(/^\s*([\w-]+):\s*(.*)$/);
			if (!m) { idx++; continue; }
			const key = m[1];
			const val = m[2];
			if (val === "") {
				const [child, next] = parse(curIndent + 2, idx + 1);
				out[key] = child._list ?? child;
				idx = next;
			} else {
				out[key] = stripQuotes(val);
				idx++;
			}
		}
		return [out, idx];
	}
	function takeBlock(from, indent) { return { lines: [] }; }
	function stripQuotes(s) {
		s = s.trim();
		if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
			return s.slice(1, -1);
		}
		if (s === "true") return true;
		if (s === "false") return false;
		if (/^-?\d+$/.test(s)) return Number(s);
		return s;
	}
	const [parsed] = parse(0, 0);
	return parsed;
}

async function http(method, path, body) {
	const url = `${BASE}${path}`;
	const init = { method, headers: { "Content-Type": "application/json" } };
	if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
	const res = await fetch(url, init);
	let json = null;
	try { json = await res.json(); } catch {}
	return { status: res.status, body: json };
}

function loadCases() {
	let files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
	if (onlyCase) files = files.filter((f) => f.startsWith(`${onlyCase}.`));
	return files.map((f) => ({ file: f, ...parseYaml(readFileSync(join(CASES_DIR, f), "utf8")) }));
}

async function runCase(c) {
	const setup = c.setup ?? [];
	for (const step of setup) {
		await http(step.method ?? "GET", step.path, step.body);
	}
	const expect = c.expect ?? [];
	for (const exp of expect) {
		const deadline = Date.now() + parseDuration(exp.within ?? "5s");
		let ok = false;
		let last;
		while (Date.now() < deadline && !ok) {
			last = await http(exp.method ?? "GET", exp.path);
			if (exp.status && last.status === Number(exp.status)) ok = true;
			else if (!exp.status && last.status >= 200 && last.status < 300) ok = true;
			if (!ok) await new Promise((r) => setTimeout(r, 500));
		}
		if (!ok) return { ok: false, reason: `expect failed: ${exp.method ?? "GET"} ${exp.path} got ${last?.status}` };
	}
	return { ok: true };
}

function parseDuration(s) {
	const m = String(s).match(/(\d+)(ms|s|m)?/);
	if (!m) return 5000;
	const n = Number(m[1]);
	const u = m[2] ?? "s";
	return u === "ms" ? n : u === "s" ? n * 1000 : n * 60_000;
}

async function main() {
	let cases;
	try { cases = loadCases(); }
	catch (e) {
		console.error("Failed to load cases:", e.message);
		process.exit(2);
	}
	const results = [];
	for (const c of cases) {
		const start = Date.now();
		try {
			const r = await runCase(c);
			results.push({ name: c.name ?? c.file, ok: r.ok, reason: r.reason, durationMs: Date.now() - start });
		} catch (e) {
			results.push({ name: c.name ?? c.file, ok: false, reason: e.message, durationMs: Date.now() - start });
		}
	}
	if (jsonOut) {
		console.log(JSON.stringify({ results }, null, 2));
	} else {
		for (const r of results) {
			const tag = r.ok ? "PASS" : "FAIL";
			console.log(`[${tag}] ${r.name} (${r.durationMs}ms)${r.reason ? ` — ${r.reason}` : ""}`);
		}
		const failed = results.filter((r) => !r.ok).length;
		console.log(`\n${results.length - failed}/${results.length} passed`);
	}
	process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
