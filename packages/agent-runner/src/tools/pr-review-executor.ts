/**
 * Executor that dispatches PR review MCP tool calls to the right implementation.
 */

import {
	prGetDiff,
	prListOpen,
	prPostComment,
	prSubmitReview,
} from "./pr-review.js";

function str(v: unknown): string {
	return typeof v === "string" ? v : String(v ?? "");
}

function num(v: unknown): number {
	return typeof v === "number" ? v : Number(v);
}

export async function executePrTool(
	toolName: string,
	input: Record<string, unknown>,
): Promise<string> {
	const owner = str(input["owner"]);
	const repo = str(input["repo"]);
	const token = str(input["token"]);

	switch (toolName) {
		case "pr_get_diff": {
			const files = await prGetDiff(
				owner,
				repo,
				num(input["pr_number"]),
				token,
			);
			return JSON.stringify(files);
		}

		case "pr_post_comment": {
			const result = await prPostComment(
				owner,
				repo,
				num(input["pr_number"]),
				token,
				str(input["body"]),
				input["path"] !== undefined ? str(input["path"]) : undefined,
				input["line"] !== undefined ? num(input["line"]) : undefined,
				input["commit_id"] !== undefined ? str(input["commit_id"]) : undefined,
			);
			return JSON.stringify(result ?? { ok: true });
		}

		case "pr_submit_review": {
			const event = str(input["event"]) as
				| "APPROVE"
				| "REQUEST_CHANGES"
				| "COMMENT";
			const result = await prSubmitReview(
				owner,
				repo,
				num(input["pr_number"]),
				token,
				event,
				str(input["body"]),
			);
			return JSON.stringify(result ?? { ok: true });
		}

		case "pr_list_open": {
			const prs = await prListOpen(owner, repo, token);
			return JSON.stringify(prs);
		}

		default:
			throw new Error(`Unknown PR tool: ${toolName}`);
	}
}
