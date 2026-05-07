/**
 * llm.repo.ts — Repository for LLM settings
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { llmSettings } from "../db/schema.js";

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getSettings() {
	const rows = await db
		.select()
		.from(llmSettings)
		.where(eq(llmSettings.id, "default"))
		.limit(1);
	return rows[0] ?? null;
}

export async function updateSettings(body: {
	ollamaUrl?: string;
	lmstudioUrl?: string;
	defaultOfflineModel?: string;
	maxConcurrentPulls?: number;
}) {
	const existing = await getSettings();
	const now = new Date().toISOString();

	if (existing) {
		const updates: Record<string, unknown> = { updatedAt: now };
		if (body.ollamaUrl !== undefined) updates.ollamaUrl = body.ollamaUrl;
		if (body.lmstudioUrl !== undefined) updates.lmstudioUrl = body.lmstudioUrl;
		if (body.defaultOfflineModel !== undefined)
			updates.defaultOfflineModel = body.defaultOfflineModel;
		if (body.maxConcurrentPulls !== undefined)
			updates.maxConcurrentPulls = body.maxConcurrentPulls;
		const [updated] = await db
			.update(llmSettings)
			.set(updates)
			.where(eq(llmSettings.id, "default"))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(llmSettings)
		.values({
			id: "default",
			ollamaUrl: body.ollamaUrl ?? "http://localhost:11434",
			lmstudioUrl: body.lmstudioUrl ?? "http://localhost:1234",
			defaultOfflineModel: body.defaultOfflineModel ?? "llama3.2",
			maxConcurrentPulls: body.maxConcurrentPulls ?? 2,
			updatedAt: now,
		})
		.returning();
	return created;
}
