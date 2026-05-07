/**
 * observer.ts — Clone training loop
 *
 * Every meaningful piece of user-authored text is captured here as a
 * cloneObservation. The observations feed the brief regeneration job
 * which compresses them into ≤500-token brief stored on cloneProfile.
 *
 * Sources captured:
 *   issue_title / issue_description — when user creates/edits issues
 *   comment                         — when user posts comments
 *   chat_message                    — when user posts to a channel
 *   task_description                — when user fills in the goal parser
 *   qa_answer                       — when user answers clone Q&A
 *   vision_note                     — explicit POST /api/clone/observe
 */

import { cloneObservations, cloneProfile } from "@setra/db";
import { and, eq, not } from "drizzle-orm";
import { db } from "../db/client.js";
import { emit } from "../sse/handler.js";

type ObservationSource =
	| "issue_title"
	| "issue_description"
	| "comment"
	| "chat_message"
	| "task_description"
	| "agent_feedback"
	| "qa_answer"
	| "vision_note";

async function getOrCreateCloneId(companyId: string): Promise<string> {
	const [existing] = await db
		.select({ id: cloneProfile.id })
		.from(cloneProfile)
		.where(eq(cloneProfile.companyId, companyId))
		.limit(1);
	if (existing) return existing.id;

	const [created] = await db
		.insert(cloneProfile)
		.values({
			id: crypto.randomUUID(),
			companyId,
			name: "My Clone",
			mode: "training",
		})
		.returning({ id: cloneProfile.id });
	return created!.id;
}

/**
 * Record a single observation. Fire-and-forget — never throws so callers
 * don't need to handle errors. Silently skips empty or trivially short content.
 */
export async function recordObservation(
	content: string,
	source: ObservationSource,
	weight = 1.0,
	companyId = "default",
): Promise<void> {
	const trimmed = content.trim();
	if (trimmed.length < 5) return;

	try {
		const cloneId = await getOrCreateCloneId(companyId);
		await db.insert(cloneObservations).values({
			id: crypto.randomUUID(),
			companyId,
			cloneId,
			source,
			content: trimmed,
			weight,
			processed: false,
		});
	} catch {
		// Training loop must never crash the main request
	}
}

/**
 * Regenerate the clone's brief by summarizing all unprocessed observations.
 *
 * Strategy:
 *   1. Fetch up to 200 unprocessed observations
 *   2. Group by source type
 *   3. Call Haiku (or rule-based fallback) to produce a ≤500-token brief
 *   4. Save brief to cloneProfile.brief
 *   5. Mark observations as processed
 *
 * Called by:
 *   - Background interval every 30 minutes (server startup)
 *   - POST /api/clone/regenerate-brief (manual trigger)
 */
export async function regenerateBrief(companyId = "default"): Promise<{
	updated: boolean;
	brief: string | null;
}> {
	let cloneId: string;
	try {
		cloneId = await getOrCreateCloneId(companyId);
	} catch {
		return { updated: false, brief: null };
	}

	const unprocessed = await db
		.select()
		.from(cloneObservations)
		.where(
			and(
				eq(cloneObservations.companyId, companyId),
				eq(cloneObservations.cloneId, cloneId),
				not(cloneObservations.processed),
			),
		)
		.limit(200)
		.catch(() => [] as (typeof cloneObservations.$inferSelect)[]);

	if (unprocessed.length === 0) {
		return { updated: false, brief: null };
	}

	// Group into a readable digest
	const grouped: Record<string, string[]> = {};
	for (const obs of unprocessed) {
		(grouped[obs.source] ??= []).push(obs.content);
	}

	const digest = Object.entries(grouped)
		.map(([src, items]) => `[${src}]\n${items.slice(0, 20).join("\n")}`)
		.join("\n\n");

	const brief = await summarizeDigest(digest);

	// Save brief and mark observations processed
	await db
		.update(cloneProfile)
		.set({ brief, trainedAt: new Date().toISOString() })
		.where(
			and(eq(cloneProfile.id, cloneId), eq(cloneProfile.companyId, companyId)),
		)
		.catch(() => undefined);

	// Mark observations as processed in a single pass
	for (const obs of unprocessed) {
		await db
			.update(cloneObservations)
			.set({ processed: true })
			.where(
				and(
					eq(cloneObservations.id, obs.id),
					eq(cloneObservations.companyId, companyId),
				),
			)
			.catch(() => undefined);
	}

	emit("clone:brief_updated", { cloneId, companyId });
	return { updated: true, brief };
}

async function summarizeDigest(digest: string): Promise<string> {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) return ruleBasedSummary(digest);

	const prompt = `You are summarizing a user's behavior patterns to help their AI clone understand how they think and work.

Here are recent observations of what the user wrote:

${digest.slice(0, 6000)}

Write a ≤500-token brief in second person ("You prefer…", "You tend to…") covering:
1. Communication style
2. Risk tolerance and decision-making
3. Technical expertise and preferred patterns
4. How you prioritise work

Be specific and actionable. Skip generic statements. Return ONLY the brief, no headings.`;

	try {
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: "claude-haiku-4-5",
				max_tokens: 600,
				messages: [{ role: "user", content: prompt }],
			}),
		});

		if (!res.ok) return ruleBasedSummary(digest);
		const data = (await res.json()) as {
			content: Array<{ type: string; text: string }>;
		};
		return (
			data.content.find((b) => b.type === "text")?.text ??
			ruleBasedSummary(digest)
		);
	} catch {
		return ruleBasedSummary(digest);
	}
}

function ruleBasedSummary(digest: string): string {
	const lines = digest
		.split("\n")
		.filter((l) => l.trim() && !l.startsWith("["));
	const sample = lines.slice(0, 15).join(". ");
	return `Based on your recent activity, you have been focused on: ${sample.slice(0, 400)}.`;
}
