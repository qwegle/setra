import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rawSqlite } from "../db/client.js";

interface CatalogSkill {
	name: string;
	slug: string;
	description?: string;
	category?: string;
	trigger?: string;
	prompt?: string;
}

const CATALOG_VERSION = "curated-enterprise-v1";
const CATALOG_KEY = "skills_catalog_seed_version";
const ALLOWED_CATEGORIES = new Set([
	"code",
	"web",
	"security",
	"data",
	"custom",
]);
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/u;

function catalogPath(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, "../../skills/catalog.json");
}

function loadCatalog(): CatalogSkill[] {
	const path = catalogPath();
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as CatalogSkill[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function hasCjkText(s: CatalogSkill): boolean {
	const text = `${s.name ?? ""} ${s.description ?? ""} ${s.trigger ?? ""} ${s.prompt ?? ""}`;
	return CJK_RE.test(text);
}

function curatedEnglishSkills(): CatalogSkill[] {
	// All curated skills are now in catalog.json — no hardcoded extras needed
	return [];
}

function currentVersion(): string | null {
	try {
		const row = rawSqlite
			.prepare(`SELECT value FROM app_settings WHERE key = ?`)
			.get(CATALOG_KEY) as { value?: string } | undefined;
		return row?.value ?? null;
	} catch {
		return null;
	}
}

function saveVersion(v: string): void {
	rawSqlite
		.prepare(
			`INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE
       SET value = excluded.value,
           updated_at = excluded.updated_at`,
		)
		.run(CATALOG_KEY, v);
}

export function seedLocalSkillsCatalog(): { seeded: number; skipped: boolean } {
	if (currentVersion() === CATALOG_VERSION) return { seeded: 0, skipped: true };

	const catalog = [...loadCatalog(), ...curatedEnglishSkills()];
	if (catalog.length === 0) return { seeded: 0, skipped: true };

	const insert = rawSqlite.prepare(
		`INSERT OR IGNORE INTO skills
      (id, company_id, name, slug, description, category, trigger, prompt, is_active, usage_count, created_at, updated_at)
     VALUES
      (lower(hex(randomblob(16))), NULL, ?, ?, ?, ?, ?, ?, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
	);

	const tx = rawSqlite.transaction((rows: CatalogSkill[]) => {
		rawSqlite.prepare(`DELETE FROM skills WHERE company_id IS NULL`).run();
		let count = 0;
		const seen = new Set<string>();
		for (const s of rows) {
			if (!s.name || !s.slug) continue;
			if (hasCjkText(s)) continue;
			if (seen.has(s.slug)) continue;
			seen.add(s.slug);
			const category =
				typeof s.category === "string" && ALLOWED_CATEGORIES.has(s.category)
					? s.category
					: "custom";
			const r = insert.run(
				s.name,
				s.slug,
				s.description ?? "",
				category,
				s.trigger ?? "",
				s.prompt ?? "",
			);
			const changes = (r as { changes?: number }).changes ?? 0;
			if (changes > 0) count++;
		}
		saveVersion(CATALOG_VERSION);
		return count;
	});

	const seeded = tx(catalog);
	return { seeded, skipped: false };
}
