function toSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
}

export function buildIssueBranchName(
	issueId: string,
	issueTitle: string | null,
): string {
	const slug = toSlug(issueTitle ?? "") || "task";
	return `setra/issue-${issueId}-${slug}`;
}
