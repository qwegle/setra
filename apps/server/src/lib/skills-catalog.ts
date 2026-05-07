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

const CATALOG_VERSION = "skills-sh-local-v3";
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
	return [
		{
			name: "DOCX report writer",
			slug: "setra-docx-report-writer",
			description: "Create structured DOCX business reports from requirements.",
			category: "data",
			trigger: "docx, word, report",
			prompt:
				"Generate a DOCX-ready outline with sections, tables, and appendix guidance.",
		},
		{
			name: "XLSX financial modeler",
			slug: "setra-xlsx-financial-modeler",
			description:
				"Build spreadsheet models for budget, forecast, and scenario planning.",
			category: "data",
			trigger: "xlsx, excel, forecast",
			prompt:
				"Produce workbook sheets, formulas, and assumptions for financial planning.",
		},
		{
			name: "CSV pipeline builder",
			slug: "setra-csv-pipeline-builder",
			description:
				"Design CSV import/export schemas with validation and transformations.",
			category: "data",
			trigger: "csv, import, export",
			prompt:
				"Define CSV columns, constraints, mapping, and reconciliation checks.",
		},
		{
			name: "Math optimization analyst",
			slug: "setra-math-optimization-analyst",
			description:
				"Solve optimization and estimation problems for business operations.",
			category: "data",
			trigger: "math, optimize, estimate",
			prompt:
				"Formulate objective, constraints, and a practical optimization strategy.",
		},
		{
			name: "Product requirements writer",
			slug: "setra-product-requirements-writer",
			description:
				"Turn ideas into clear PRDs with scope, acceptance criteria, and milestones.",
			category: "custom",
			trigger: "prd, requirements, scope",
			prompt:
				"Draft a concise PRD with user stories, non-goals, and acceptance criteria.",
		},
		{
			name: "Engineering manager planner",
			slug: "setra-engineering-manager-planner",
			description:
				"Plan execution cadence, ownership, risk tracking, and team rituals.",
			category: "custom",
			trigger: "management, sprint, planning",
			prompt:
				"Create a practical engineering execution plan with owners and risks.",
		},
		{
			name: "Full-stack architecture designer",
			slug: "setra-fullstack-architecture-designer",
			description: "Design scalable full-stack architecture for web products.",
			category: "code",
			trigger: "fullstack, architecture, design",
			prompt:
				"Provide frontend/backend/data architecture with deployment topology.",
		},
		{
			name: "Database performance engineer",
			slug: "setra-database-performance-engineer",
			description:
				"Improve query performance, indexing, and data model efficiency.",
			category: "data",
			trigger: "database, index, query",
			prompt:
				"Recommend index strategy, query rewrites, and schema optimizations.",
		},
		{
			name: "DevOps release engineer",
			slug: "setra-devops-release-engineer",
			description:
				"Design CI/CD pipelines with safe rollout and rollback controls.",
			category: "code",
			trigger: "devops, ci, cd",
			prompt:
				"Build a CI/CD release plan with quality gates and rollback steps.",
		},
		{
			name: "Cybersecurity hardening advisor",
			slug: "setra-cybersecurity-hardening-advisor",
			description:
				"Harden systems with threat modeling and practical mitigations.",
			category: "security",
			trigger: "security, hardening, threat",
			prompt: "Create a threat model and prioritized remediation checklist.",
		},
		{
			name: "SEO technical optimizer",
			slug: "setra-seo-technical-optimizer",
			description:
				"Improve technical SEO for indexing, ranking, and discoverability.",
			category: "web",
			trigger: "seo, ranking, indexing",
			prompt: "Propose technical SEO fixes with measurable KPIs.",
		},
		{
			name: "Sales pipeline operator",
			slug: "setra-sales-pipeline-operator",
			description:
				"Build lead stages, qualification rules, and follow-up playbooks.",
			category: "web",
			trigger: "sales, lead, pipeline",
			prompt:
				"Design a sales pipeline with definitions, SLAs, and conversion metrics.",
		},
		{
			name: "Lead research specialist",
			slug: "setra-lead-research-specialist",
			description: "Research and enrich leads with high-intent signals.",
			category: "web",
			trigger: "lead research, prospecting",
			prompt:
				"Create a repeatable lead research process with data confidence scoring.",
		},
		{
			name: "Email campaign copywriter",
			slug: "setra-email-campaign-copywriter",
			description:
				"Write conversion-focused email sequences for outreach and nurture.",
			category: "web",
			trigger: "email, campaign, copy",
			prompt: "Draft email sequence variants by audience and funnel stage.",
		},
		{
			name: "Email inbox triage manager",
			slug: "setra-email-inbox-triage-manager",
			description:
				"Organize inbox operations, priorities, and response templates.",
			category: "custom",
			trigger: "email management, inbox",
			prompt:
				"Create inbox triage rules, tags, response SLAs, and escalation paths.",
		},
		{
			name: "Finance controller assistant",
			slug: "setra-finance-controller-assistant",
			description: "Track spending, accruals, and monthly close tasks.",
			category: "data",
			trigger: "finance, accounting, close",
			prompt:
				"Produce monthly finance control checklist and variance analysis format.",
		},
		{
			name: "Tax planning advisor",
			slug: "setra-tax-planning-advisor",
			description:
				"Structure tax planning tasks, deadlines, and compliance controls.",
			category: "data",
			trigger: "tax, compliance",
			prompt: "Create a practical tax calendar with compliance checkpoints.",
		},
		{
			name: "Budget governance planner",
			slug: "setra-budget-governance-planner",
			description:
				"Set budget guardrails, approval thresholds, and reporting cadence.",
			category: "data",
			trigger: "budget, governance",
			prompt:
				"Design budget controls with owner approvals and exception handling.",
		},
		{
			name: "Growth experimentation lead",
			slug: "setra-growth-experimentation-lead",
			description:
				"Run growth experiments with hypotheses and measurable outcomes.",
			category: "web",
			trigger: "growth, experiment, funnel",
			prompt:
				"Define growth experiments with hypotheses, metrics, and stop rules.",
		},
		{
			name: "Business operations strategist",
			slug: "setra-business-operations-strategist",
			description:
				"Optimize cross-functional operations and decision workflows.",
			category: "custom",
			trigger: "operations, strategy",
			prompt:
				"Build an operating model with KPIs, owners, and escalation paths.",
		},
	];
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
