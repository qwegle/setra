/**
 * /api/cli-status — live install/version state for the five first-class
 * coding-agent CLIs (Claude, Codex, Gemini, OpenCode, Cursor).
 *
 * Powers the Onboarding "Connect a coding CLI" page (PR-B) and the top-bar
 * AdapterStatusPill (PR-C). Polled every ~2s from the onboarding page so a
 * user installing a CLI in another terminal sees the badge flip to green
 * without refreshing.
 *
 * The actual probing is cached in `packages/agent-runner/src/cli-probe.ts`
 * for `CACHE_TTL_MS` (60s), so this endpoint is cheap. Pass `?force=1` to
 * bust the cache (used by the onboarding page's manual "Recheck" button).
 *
 * No authentication required: this only reports binary presence on the host
 * filesystem, never reads any credentials.
 */

import { probeCLIs } from "@setra/agent-runner";
import { Hono } from "hono";

export const cliStatusRoute = new Hono();

cliStatusRoute.get("/", async (c) => {
	const force = c.req.query("force") === "1" || c.req.query("force") === "true";
	const onlyParam = c.req.query("only");
	const only = onlyParam
		? onlyParam.split(",").map((s) => s.trim()).filter(Boolean)
		: undefined;
	const adapters = await probeCLIs({ force, only });
	return c.json({ adapters });
});
