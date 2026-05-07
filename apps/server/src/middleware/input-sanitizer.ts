import type { Context, Next } from "hono";

const DANGEROUS_PATTERNS = [
	/<script\b[^>]*>/i,
	/javascript:/i,
	/on\w+\s*=/i,
	/data:\s*text\/html/i,
];

/**
 * Sanitizes string inputs by stripping HTML tags and checking for XSS patterns.
 * Applied to POST/PUT/PATCH request bodies.
 */
export function inputSanitizer() {
	return async (c: Context, next: Next) => {
		const method = c.req.method;

		if (method === "POST" || method === "PUT" || method === "PATCH") {
			const contentType = c.req.header("content-type") ?? "";
			if (contentType.includes("application/json")) {
				try {
					const body = await c.req.json();
					if (containsDangerousContent(body)) {
						return c.json(
							{ error: "Request contains potentially dangerous content" },
							400,
						);
					}
				} catch {
					// If JSON parsing fails, let the route handler deal with it
				}
			}
		}

		return next();
	};
}

function containsDangerousContent(obj: unknown): boolean {
	if (typeof obj === "string") {
		return DANGEROUS_PATTERNS.some((p) => p.test(obj));
	}
	if (Array.isArray(obj)) {
		return obj.some((item) => containsDangerousContent(item));
	}
	if (obj && typeof obj === "object") {
		return Object.values(obj).some((val) => containsDangerousContent(val));
	}
	return false;
}
