import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as wikiRepo from "../repositories/wiki.repo.js";
import {
	CreateWikiSchema,
	UpdateWikiSchema,
} from "../validators/wiki.validators.js";

const app = new Hono();

app.get("/", async (c) => {
	const cid = getCompanyId(c);
	const category = c.req.query("category");

	const rows = await wikiRepo.listWikiEntries(cid, category);
	return c.json(rows);
});

app.get("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await wikiRepo.getWikiEntryById(c.req.param("id"), cid);
	if (!row) return c.json({ error: "Not found" }, 404);
	return c.json(row);
});

app.post("/", zValidator("json", CreateWikiSchema), async (c) => {
	const cid = getCompanyId(c);
	const body = c.req.valid("json");
	const slug =
		body.slug ??
		body.title
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");

	const row = await wikiRepo.createWikiEntry({
		companyId: cid,
		title: body.title,
		slug,
		category: body.category ?? null,
		tags: body.tags ?? null,
		authorSlug: body.authorSlug ?? null,
		content: body.content ?? "",
	});

	if (!row) return c.json({ error: "insert failed" }, 500);
	const rowId = String((row as { id?: unknown }).id ?? "");
	await logActivity(c, "wiki.created", "wiki_entry", rowId, {
		title: body.title,
	});
	return c.json(row, 201);
});

app.patch("/:id", zValidator("json", UpdateWikiSchema), async (c) => {
	const cid = getCompanyId(c);
	const id = c.req.param("id");
	const body = c.req.valid("json");

	const existing = await wikiRepo.getWikiEntryById(id, cid);
	if (!existing) return c.json({ error: "Not found" }, 404);

	const updates: Record<string, unknown> = {
		updatedAt: new Date().toISOString(),
	};
	if (body.title !== undefined) updates.title = body.title;
	if (body.slug !== undefined) updates.slug = body.slug;
	if (body.category !== undefined) updates.category = body.category;
	if (body.tags !== undefined) updates.tags = body.tags;
	if (body.authorSlug !== undefined) updates.authorSlug = body.authorSlug;
	if (body.content !== undefined) updates.content = body.content;

	const updated = await wikiRepo.updateWikiEntry(id, cid, updates);
	await logActivity(c, "wiki.updated", "wiki_entry", id, updates);
	return c.json(updated);
});

app.delete("/:id", async (c) => {
	const cid = getCompanyId(c);
	const row = await wikiRepo.deleteWikiEntry(c.req.param("id"), cid);
	if (!row) return c.json({ error: "Not found" }, 404);
	const rowId = String((row as { id?: unknown }).id ?? "");
	await logActivity(c, "wiki.deleted", "wiki_entry", rowId);
	return c.json({ ok: true });
});

export default app;
