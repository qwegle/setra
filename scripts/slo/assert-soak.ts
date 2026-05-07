import { readFileSync } from "node:fs";

function getArg(name: string, fallback: string): string {
	const match = process.argv.find((a) => a.startsWith(`--${name}=`));
	return match ? match.slice(name.length + 3) : fallback;
}

function fail(msg: string): never {
	console.error(`assert-soak: FAIL — ${msg}`);
	process.exit(1);
}

type SoakResult = {
	availabilityPct: number;
	errorRatePct: number;
	p95Ms: number;
	rssStartKb: number;
	rssEndKb: number;
	memoryGrowthPct: number;
};

const file = getArg("file", "benchmark-results/soak.json");
const minAvailability = Number(getArg("min-availability", "99"));
const maxErrorRate = Number(getArg("max-error-rate", "1"));
const maxP95Ms = Number(getArg("max-p95-ms", "500"));
const maxGrowthPct = Number(getArg("max-memory-growth-pct", "30"));
const maxGrowthMb = Number(getArg("max-memory-growth-mb", "250"));

const parsed = JSON.parse(readFileSync(file, "utf-8")) as SoakResult;
const absGrowthMb = (parsed.rssEndKb - parsed.rssStartKb) / 1024;

if (parsed.availabilityPct < minAvailability) {
	fail(
		`availability ${parsed.availabilityPct.toFixed(2)} < ${minAvailability}`,
	);
}
if (parsed.errorRatePct > maxErrorRate) {
	fail(`error rate ${parsed.errorRatePct.toFixed(2)} > ${maxErrorRate}`);
}
if (parsed.p95Ms > maxP95Ms) {
	fail(`p95 latency ${parsed.p95Ms.toFixed(2)}ms > ${maxP95Ms}ms`);
}
if (parsed.memoryGrowthPct > maxGrowthPct) {
	fail(
		`memory growth ${parsed.memoryGrowthPct.toFixed(2)}% > ${maxGrowthPct}%`,
	);
}
if (absGrowthMb > maxGrowthMb) {
	fail(`absolute memory growth ${absGrowthMb.toFixed(2)}MB > ${maxGrowthMb}MB`);
}

console.log("assert-soak: PASS");
