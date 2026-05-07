/**
 * clone.ts — Clone Agent API
 *
 * The clone profile is a singleton per company.
 * It trains on every user input observation and, when locked,
 * acts as the user to direct other agents.
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { recordObservation, regenerateBrief } from "../clone/observer.js";
import { getCompanyId } from "../lib/company-scope.js";
import * as cloneRepo from "../repositories/clone.repo.js";
import {
	AnswerQuestionSchema,
	ObserveSchema,
	UpdateCloneModeSchema,
} from "../validators/clone.validators.js";

export const cloneRoute = new Hono();

// GET /api/clone
cloneRoute.get("/", async (c) => {
	const companyId = getCompanyId(c);
	return c.json(await cloneRepo.getOrCreateClone(companyId));
});

// PATCH /api/clone/mode — switch training ↔ locked
cloneRoute.patch(
	"/mode",
	zValidator("json", UpdateCloneModeSchema),
	async (c) => {
		const companyId = getCompanyId(c);
		const body = c.req.valid("json");
		const clone = await cloneRepo.getOrCreateClone(companyId);

		const updated = await cloneRepo.updateCloneMode(
			clone.id,
			companyId,
			body.mode,
		);
		return c.json(updated);
	},
);

// GET /api/clone/questions — pending Q&A sessions
cloneRoute.get("/questions", async (c) => {
	const companyId = getCompanyId(c);
	const clone = await cloneRepo.getOrCreateClone(companyId);
	const rows = await cloneRepo.listQaSessions(clone.id);

	if (rows.length === 0) {
		const inserted = await cloneRepo.createStarterQuestions(clone.id);
		return c.json(inserted);
	}

	return c.json(rows);
});

// PATCH /api/clone/questions/:id — answer a question
// Also records the answer as a qa_answer observation for training
cloneRoute.patch(
	"/questions/:id",
	zValidator("json", AnswerQuestionSchema),
	async (c) => {
		const companyId = getCompanyId(c);
		const body = c.req.valid("json");
		const clone = await cloneRepo.getOrCreateClone(companyId);
		const updated = await cloneRepo.answerQaSession(
			c.req.param("id"),
			clone.id,
			body.answer,
		);

		if (!updated) return c.json({ error: "not found" }, 404);

		// Train the clone on this Q&A answer — weight 2.0 (explicit user preference)
		void recordObservation(
			`Q: ${updated.question}\nA: ${body.answer}`,
			"qa_answer",
			2.0,
			companyId,
		);

		return c.json(updated);
	},
);

// POST /api/clone/observe — explicit observation from any source (agents, integrations)
cloneRoute.post("/observe", zValidator("json", ObserveSchema), async (c) => {
	const companyId = getCompanyId(c);
	const body = c.req.valid("json");

	const validSources = [
		"issue_title",
		"issue_description",
		"comment",
		"chat_message",
		"task_description",
		"agent_feedback",
		"qa_answer",
		"vision_note",
	];
	const source = validSources.includes(body.source ?? "")
		? (body.source as Parameters<typeof recordObservation>[1])
		: "vision_note";

	await recordObservation(body.content, source, body.weight ?? 1.0, companyId);
	return c.json({ ok: true });
});

// GET /api/clone/observations — list recent observations (for debugging / UI)
cloneRoute.get("/observations", async (c) => {
	const companyId = getCompanyId(c);
	const clone = await cloneRepo.getOrCreateClone(companyId);
	const rows = await cloneRepo.listObservations(clone.id);
	return c.json(rows);
});

// POST /api/clone/regenerate-brief — manually trigger brief regeneration.
// No body — clients call with method-only; skipping zValidator.
cloneRoute.post("/regenerate-brief", async (c) => {
	const companyId = getCompanyId(c);
	const result = await regenerateBrief(companyId);
	return c.json(result);
});
