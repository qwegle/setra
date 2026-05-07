import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getCompanyId } from "../lib/company-scope.js";
import * as artifactsRepo from "../repositories/artifacts.repo.js";
import { emit } from "../sse/handler.js";
import { CreateArtifactSchema } from "../validators/artifacts.validators.js";

const app = new Hono();

app.get("/", async (c) => {
	const cid = getCompanyId(c);
	const issueId = c.req.query("issueId");
	const agentSlug = c.req.query("agentSlug");

	const rows = await artifactsRepo.listArtifacts(cid, issueId, agentSlug);
	return c.json(
		rows.map((r) => ({
			...r,
			downloadUrl: `/api/artifacts/${r.id}/download`,
		})),
	);
});

app.post("/", zValidator("json", CreateArtifactSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");

	const row = await artifactsRepo.createArtifact({
		companyId: cid,
		name: body.name,
		issueId: body.issueId ?? null,
		agentSlug: body.agentSlug ?? null,
		mimeType: body.mimeType ?? null,
		content: body.content ?? null,
	});

	if (!row) return c.json({ error: "insert failed" }, 500);
	emit("artifact:created", { id: row.id, agentSlug: row.agentSlug });
	return c.json(
		{ ...row, downloadUrl: `/api/artifacts/${row.id}/download` },
		201,
	);
});

app.get("/:id/download", async (c) => {
	const cid = getCompanyId(c);
	const row = await artifactsRepo.getArtifactById(c.req.param("id"), cid);
	if (!row) return c.json({ error: "Not found" }, 404);
	return new Response(row.content ?? "", {
		headers: {
			"Content-Type": row.mimeType ?? "application/octet-stream",
			"Content-Disposition": `attachment; filename="${row.name}"`,
		},
	});
});

app.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await artifactsRepo.deleteArtifact(c.req.param("id"), cid);
	if (!row) return c.json({ error: "Not found" }, 404);
	return c.json({ ok: true });
});

export default app;
