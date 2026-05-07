import { eq } from "drizzle-orm";
/**
 * Instance repository — Drizzle queries for adapters, plugins, and feature flags.
 */
import { db } from "../db/client.js";
import { adapterConfigs, featureFlags, plugins } from "../db/schema.js";

// ─── Adapter Configs ─────────────────────────────────────────────────────────

const DEFAULT_ADAPTERS = [
	{ id: "claude", name: "Claude (Anthropic)", type: "llm" },
	{ id: "openai", name: "OpenAI", type: "llm" },
	{ id: "ollama", name: "Ollama (local)", type: "llm" },
	{ id: "openrouter", name: "OpenRouter", type: "llm" },
	{ id: "gemini", name: "Google Gemini", type: "llm" },
	{ id: "opencode", name: "OpenCode", type: "coding" },
];

export async function seedAdapters() {
	const existing = await db
		.select({ id: adapterConfigs.id })
		.from(adapterConfigs)
		.limit(1);
	if (existing.length > 0) return;

	await db.insert(adapterConfigs).values(
		DEFAULT_ADAPTERS.map((a) => ({
			id: a.id,
			name: a.name,
			type: a.type,
			enabled: false,
			config: "{}",
			isConfigured: false,
		})),
	);
}

export async function listAdapters() {
	return db.select().from(adapterConfigs).orderBy(adapterConfigs.id);
}

export async function getAdapterById(id: string) {
	const [row] = await db
		.select({ id: adapterConfigs.id })
		.from(adapterConfigs)
		.where(eq(adapterConfigs.id, id));
	return row ?? null;
}

export async function getAdapterWithAllFields(id: string) {
	const [row] = await db
		.select()
		.from(adapterConfigs)
		.where(eq(adapterConfigs.id, id));
	return row ?? null;
}

export async function updateAdapter(
	id: string,
	updates: Partial<typeof adapterConfigs.$inferInsert>,
) {
	const [updated] = await db
		.update(adapterConfigs)
		.set(updates)
		.where(eq(adapterConfigs.id, id))
		.returning();
	return updated;
}

// ─── Plugins ─────────────────────────────────────────────────────────────────

export async function listPlugins() {
	return db.select().from(plugins).orderBy(plugins.id);
}

export async function getPluginById(id: string) {
	const [row] = await db.select().from(plugins).where(eq(plugins.id, id));
	return row ?? null;
}

export async function togglePlugin(id: string, currentEnabled: boolean) {
	const [updated] = await db
		.update(plugins)
		.set({ enabled: !currentEnabled, updatedAt: new Date().toISOString() })
		.where(eq(plugins.id, id))
		.returning();
	return updated;
}

export async function updatePluginConfig(id: string, config: string) {
	const [updated] = await db
		.update(plugins)
		.set({ config, updatedAt: new Date().toISOString() })
		.where(eq(plugins.id, id))
		.returning();
	return updated;
}

export async function installPlugin(id: string) {
	const [updated] = await db
		.update(plugins)
		.set({ isInstalled: true, updatedAt: new Date().toISOString() })
		.where(eq(plugins.id, id))
		.returning();
	return updated;
}

export async function uninstallPlugin(id: string) {
	const [updated] = await db
		.update(plugins)
		.set({
			isInstalled: false,
			enabled: false,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(plugins.id, id))
		.returning();
	return updated;
}

// ─── Feature Flags ───────────────────────────────────────────────────────────

export async function listFeatureFlags() {
	return db.select().from(featureFlags).orderBy(featureFlags.id);
}

export async function getFeatureFlagById(id: string) {
	const [row] = await db
		.select()
		.from(featureFlags)
		.where(eq(featureFlags.id, id));
	return row ?? null;
}

export async function upsertFeatureFlag(id: string, enabled: boolean) {
	const existing = await getFeatureFlagById(id);
	if (existing) {
		const [updated] = await db
			.update(featureFlags)
			.set({ enabled, updatedAt: new Date().toISOString() })
			.where(eq(featureFlags.id, id))
			.returning();
		return { flag: updated, created: false };
	}

	const [created] = await db
		.insert(featureFlags)
		.values({ id, name: id, enabled })
		.returning();
	return { flag: created, created: true };
}
