import type { Context, Next } from "hono";

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of store) {
		if (entry.resetAt <= now) store.delete(key);
	}
}, 300_000);

export function rateLimit(opts: { windowMs?: number; max?: number } = {}) {
	const windowMs = opts.windowMs ?? 60_000;
	const max = opts.max ?? 120;

	return async (c: Context, next: Next) => {
		const key =
			c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
		const now = Date.now();

		let entry = store.get(key);
		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + windowMs };
			store.set(key, entry);
		}

		entry.count++;

		c.header("X-RateLimit-Limit", String(max));
		c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
		c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

		if (entry.count > max) {
			return c.json(
				{
					error: "Too many requests",
					retryAfter: Math.ceil((entry.resetAt - now) / 1000),
				},
				429,
			);
		}

		return next();
	};
}
