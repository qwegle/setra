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
	// /api/health is the only endpoint that may stay anonymous when an
	// instance token is configured — uptime probes need an unauth check
	// and it returns no tenant data. /api/events used to be exempted but
	// that leaked SSE payloads (run chunks, cost telemetry, agent activity)
	// to anyone on the network. EventSource clients can authenticate via
	// the ?instanceToken= query parameter handled below.
	if (path === "/api/health") {
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
