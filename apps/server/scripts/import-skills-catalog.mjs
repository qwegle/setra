#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SITEMAP_URL = "https://skills.sh/sitemap.xml";
const TARGET_COUNT = Number(process.env.SKILLS_TARGET_COUNT ?? "1100");
const MAX_REPOS = Number(process.env.SKILLS_MAX_REPOS ?? "12");
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/u;

function parseSitemap(xml) {
	const urls = [
		...xml.matchAll(/<loc>(https:\/\/skills\.sh\/[^<]+)<\/loc>/g),
	].map((m) => m[1]);
	const skills = [];
	for (const u of urls) {
		const p = new URL(u).pathname.split("/").filter(Boolean);
		if (p.length < 3) continue;
		const [owner, repo, ...rest] = p;
		if (!owner || !repo || rest.length === 0) continue;
		const skillId = rest.join("/");
		skills.push({
			owner,
			repo,
			skillId,
			url: u,
			sourceRepo: `${owner}/${repo}`,
		});
	}
	return skills;
}

function chooseRepos(skills) {
	const counts = new Map();
	for (const s of skills)
		counts.set(s.sourceRepo, (counts.get(s.sourceRepo) ?? 0) + 1);
	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const selected = [];
	let total = 0;
	for (const [repo, c] of ranked) {
		selected.push(repo);
		total += c;
		if (total >= TARGET_COUNT || selected.length >= MAX_REPOS) break;
	}
	return new Set(selected);
}

function parseFrontMatter(md) {
	if (!md.startsWith("---\n")) return {};
	const end = md.indexOf("\n---\n", 4);
	if (end === -1) return {};
	const fm = md.slice(4, end);
	const out = {};
	for (const line of fm.split("\n")) {
		const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
		if (!m) continue;
		out[m[1]] = m[2].trim();
	}
	return out;
}

function readSkillMarkdown(repoDir, skillId) {
	const skillDir = path.join(repoDir, "skills", skillId);
	if (!existsSync(skillDir)) return null;
	for (const file of ["SKILL.md", "AGENTS.md", "README.md"]) {
		const p = path.join(skillDir, file);
		if (existsSync(p)) return readFileSync(p, "utf-8");
	}
	return null;
}

function toSlug(sourceRepo, skillId) {
	return `${sourceRepo.replace(/\//g, "-")}--${skillId}`
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/(^-|-$)/g, "");
}

function toDescription(md, fm, sourceRepo, skillId) {
	if (fm.description) return String(fm.description);
	const clean = md
		.replace(/^---[\s\S]*?---\n/, "")
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l.length > 0 && !l.startsWith("#"));
	return clean ?? `Imported from ${sourceRepo}/${skillId}`;
}

function toPrompt(md, sourceRepo, skillId, url) {
	const body = md.trim().slice(0, 6000);
	return `# Source\n- skills.sh: ${url}\n- repository: ${sourceRepo}\n- skill: ${skillId}\n\n${body}`;
}

function inferCategory(sourceRepo, skillId, md) {
	const text = `${sourceRepo} ${skillId} ${md.slice(0, 2000)}`.toLowerCase();
	if (
		/(security|secure|owasp|threat|vuln|audit|pentest|xss|csrf|jwt|auth)/.test(
			text,
		)
	)
		return "security";
	if (
		/(sql|database|postgres|mysql|sqlite|mongodb|warehouse|etl|analytics|excel|xlsx|csv|financial|budget|tax)/.test(
			text,
		)
	)
		return "data";
	if (/(seo|marketing|sales|email|lead|growth|content|copywriting)/.test(text))
		return "web";
	if (/(react|frontend|css|html|ui|ux|design|web|next\\.js)/.test(text))
		return "web";
	if (
		/(devops|kubernetes|docker|ci|cd|infra|cloud|api|backend|typescript|python|java|golang|engineering|fullstack)/.test(
			text,
		)
	)
		return "code";
	return "custom";
}

