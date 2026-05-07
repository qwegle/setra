import crypto from "node:crypto";
import type { Context, Next } from "hono";

/**
 * Adds security headers to all responses:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY
 * - X-XSS-Protection: 0 (modern browsers use CSP instead)
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Permissions-Policy: camera=(), microphone=(), geolocation=()
 * - X-Request-ID: unique per request for tracing
 */
export function securityHeaders() {
	return async (c: Context, next: Next) => {
		const requestId =
			(c.req.header("x-request-id") as string) ?? crypto.randomUUID();

		c.header("X-Request-ID", requestId);
		c.header("X-Content-Type-Options", "nosniff");
		c.header("X-Frame-Options", "DENY");
		c.header("X-XSS-Protection", "0");
		c.header("Referrer-Policy", "strict-origin-when-cross-origin");
		c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
		c.header(
			"Strict-Transport-Security",
			"max-age=31536000; includeSubDomains",
		);

		c.set("requestId", requestId);

		await next();
	};
}
