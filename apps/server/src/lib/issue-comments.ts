import * as issuesRepo from "../repositories/issues.repo.js";

export function addAutomationIssueComment(
	issueId: string,
	companyId: string | null,
	body: string,
	author: string,
): void {
	if (!companyId) return;
	try {
		const comment = issuesRepo.addComment(issueId, companyId, body, author);
		if (!comment) return;
		// Avoid duplicate automation noise like "setra comment added" in activity.
	} catch (err) {
		console.warn("[issue-comments] addAutomationIssueComment failed:", err);
	}
}
