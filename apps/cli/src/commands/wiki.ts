/**
 * setra wiki <subcommand>
 *
 * Commands:
 *   setra wiki list [--section decisions]
 *   setra wiki read <slug>
 *   setra wiki write <slug> --content "# My Article\n..."
 *   setra wiki search <query>
 *   setra wiki toc
 */

import {
	buildTableOfContents,
	listArticles,
	readArticle,
	searchArticles,
	writeArticle,
} from "@setra/core/wiki.js";

const COMPANY_SLUG = process.env["SETRA_COMPANY_SLUG"] ?? "default";

// ─── setra wiki list ──────────────────────────────────────────────────────────

export async function runWikiList(opts: { section?: string }): Promise<void> {
	const articles = await listArticles(COMPANY_SLUG, opts.section);

	if (articles.length === 0) {
		console.log("No articles found.");
		return;
	}

	const grouped: Record<string, typeof articles> = {};
	for (const a of articles) {
		const section = a.slug.includes("/") ? a.slug.split("/")[0]! : "root";
		(grouped[section] ??= []).push(a);
	}

	for (const [section, items] of Object.entries(grouped)) {
		console.log(`\n${section.toUpperCase()}`);
		for (const item of items) {
			const date = item.lastEditedAt.toISOString().slice(0, 10);
			console.log(
				`  ${item.slug.padEnd(40)} ${item.title.padEnd(32)} ${item.lastEditedBy} ${date}`,
			);
		}
	}
}

// ─── setra wiki read ──────────────────────────────────────────────────────────

export async function runWikiRead(slug: string): Promise<void> {
	const article = await readArticle(COMPANY_SLUG, slug);
	if (!article) {
		console.error(`Article not found: ${slug}`);
		process.exit(1);
	}

	console.log(`\n${"─".repeat(60)}`);
	console.log(`  ${article.title}`);
	console.log(
		`  slug: ${article.slug} | by: ${article.lastEditedBy} | ${article.wordCount} words`,
	);
	console.log(`${"─".repeat(60)}\n`);
	console.log(article.content);

	if (article.backlinks.length > 0) {
		console.log(`\nBacklinks: ${article.backlinks.join(", ")}`);
	}
}

// ─── setra wiki write ─────────────────────────────────────────────────────────

export async function runWikiWrite(
	slug: string,
	opts: { content: string },
): Promise<void> {
	if (!opts.content) {
		console.error("--content is required");
		process.exit(1);
	}

	const content = opts.content.replace(/\\n/g, "\n");
	const result = await writeArticle(COMPANY_SLUG, slug, content, "cli");
	const action = result.created ? "Created" : "Updated";
	console.log(`${action} ${slug} (commit: ${result.commitSha})`);
}

// ─── setra wiki search ────────────────────────────────────────────────────────

export async function runWikiSearch(query: string): Promise<void> {
	const results = await searchArticles(COMPANY_SLUG, query);

	if (results.length === 0) {
		console.log(`No results for: ${query}`);
		return;
	}

	console.log(
		`\n${results.length} result${results.length !== 1 ? "s" : ""} for "${query}":\n`,
	);
	for (const r of results) {
		console.log(`  ${r.slug}`);
		console.log(`    ${r.title}`);
		if (r.excerpt) console.log(`    ...${r.excerpt}...`);
		console.log();
	}
}

// ─── setra wiki toc ───────────────────────────────────────────────────────────

export async function runWikiToc(): Promise<void> {
	const toc = await buildTableOfContents(COMPANY_SLUG);
	console.log(toc);
}
