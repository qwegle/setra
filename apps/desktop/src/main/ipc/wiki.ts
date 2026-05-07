/**
 * wiki.ts — IPC handlers for the team wiki
 */

import {
	buildTableOfContents,
	deleteArticle,
	listArticles,
	readArticle,
	searchArticles,
	writeArticle,
} from "@setra/core/wiki.js";
import { ipcMain } from "electron";

function getCompanySlug(): string {
	// Reads from env or defaults to "default"
	return process.env["SETRA_COMPANY_SLUG"] ?? "default";
}

export function registerWikiHandlers(): void {
	// wiki:read — read a single article
	ipcMain.handle("wiki:read", async (_event, slug: string) => {
		const article = await readArticle(getCompanySlug(), slug);
		return article;
	});

	// wiki:write — create or update an article
	ipcMain.handle(
		"wiki:write",
		async (_event, slug: string, content: string, authorSlug = "human") => {
			const result = await writeArticle(
				getCompanySlug(),
				slug,
				content,
				authorSlug,
			);
			return result;
		},
	);

	// wiki:list — list articles, optionally filtered by section
	ipcMain.handle("wiki:list", async (_event, section?: string) => {
		const articles = await listArticles(getCompanySlug(), section);
		return articles;
	});

	// wiki:search — keyword search
	ipcMain.handle("wiki:search", async (_event, query: string) => {
		const results = await searchArticles(getCompanySlug(), query);
		return results;
	});

	// wiki:toc — table of contents
	ipcMain.handle("wiki:toc", async () => {
		const toc = await buildTableOfContents(getCompanySlug());
		return toc;
	});

	// wiki:delete — delete an article
	ipcMain.handle(
		"wiki:delete",
		async (_event, slug: string, authorSlug = "human") => {
			await deleteArticle(getCompanySlug(), slug, authorSlug);
			return { ok: true };
		},
	);
}
