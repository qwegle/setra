type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
	level: LogLevel;
	msg: string;
	ts: string;
	[key: string]: unknown;
}

function log(
	level: LogLevel,
	module: string,
	msg: string,
	ctx?: Record<string, unknown>,
): void {
	const entry: LogEntry = {
		level,
		msg,
		ts: new Date().toISOString(),
		module,
		...ctx,
	};
	const line = JSON.stringify(entry);
	if (level === "error") console.error(line);
	else console.log(line);
}

function createLogger(module: string) {
	return {
		debug: (msg: string, ctx?: Record<string, unknown>) =>
			log("debug", module, msg, ctx),
		info: (msg: string, ctx?: Record<string, unknown>) =>
			log("info", module, msg, ctx),
		warn: (msg: string, ctx?: Record<string, unknown>) =>
			log("warn", module, msg, ctx),
		error: (msg: string, ctx?: Record<string, unknown>) =>
			log("error", module, msg, ctx),
	};
}

export { createLogger };
export type { LogEntry, LogLevel };
