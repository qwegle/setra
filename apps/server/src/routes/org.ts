import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as orgRepo from "../repositories/org.repo.js";
import { OrgInviteSchema } from "../validators/org.validators.js";

const app = new Hono();

app.get("/members", async (c) => {
	const cid = getCompanyId(c);
	const rows = await orgRepo.listMembers(cid);
	return c.json(rows);
});

app.get("/stats", async (c) => {
	const cid = getCompanyId(c);
	const stats = await orgRepo.getOrgStats(cid);
	return c.json(stats);
});

app.post("/invite", zValidator("json", OrgInviteSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
	const invite = await orgRepo.createInvite({
		companyId: cid,
		email: body.email,
		role: body.role ?? "member",
		expiresAt,
	});
	return c.json({ ok: true, email: invite?.email, role: invite?.role });
});

export default app;
