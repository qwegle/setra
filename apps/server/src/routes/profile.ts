/**
 * profile.ts — operator profile route.
 *
 * GET  /api/profile          returns the current SetraProfile (~/.setra/profile.json)
 * PUT  /api/profile          accepts a partial ProfileUpdate and merges it
 *
 * The profile is operator-scoped (per-machine), not tenant-scoped, so we do
 * not pass companyId into load/update.
 */
import { Hono } from "hono";
import {
	type ProfileUpdate,
	loadProfile,
	updateProfile,
} from "../lib/profile.js";

export const profileRoute = new Hono();

profileRoute.get("/", (c) => c.json(loadProfile()));

profileRoute.put("/", async (c) => {
	const body = (await c.req.json().catch(() => null)) as ProfileUpdate | null;
	if (!body || typeof body !== "object") {
		return c.json({ ok: false, error: "invalid body" }, 400);
	}
	const next = updateProfile(body);
	return c.json(next);
});
