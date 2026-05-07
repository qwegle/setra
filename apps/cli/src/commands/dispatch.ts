import chalk from "chalk";
import ora from "ora";
import {
	type DispatchStatus,
	getDispatchStatusLocal,
	getServerBaseUrl,
	isServerReachable,
	startDispatchLocal,
} from "./runtime-support.js";

export async function dispatchCommand(
	task: string,
	opts: { agents?: string; budget?: string },
): Promise<void> {
	const agents = opts.agents
		?.split(",")
		.map((agent) => agent.trim())
		.filter(Boolean);
	const budget = opts.budget ? Number.parseFloat(opts.budget) : undefined;
	const baseUrl = getServerBaseUrl();
	const spinner = ora(`Dispatching: ${task}`).start();

	try {
		let status = await ((await isServerReachable(baseUrl))
			? fetchDispatchJson<DispatchStatus>("/api/dispatch", {
					method: "POST",
					body: JSON.stringify({ task, agents, budget }),
				})
			: startDispatchLocal({ task, agents, budget }));
		spinner.stop();
		renderDispatch(status);

		while (status.status !== "completed") {
			await sleep(1_000);
			status = await ((await isServerReachable(baseUrl))
				? fetchDispatchJson<DispatchStatus>(`/api/dispatch/${status.id}`)
				: getDispatchStatusLocal(status.id));
			console.log();
			renderDispatch(status);
		}
	} catch (error) {
		spinner.fail(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

function renderDispatch(status: DispatchStatus): void {
	console.log(
		chalk.bold(`\nDispatch ${status.id.slice(0, 8)} · ${status.task}`),
	);
	if (status.budget != null) {
		console.log(chalk.gray(`Budget: $${status.budget.toFixed(2)}`));
	}
	console.log(
		chalk.gray(
			`${"AGENT".padEnd(14)}${"STATUS".padEnd(14)}${"PROGRESS".padEnd(12)}TASK`,
		),
	);
	for (const assignment of status.assignments) {
		const statusColor =
			assignment.status === "done"
				? chalk.green
				: assignment.status === "in_progress"
					? chalk.yellow
					: chalk.gray;
		console.log(
			`${chalk.cyan(assignment.agentSlug.padEnd(14))}${statusColor(assignment.status.padEnd(14))}${`${assignment.progress}%`.padEnd(12)}${assignment.taskTitle}`,
		);
	}
}

async function fetchDispatchJson<T>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(new URL(path, getServerBaseUrl()), {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	if (!response.ok) {
		throw new Error((await response.text()) || response.statusText);
	}
	return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
