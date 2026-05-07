import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	approvePlan,
	getPlanById,
	listPlans,
	rejectPlan,
} from "../lib/plan-engine.js";
import { emit } from "../sse/handler.js";

export const plansRoute = new Hono();

plansRoute.get("/", async (c) => {
	const companyId = getCompanyId(c);
	const status = c.req.query("status") ?? undefined;
	const issueId = c.req.query("issueId") ?? undefined;
	const plans = await listPlans(companyId, { status, issueId });
	return c.json(plans);
});

plansRoute.get("/:id", async (c) => {
	const companyId = getCompanyId(c);
	const plan = await getPlanById(c.req.param("id"));
	if (!plan || plan.companyId !== companyId) {
		return c.json({ error: "not found" }, 404);
	}
	return c.json(plan);
});

plansRoute.post("/:id/approve", async (c) => {
	const companyId = getCompanyId(c);
	const plan = await getPlanById(c.req.param("id"));
	if (!plan || plan.companyId !== companyId) {
		return c.json({ error: "not found" }, 404);
	}
	await approvePlan(plan.id);
	const updated = await getPlanById(plan.id);
	emit("plan.approved", {
		planId: plan.id,
		issueId: plan.issueId,
		companyId,
	});
	await logActivity(c, "plan.approved", "plan", plan.id, {
		issueId: plan.issueId,
	});
	return c.json(updated);
});

plansRoute.post("/:id/reject", async (c) => {
	const companyId = getCompanyId(c);
	const plan = await getPlanById(c.req.param("id"));
	if (!plan || plan.companyId !== companyId) {
		return c.json({ error: "not found" }, 404);
	}
	let feedback = "";
	try {
		const body = (await c.req.json()) as { feedback?: string; reason?: string };
		feedback =
			typeof body.feedback === "string"
				? body.feedback
				: typeof body.reason === "string"
					? body.reason
					: "";
	} catch {
		/* optional body */
	}
	await rejectPlan(plan.id, feedback);
	const updated = await getPlanById(plan.id);
	emit("plan.rejected", {
		planId: plan.id,
		issueId: plan.issueId,
		companyId,
	});
	await logActivity(c, "plan.rejected", "plan", plan.id, {
		issueId: plan.issueId,
		feedback,
	});
	return c.json(updated);
});
