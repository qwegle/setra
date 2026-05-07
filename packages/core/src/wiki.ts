/**
 * wiki.ts — Shared team knowledge base
 *
 * Agents write structured markdown articles here. Articles persist
 * across sessions. Wikilink grammar: [[slug]] and [[slug|Display]].
 * Every write is committed to a local git repo for full revision history.
 *
 * Layout:
 *   ~/.setra/wiki/{companySlug}/
 *     people/           — one article per team member
 *     projects/         — project context articles
 *     decisions/        — Architecture Decision Records (ADRs)
 *     runbooks/         — operational procedures
 *     leads/            — CRM/GTM notes on contacts (for GTM template)
 *     index.md          — auto-generated table of contents
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

export interface WikiArticle {
	slug: string; // relative path without .md, e.g. "decisions/use-sqlite"
	title: string; // extracted from first H1
	content: string; // full markdown
	lastEditedBy: string; // agent slug or "human"
	lastEditedAt: Date;
	wordCount: number;
	backlinks: string[]; // slugs of articles that link here via [[slug]]
}

export interface WikiWriteResult {
	slug: string;
	commitSha: string;
	created: boolean; // true if new article, false if updated
}

// Path helpers
export function wikiRoot(companySlug: string): string {
	return join(homedir(), ".setra", "wiki", companySlug);
}

export function getArticleUrl(companySlug: string, slug: string): string {
	return join(wikiRoot(companySlug), `${slug}.md`);
}

// Git helpers — degrade gracefully if git is unavailable
function runGit(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		try {
			const proc = spawn("git", args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			proc.stdout.on("data", (d: Buffer) => {
				stdout += d.toString();
			});
			proc.stderr.on("data", (d: Buffer) => {
				stderr += d.toString();
			});
			proc.on("error", () => resolve(""));
			proc.on("close", (code) => {
				if (code !== 0 && stderr) {
					resolve("");
				} else {
					resolve(stdout.trim());
				}
			});
		} catch {
			resolve("");
		}
	});
}

async function ensureGitRepo(root: string): Promise<void> {
	if (!existsSync(join(root, ".git"))) {
		await runGit(root, ["init"]);
		await runGit(root, ["config", "user.name", "setra"]);
		await runGit(root, ["config", "user.email", "setra@local"]);
	}
}

async function gitCommit(
	root: string,
	filePath: string,
	message: string,
): Promise<string> {
	await runGit(root, ["add", filePath]);
	await runGit(root, ["commit", "--allow-empty", "-m", message]);
	const sha = await runGit(root, ["rev-parse", "--short", "HEAD"]);
	return sha || "unknown";
}

// Frontmatter helpers
interface Frontmatter {
	lastEditedBy: string;
	lastEditedAt: string;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n/;

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
	const m = FM_RE.exec(raw);
	if (!m) {
		return {
			meta: { lastEditedBy: "human", lastEditedAt: new Date().toISOString() },
			body: raw,
		};
	}
	const lines = (m[1] ?? "").split("\n");
	const meta: Record<string, string> = {};
	for (const line of lines) {
		const idx = line.indexOf(":");
		if (idx > -1) {
			meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
	}
	return {
		meta: {
			lastEditedBy: meta["lastEditedBy"] ?? "human",
			lastEditedAt: meta["lastEditedAt"] ?? new Date().toISOString(),
		},
		body: raw.slice(m[0].length),
	};
}

function buildFrontmatter(authorSlug: string, now: Date): string {
	return `---\nlastEditedBy: ${authorSlug}\nlastEditedAt: ${now.toISOString()}\n---\n`;
}

function extractTitle(body: string): string {
	const m = /^#\s+(.+)$/m.exec(body);
	return m ? (m[1] ?? "Untitled").trim() : "Untitled";
}

function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

// Wikilink parsing
export function parseWikilinks(
	content: string,
): Array<{ slug: string; display: string }> {
	const results: Array<{ slug: string; display: string }> = [];
	const re = /\[\[([^\[\]]+)\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(content)) !== null) {
		const inner = m[1]!.trim();
		if (!inner) continue;
		// Invalid: contains spaces only, absolute paths, parent traversal, multiple pipes
		if (
			inner.startsWith("/") ||
			inner.startsWith("../") ||
			inner.includes("..")
		)
			continue;
		const parts = inner.split("|");
		if (parts.length > 2) continue;
		const slug = (parts[0] ?? "").trim();
		const display = (parts[1] ?? slug).trim();
		if (!slug) continue;
		results.push({ slug, display });
	}
	return results;
}

// Backlink computation
function computeBacklinks(companySlug: string, targetSlug: string): string[] {
	const root = wikiRoot(companySlug);
	const backlinks: string[] = [];
	try {
		const all = collectMdFiles(root);
		for (const filePath of all) {
			const raw = readFileSync(filePath, "utf8");
			const { body } = parseFrontmatter(raw);
			const links = parseWikilinks(body);
			if (links.some((l) => l.slug === targetSlug)) {
				const rel = relative(root, filePath).replace(/\.md$/, "");
				backlinks.push(rel);
			}
		}
	} catch {
		// ignore
	}
	return backlinks;
}

function collectMdFiles(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;
	try {
		const entries = readdirSync(dir);
		for (const e of entries) {
			if (e === ".git") continue;
			const full = join(dir, e);
			const s = statSync(full);
			if (s.isDirectory()) {
				results.push(...collectMdFiles(full));
			} else if (e.endsWith(".md") && e !== "index.md") {
				results.push(full);
			}
		}
	} catch {
		// ignore
	}
	return results;
}

// Public API
export async function readArticle(
	companySlug: string,
	slug: string,
): Promise<WikiArticle | null> {
	const filePath = getArticleUrl(companySlug, slug);
	if (!existsSync(filePath)) return null;

	const raw = readFileSync(filePath, "utf8");
	const { meta, body } = parseFrontmatter(raw);
	const title = extractTitle(body);
	const backlinks = computeBacklinks(companySlug, slug);

	return {
		slug,
		title,
		content: body,
		lastEditedBy: meta.lastEditedBy,
		lastEditedAt: new Date(meta.lastEditedAt),
		wordCount: countWords(body),
		backlinks,
	};
}

export async function writeArticle(
	companySlug: string,
	slug: string,
	content: string,
	authorSlug: string,
): Promise<WikiWriteResult> {
	const root = wikiRoot(companySlug);
	const filePath = getArticleUrl(companySlug, slug);
	const created = !existsSync(filePath);

	mkdirSync(dirname(filePath), { recursive: true });
	await ensureGitRepo(root);

	const now = new Date();
	const fm = buildFrontmatter(authorSlug, now);
	writeFileSync(filePath, fm + content, "utf8");

	const action = created ? "create" : "update";
	const title = extractTitle(content);
	const commitSha = await gitCommit(
		root,
		relative(root, filePath),
		`${action}(${authorSlug}): ${slug} — ${title}`,
	);

	// Regenerate TOC
	try {
		const toc = await buildTableOfContents(companySlug);
		writeFileSync(join(root, "index.md"), toc, "utf8");
		await runGit(root, ["add", "index.md"]);
		await runGit(root, ["commit", "--amend", "--no-edit"]);
	} catch {
		// TOC rebuild may fail silently
	}

	return { slug, commitSha, created };
}

export async function listArticles(
	companySlug: string,
	section?: string,
): Promise<
	Array<{
		slug: string;
		title: string;
		lastEditedBy: string;
		lastEditedAt: Date;
	}>
> {
	const root = wikiRoot(companySlug);
	const allFiles = collectMdFiles(root);
	const results = [];

	for (const filePath of allFiles) {
		const rel = relative(root, filePath).replace(/\.md$/, "");
		if (section && !rel.startsWith(`${section}/`)) continue;

		const raw = readFileSync(filePath, "utf8");
		const { meta, body } = parseFrontmatter(raw);
		results.push({
			slug: rel,
			title: extractTitle(body),
			lastEditedBy: meta.lastEditedBy,
			lastEditedAt: new Date(meta.lastEditedAt),
		});
	}

	return results.sort(
		(a, b) => b.lastEditedAt.getTime() - a.lastEditedAt.getTime(),
	);
}

export async function searchArticles(
	companySlug: string,
	query: string,
): Promise<Array<{ slug: string; title: string; excerpt: string }>> {
	const root = wikiRoot(companySlug);
	const allFiles = collectMdFiles(root);
	const q = query.toLowerCase();
	const results = [];

	for (const filePath of allFiles) {
		const raw = readFileSync(filePath, "utf8");
		const { body } = parseFrontmatter(raw);
		const lower = body.toLowerCase();
		if (!lower.includes(q)) continue;

		const rel = relative(root, filePath).replace(/\.md$/, "");
		const title = extractTitle(body);

		// Build excerpt: find line containing query
		const lines = body.split("\n");
		let excerpt = "";
		for (const line of lines) {
			if (line.toLowerCase().includes(q)) {
				const idx = line.toLowerCase().indexOf(q);
				const start = Math.max(0, idx - 40);
				excerpt =
					(start > 0 ? "…" : "") +
					line.slice(start, idx + q.length + 60).trim();
				break;
			}
		}

		results.push({ slug: rel, title, excerpt });
	}

	return results;
}

export async function deleteArticle(
	companySlug: string,
	slug: string,
	authorSlug: string,
): Promise<void> {
	const root = wikiRoot(companySlug);
	const filePath = getArticleUrl(companySlug, slug);
	if (!existsSync(filePath)) return;

	unlinkSync(filePath);
	await ensureGitRepo(root);
	await runGit(root, ["add", relative(root, filePath)]);
	await runGit(root, ["commit", "-m", `delete(${authorSlug}): ${slug}`]);
}

const SECTIONS = [
	"people",
	"projects",
	"decisions",
	"runbooks",
	"leads",
] as const;

export async function buildTableOfContents(
	companySlug: string,
): Promise<string> {
	const lines = ["# Wiki — Table of Contents\n"];

	for (const section of SECTIONS) {
		const articles = await listArticles(companySlug, section);
		if (articles.length === 0) continue;

		const label = section.charAt(0).toUpperCase() + section.slice(1);
		lines.push(`\n## ${label}\n`);
		for (const a of articles) {
			lines.push(`- [[${a.slug}|${a.title}]]`);
		}
	}

	// Articles in root (no section prefix)
	const all = await listArticles(companySlug);
	const rootArticles = all.filter((a) => !a.slug.includes("/"));
	if (rootArticles.length > 0) {
		lines.push("\n## Other\n");
		for (const a of rootArticles) {
			lines.push(`- [[${a.slug}|${a.title}]]`);
		}
	}

	return lines.join("\n") + "\n";
}