function curatedEnglishSkills() {
	return [
		{
			name: "DOCX report writer",
			slug: "setra-docx-report-writer",
			description: "Create structured DOCX business reports.",
			category: "data",
			trigger: "docx, word, report",
			prompt: "Generate a DOCX-ready outline with sections and tables.",
		},
		{
			name: "XLSX financial modeler",
			slug: "setra-xlsx-financial-modeler",
			description: "Build spreadsheet models for forecast and planning.",
			category: "data",
			trigger: "xlsx, excel, forecast",
			prompt: "Produce workbook sheets, formulas, and assumptions.",
		},
		{
			name: "CSV pipeline builder",
			slug: "setra-csv-pipeline-builder",
			description: "Design CSV import/export schemas and validation.",
			category: "data",
			trigger: "csv, import, export",
			prompt: "Define CSV mappings, constraints, and reconciliation checks.",
		},
		{
			name: "Cybersecurity hardening advisor",
			slug: "setra-cybersecurity-hardening-advisor",
			description: "Threat model and mitigation playbook.",
			category: "security",
			trigger: "security, threat, hardening",
			prompt: "Create a prioritized remediation checklist for common risks.",
		},
		{
			name: "SEO technical optimizer",
			slug: "setra-seo-technical-optimizer",
			description: "Improve indexing and technical SEO quality.",
			category: "web",
			trigger: "seo, indexing",
			prompt: "Propose technical SEO fixes with measurable KPIs.",
		},
		{
			name: "Sales pipeline operator",
			slug: "setra-sales-pipeline-operator",
			description: "Build lead stages and conversion workflow.",
			category: "web",
			trigger: "sales, lead, pipeline",
			prompt: "Design lead qualification and follow-up SLA process.",
		},
		{
			name: "DevOps release engineer",
			slug: "setra-devops-release-engineer",
			description: "Create CI/CD release pipelines with rollback safety.",
			category: "code",
			trigger: "devops, ci, cd",
			prompt: "Build rollout/rollback pipeline with quality gates.",
		},
		{
			name: "Finance controller assistant",
			slug: "setra-finance-controller-assistant",
			description: "Track close checklist and monthly variance.",
			category: "data",
			trigger: "finance, accounting",
			prompt: "Generate monthly finance controls and reporting cadence.",
		},
	];
}

function main() {
	const root = process.cwd();
	const outDir = path.join(root, "apps/server/skills");
	const outFile = path.join(outDir, "catalog.json");
	mkdirSync(outDir, { recursive: true });

	const xml = execSync(`curl -fsSL ${SITEMAP_URL}`, {
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "inherit"],
	});
	const allSkills = parseSitemap(xml);
	const selectedRepos = chooseRepos(allSkills);
	const selectedSkills = allSkills.filter((s) =>
		selectedRepos.has(s.sourceRepo),
	);

	const tmp = mkdtempSync(path.join(tmpdir(), "setra-skills-"));
	const repoDirs = new Map();
	const uniqueRepos = [...selectedRepos];
	for (const sourceRepo of uniqueRepos) {
		const [owner, repo] = sourceRepo.split("/");
		const local = path.join(tmp, `${owner}__${repo}`);
		try {
			execSync(
				`git clone --depth 1 --filter=blob:none https://github.com/${owner}/${repo}.git "${local}"`,
				{
					stdio: "ignore",
				},
			);
			repoDirs.set(sourceRepo, local);
		} catch {
			// Some entries in the directory can be moved/private; skip them.
		}
	}

	const seen = new Set();
	const catalog = [];
	for (const s of selectedSkills) {
		const repoDir = repoDirs.get(s.sourceRepo);
		if (!repoDir) continue;
		const md = readSkillMarkdown(repoDir, s.skillId);
		if (!md) continue;
		const fm = parseFrontMatter(md);
		const slug = toSlug(s.sourceRepo, s.skillId);
		if (seen.has(slug)) continue;
		const candidate = {
			name: fm.name || s.skillId.split("/").pop() || s.skillId,
			slug,
			description: toDescription(md, fm, s.sourceRepo, s.skillId),
			category: inferCategory(s.sourceRepo, s.skillId, md),
			trigger: s.skillId.replace(/[/:_-]+/g, ", "),
			prompt: toPrompt(md, s.sourceRepo, s.skillId, s.url),
		};
		if (
			CJK_RE.test(
				`${candidate.name} ${candidate.description} ${candidate.prompt}`,
			)
		)
			continue;
		seen.add(slug);
		catalog.push(candidate);
	}

	for (const skill of curatedEnglishSkills()) {
		if (seen.has(skill.slug)) continue;
		seen.add(skill.slug);
		catalog.push(skill);
	}

	writeFileSync(outFile, JSON.stringify(catalog, null, 2), "utf-8");
	rmSync(tmp, { recursive: true, force: true });
	console.log(`wrote ${catalog.length} skills to ${outFile}`);
}

main();
