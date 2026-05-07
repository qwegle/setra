import chalk from "chalk";
import {
	type ActivityEntry,
	getActivityFeedLocal,
	getServerBaseUrl,
	isServerReachable,
} from "./runtime-support.js";

export async function activityCommand(opts: {
	limit: string;
	since?: string;
}): Promise<void> {
	const limit = Number.parseInt(opts.limit, 10) || 20;
	const baseUrl = getServerBaseUrl();
	const entries = await ((await isServerReachable(baseUrl))
		? fetchActivityJson<ActivityEntry[]>(
				`/api/activity?limit=${limit}${opts.since ? `&since=${encodeURIComponent(opts.since)}` : ""}`,
			)
		: getActivityFeedLocal({ limit, since: opts.since }));

	if (entries.length === 0) {
		console.log(chalk.gray("No recent activity."));
		return;
	}

	for (const entry of entries) {
		console.log(
			`${chalk.gray(entry.timestamp.replace("T", " ").slice(0, 19))}  ${chalk.cyan((entry.agent || "system").padEnd(12))}  ${colorAction(entry.action).padEnd(18)}  ${chalk.white(entry.entity.padEnd(16))}  ${chalk.gray(entry.summary)}`,
		);
	}
}

function colorAction(action: string): string {
	if (action.includes("deploy")) return chalk.magenta(action);
	if (action.includes("dispatch")) return chalk.yellow(action);
	if (action.includes("secret")) return chalk.green(action);
	if (action.includes("agent")) return chalk.blue(action);
	return chalk.white(action);
}

async function fetchActivityJson<T>(path: string): Promise<T> {
	const response = await fetch(new URL(path, getServerBaseUrl()));
	if (!response.ok) {
		throw new Error((await response.text()) || response.statusText);
	}
	return (await response.json()) as T;
}
