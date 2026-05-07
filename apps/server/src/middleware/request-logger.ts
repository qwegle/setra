import type { Context, Next } from "hono";
import { createLogger } from "../lib/logger.js";

const log = createLogger("http");

/**
 * Request logging middleware — logs method, path, status, and duration
 * for every request. Uses structured JSON logging.
 */
export function requestLogger() {
	return async (c: Context, next: Next) => {
		const start = performance.now();
		const method = c.req.method;
		const path = c.req.path;
		const requestId = c.get("requestId") ?? "-";

		try {
			await next();
		} catch (err) {
			const duration = Math.round(performance.now() - start);
			log.error("request failed", {
				method,
				path,
				requestId,
				durationMs: duration,
				error: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}

		const duration = Math.round(performance.now() - start);
		const status = c.res.status;

		if (status >= 500) {
			log.error("server error", {
				method,
				path,
				status,
				requestId,
				durationMs: duration,
			});
		} else if (status >= 400) {
			log.warn("client error", {
				method,
				path,
				status,
				requestId,
				durationMs: duration,
			});
		} else {
			log.info("request", {
				method,
				path,
				status,
				requestId,
				durationMs: duration,
			});
		}
	};
}
