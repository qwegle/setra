import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as activityRepo from "../repositories/activity.repo.js";

export const activityRoute = new Hono();

activityRoute.get("/", (c) => {
	const cid = getCompanyId(c);
	const page = Math.max(1, Number(c.req.query("page")) || 1);
	const pageSize = Math.min(
		100,
		Math.max(1, Number(c.req.query("pageSize")) || 50),
	);
	const filter = c.req.query("filter") || undefined;

	const result = activityRepo.getPaginatedActivityLogs(
		cid,
		page,
		pageSize,
		filter,
	);
	return c.json(result);
});
