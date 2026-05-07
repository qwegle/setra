import type { MiddlewareHandler } from "hono";
import { verifyToken } from "../lib/auth.js";

function readLegacyInstanceToken(): string | null {
	const token =
		process.env.SETRA_INSTANCE_TOKEN?.trim() ??
		process.env.INSTANCE_TOKEN?.trim();
	return token ? token : null;
}

export function requireAuth(): MiddlewareHandler {
	return async (c, next) => {
		if (c.req.method === "OPTIONS") {
			return next();
		}

		const authHeader = c.req.header("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const token = authHeader.slice(7).trim();
		const legacyToken = readLegacyInstanceToken();
		if (legacyToken && token === legacyToken) {
			const legacyCompanyId =
				c.req.header("x-company-id") ?? c.req.query("companyId") ?? null;
			if (legacyCompanyId) c.set("companyId", legacyCompanyId);
			c.set("authMode", "legacy");
			return next();
		}
		try {
			const payload = verifyToken(token);
			if ((payload.exp ?? 0) < Date.now()) {
				return c.json({ error: "Token expired" }, 401);
			}
			c.set("userId", payload.userId);
			c.set("userEmail", payload.email);
			c.set("companyId", payload.companyId);
			c.set("userRole", payload.role);
			c.set("authMode", "jwt");
			return next();
		} catch (err) {
			const msg =
				err instanceof Error && err.message === "Token expired"
					? "Token expired"
					: "Invalid token";
			return c.json({ error: msg }, 401);
		}
	};
}
