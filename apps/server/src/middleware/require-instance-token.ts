import type { MiddlewareHandler } from "hono";

function readInstanceToken(): string | null {
	const token = process.env["SETRA_INSTANCE_TOKEN"]?.trim();
	return token ? token : null;
}

export const requireInstanceToken: MiddlewareHandler = async (c, next) => {
	const expected = readInstanceToken();
	if (!expected) {
		await next();
		return;
	}

	if (c.req.method === "OPTIONS") {
		await next();
		return;
	}

	const path = c.req.path;
	if (path === "/api/health" || path.startsWith("/api/events")) {
		await next();
		return;
	}

	const bearer = c.req.header("authorization");
	const headerToken = c.req.header("x-instance-token");
	const queryToken = c.req.query("instanceToken");
	const presented =
		(bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null) ??
		headerToken ??
		queryToken ??
		null;

	if (presented !== expected) {
		return c.json(
			{
				error: "instance_token_required",
				message: "Missing or invalid instance token",
			},
			401,
		);
	}

	await next();
	return;
};
